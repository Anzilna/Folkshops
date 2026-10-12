"""
Full HTTP-layer integration tests — real Postgres/Redis, fake LLM/embedding
providers (no vendor API key needed, no network — see docs/decisions/0011),
run through FastAPI's own TestClient so the real dependency-injection wiring
in main.py's lifespan is exercised, not bypassed.
"""

import asyncio
import os
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgres://folkshops_ai:folkshops_ai@localhost:5432/folkshops_dev")
os.environ.setdefault("MIGRATIONS_DATABASE_URL", "postgres://folkshops:folkshops@localhost:5432/folkshops_dev")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "dev-only-change-me")
os.environ.setdefault("CUSTOMER_JWT_SECRET", "dev-only-change-me-three")
os.environ.setdefault("LLM_PROVIDER", "fake")
os.environ.setdefault("EMBEDDING_PROVIDER", "fake")

from app.main import app  # noqa: E402
from tests.billing_fixtures import create_subscribed_tenant, delete_tenant, set_tenant_status  # noqa: E402


def _staff_token(tenant_id: str) -> str:
    return jwt.encode(
        {"sub": "test-staff", "tenantId": tenant_id, "role": "owner", "email": "staff@test.test"},
        "dev-only-change-me",
        algorithm="HS256",
    )


def _customer_token(tenant_id: str) -> str:
    return jwt.encode({"sub": "test-customer", "tenantId": tenant_id}, "dev-only-change-me-three", algorithm="HS256")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def subscribed_tenant():
    """Real tenant on a given plan, logged in as its staff via the cookie. Cleaned up after the test."""
    created: list[uuid.UUID] = []

    def _make(plan_slug: str = "standard", status: str = "active") -> str:
        tenant_id = asyncio.run(create_subscribed_tenant(plan_slug, status))
        created.append(tenant_id)
        return str(tenant_id)

    yield _make
    for tenant_id in created:
        asyncio.run(delete_tenant(tenant_id))


@pytest.fixture(autouse=True)
def _clear_cookies(client):
    yield
    client.cookies.clear()


def test_health_reports_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["dependencies"] == {"postgres": True, "redis": True, "vector_store": True}


def test_chat_without_auth_is_rejected(client):
    resp = client.post("/chat", json={"message": "hi"})
    assert resp.status_code == 401


def test_chat_on_ai_plan_succeeds(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant("standard")))
    resp = client.post("/chat", json={"message": "What is your return policy?"})
    assert resp.status_code == 200
    body = resp.json()
    assert "conversation_id" in body
    assert body["citations"] == []  # no documents indexed for this fresh tenant


# --- Plan gate (application/entitlements.py, require_ai_access) ---


@pytest.mark.parametrize(
    ("plan_slug", "status", "code"),
    [
        ("basic", "active", "not_in_plan"),
        ("standard", "incomplete", "subscription_inactive"),
        ("standard", "canceled", "subscription_inactive"),
    ],
)
def test_gated_routes_reject_tenants_without_ai(client, subscribed_tenant, plan_slug, status, code):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant(plan_slug, status)))

    responses = [
        client.post("/chat", json={"message": "hi"}),
        client.get("/documents"),
        client.post("/documents", files={"file": ("faq.txt", b"Returns within 30 days.", "text/plain")}),
        client.delete(f"/documents/{uuid.uuid4()}"),
    ]

    for resp in responses:
        assert resp.status_code == 402
        assert resp.json()["detail"]["code"] == code


def test_past_due_keeps_ai_access(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant("standard", "past_due")))
    assert client.get("/documents").status_code == 200


def test_tenant_with_no_subscription_is_rejected(client):
    client.cookies.set("fk_access_token", _staff_token(str(uuid.uuid4())))
    resp = client.post("/chat", json={"message": "hi"})
    assert resp.status_code == 402
    assert resp.json()["detail"]["code"] == "no_subscription"


