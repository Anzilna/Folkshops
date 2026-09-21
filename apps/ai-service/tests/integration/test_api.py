"""
Full HTTP-layer integration tests — real Postgres/Redis, fake LLM/embedding
providers (no vendor API key needed, no network — see docs/decisions/0011),
run through FastAPI's own TestClient so the real dependency-injection wiring
in main.py's lifespan is exercised, not bypassed.
"""

import os

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


def _staff_token(tenant_id: str) -> str:
    return jwt.encode(
        {"sub": "test-staff", "tenantId": tenant_id, "role": "owner", "email": "staff@test.test"},
        "dev-only-change-me",
        algorithm="HS256",
    )


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_reports_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["dependencies"] == {"postgres": True, "redis": True, "vector_store": True}


def test_chat_without_auth_is_rejected(client):
    resp = client.post("/chat", json={"message": "hi"})
    assert resp.status_code == 401


def test_chat_with_valid_staff_token_succeeds(client):
    import uuid

    token = _staff_token(str(uuid.uuid4()))
    client.cookies.set("fk_access_token", token)
    resp = client.post("/chat", json={"message": "What is your return policy?"})
    assert resp.status_code == 200
    body = resp.json()
    assert "conversation_id" in body
    assert body["citations"] == []  # no documents indexed for this fresh tenant
    client.cookies.clear()


def test_upload_rejects_unsupported_mime_type(client):
    import uuid

    token = _staff_token(str(uuid.uuid4()))
    client.cookies.set("fk_access_token", token)
    resp = client.post("/documents", files={"file": ("virus.exe", b"content", "application/x-executable")})
    assert resp.status_code == 415
    client.cookies.clear()


def test_get_nonexistent_document_returns_404(client):
    import uuid

    token = _staff_token(str(uuid.uuid4()))
    client.cookies.set("fk_access_token", token)
    resp = client.get(f"/documents/{uuid.uuid4()}")
    assert resp.status_code == 404
    client.cookies.clear()