def test_customer_token_cannot_use_store_ai(client, subscribed_tenant):
    """Even on an AI plan: a shopper must never upload into, read, or chat against the store's knowledge base."""
    tenant_id = subscribed_tenant("advanced")
    client.cookies.set("fk_customer_access_token", _customer_token(tenant_id))

    assert client.post("/chat", json={"message": "hi"}).status_code == 403
    assert client.get("/documents").status_code == 403
    assert client.post("/documents", files={"file": ("x.txt", b"x", "text/plain")}).status_code == 403
    assert client.get("/entitlement").status_code == 403


def test_entitlement_endpoint_reports_plan_without_being_gated(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant("basic")))
    resp = client.get("/entitlement")
    assert resp.status_code == 200
    body = resp.json()
    assert body["allowed"] is False
    assert body["reason"] == "not_in_plan"
    assert body["plan_slug"] == "basic"


# --- Knowledge base CRUD ---


def test_upload_rejects_unsupported_mime_type(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant()))
    resp = client.post("/documents", files={"file": ("virus.exe", b"content", "application/x-executable")})
    assert resp.status_code == 415


def test_get_nonexistent_document_returns_404(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant()))
    resp = client.get(f"/documents/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_upload_list_delete_round_trip(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant()))

    uploaded = client.post("/documents", files={"file": ("returns.txt", b"Returns within 30 days.", "text/plain")})
    assert uploaded.status_code == 202
    document_id = uploaded.json()["id"]

    listing = client.get("/documents", params={"search": "return", "page": 1, "limit": 10})
    assert listing.status_code == 200
    page = listing.json()
    assert page["total"] == 1
    assert page["totalPages"] == 1
    assert [d["id"] for d in page["data"]] == [document_id]

    assert client.get("/documents", params={"status": "indexed"}).json()["total"] == 0

    assert client.delete(f"/documents/{document_id}").status_code == 204
    assert client.get(f"/documents/{document_id}").status_code == 404
    assert client.delete(f"/documents/{document_id}").status_code == 404


def test_cannot_delete_another_tenants_document(client, subscribed_tenant):
    owner, intruder = subscribed_tenant(), subscribed_tenant()

    client.cookies.set("fk_access_token", _staff_token(owner))
    document_id = client.post("/documents", files={"file": ("a.txt", b"secret", "text/plain")}).json()["id"]

    client.cookies.set("fk_access_token", _staff_token(intruder))
    assert client.delete(f"/documents/{document_id}").status_code == 404

    client.cookies.set("fk_access_token", _staff_token(owner))
    assert client.get(f"/documents/{document_id}").status_code == 200


def test_chat_cites_indexed_document_by_filename(client, subscribed_tenant):
    """Full RAG round-trip: ingest (run in-process instead of via the arq worker) -> chat -> citation with filename."""
    tenant_id = subscribed_tenant()
    client.cookies.set("fk_access_token", _staff_token(tenant_id))

    content = b"Our return policy: items can be returned within 30 days of delivery."
    document_id = client.post("/documents", files={"file": ("returns.txt", content, "text/plain")}).json()["id"]
    client.portal.call(
        app.state.ingestion_pipeline.run, uuid.UUID(tenant_id), uuid.UUID(document_id), content, "text/plain"
    )
    assert client.get(f"/documents/{document_id}").json()["status"] == "indexed"

    resp = client.post("/chat", json={"message": "What is the return policy?"})
    assert resp.status_code == 200
    citations = resp.json()["citations"]
    assert citations
    assert {c["document_id"] for c in citations} == {document_id}
    assert {c["filename"] for c in citations} == {"returns.txt"}


# --- Agent (POST /agent/chat, /agent/actions/*) ---


def test_agent_requires_auth(client):
    assert client.post("/agent/chat", json={"message": "hi"}).status_code == 401


def test_agent_serves_staff_and_customers_on_an_ai_plan(client, subscribed_tenant):
    tenant_id = subscribed_tenant("standard")

    client.cookies.set("fk_access_token", _staff_token(tenant_id))
    staff = client.post("/agent/chat", json={"message": "How many orders today?"})
    assert staff.status_code == 200
    assert staff.json()["status"] == "completed"
    client.cookies.clear()

    client.cookies.set("fk_customer_access_token", _customer_token(tenant_id))
    shopper = client.post("/agent/chat", json={"message": "Do you ship to Dubai?"})
    assert shopper.status_code == 200
    # Separate conversations: a shopper never lands in staff history.
    assert shopper.json()["conversation_id"] != staff.json()["conversation_id"]


def test_agent_stream_requires_auth_and_the_plan(client, subscribed_tenant):
    assert client.post("/agent/chat/stream", json={"message": "hi"}).status_code == 401
    tenant_id = subscribed_tenant("free")
    client.cookies.set("fk_access_token", _staff_token(tenant_id))
    assert client.post("/agent/chat/stream", json={"message": "hi"}).status_code == 402


def test_agent_stream_ends_with_the_same_body_as_the_json_endpoint(client, subscribed_tenant):
    import json

    tenant_id = subscribed_tenant("standard")
    client.cookies.set("fk_access_token", _staff_token(tenant_id))
    resp = client.post("/agent/chat/stream", json={"message": "How many orders today?"})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[len("data: ") :]) for line in resp.text.splitlines() if line.startswith("data: ")]
    assert events[-1]["type"] == "done"
    assert events[-1]["response"]["status"] == "completed"
    assert events[-1]["response"]["conversation_id"]
    assert all(e["type"] in {"tool", "done"} for e in events)


def test_agent_is_plan_gated_for_shoppers_too(client, subscribed_tenant):
    client.cookies.set("fk_customer_access_token", _customer_token(subscribed_tenant("basic")))
    resp = client.post("/agent/chat", json={"message": "hi"})
    assert resp.status_code == 402
    assert resp.json()["detail"]["code"] == "not_in_plan"


def test_agent_rejects_oversized_messages(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant("standard")))
    assert client.post("/agent/chat", json={"message": "x" * 4001}).status_code == 422
    assert client.post("/agent/chat", json={"message": ""}).status_code == 422
    assert client.post("/chat", json={"message": "x" * 4001}).status_code == 422


def test_confirming_an_unknown_action_is_404(client, subscribed_tenant):
    client.cookies.set("fk_access_token", _staff_token(subscribed_tenant("standard")))
    assert client.post(f"/agent/actions/{uuid.uuid4()}/confirm").status_code == 404
    assert client.post(f"/agent/actions/{uuid.uuid4()}/cancel").status_code == 404


def test_suspended_store_loses_the_ai_on_every_surface_and_gets_it_back(client, subscribed_tenant):
    tenant_id = subscribed_tenant("advanced")
    staff, shopper = (
        {"fk_access_token": _staff_token(tenant_id)},
        {"fk_customer_access_token": _customer_token(tenant_id)},
    )

    def statuses() -> list[int]:
        out = []
        for cookies, paths in ((staff, ("/agent/chat", "/chat", "/documents")), (shopper, ("/agent/chat",))):
            client.cookies.clear()
            for name, value in cookies.items():
                client.cookies.set(name, value)
            for path in paths:
                out.append(
                    client.get(path).status_code
                    if path == "/documents"
                    else client.post(path, json={"message": "hi"}).status_code
                )
        return out

    assert statuses() == [200, 200, 200, 200]

    asyncio.run(set_tenant_status(uuid.UUID(tenant_id), "suspended"))
    assert statuses() == [403, 403, 403, 403]
    client.cookies.clear()
    client.cookies.set("fk_access_token", _staff_token(tenant_id))
    detail = client.post("/agent/chat", json={"message": "hi"}).json()["detail"]
    assert detail["code"] == "tenant_suspended"

    asyncio.run(set_tenant_status(uuid.UUID(tenant_id), "active"))
    assert statuses() == [200, 200, 200, 200]
