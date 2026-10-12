# 0017 — Platform knowledge: Folkshops help content for every store's Copilot

Status: accepted, built and verified (2026-10-02). Extends ADR 0011 (ai-service), 0015 (agent + MCP) and 0016 (platform admin).

A merchant asks the Store Copilot "how do I connect Stripe?" or "what does the Advanced plan include?". That is Folkshops' own knowledge, not any store's, and until now nothing could hold it: every `documents`/`document_chunks` row belonged to exactly one tenant.

## Decision

Platform knowledge is **the same tables, same embedding column, same ingestion pipeline** — a platform row is a document whose `tenant_id` is the reserved nil UUID (`PLATFORM_TENANT_ID`, `00000000-0000-0000-0000-000000000000`).

| Piece | How |
|---|---|
| Storage | `scope` column (`tenant` \| `platform`) on `documents` and `document_chunks` (migration 0006). A CHECK ties it to `tenant_id` (`platform` ⇔ nil UUID), so the two can't disagree. `tenant_id` stays NOT NULL, so `tenant_isolation` and every index are untouched. |
| Isolation | New **read-only** policy `platform_read` (`FOR SELECT USING (scope = 'platform')`). Permissive policies OR together: a store still sees only its own rows plus platform rows, and can't insert/update/delete a platform row (no write policy matches; the CHECK blocks forging one). Only a request running with `app.tenant_id = nil` UUID can write them, and only the platform routes do. |
| Retrieval | `VectorStore.search(..., include_platform=False)`. Because RLS now *allows* every store to read platform rows, the default is an explicit `scope = 'tenant'` filter: a caller must opt in. |
| Who opts in | `LocalToolProvider` passes `include_platform = actor.actor_type == "staff"`. The Shopper Assistant never searches platform content — decided by the verified token type, not by the prompt or the request. |
| Authoring | `/platform/documents` on ai-service (POST/GET/list/DELETE), authenticated by `fk_pa_access_token` against `PLATFORM_ADMIN_JWT_SECRET` (`get_platform_admin`, deliberately *not* an `ActorContext`). No plan gate. Same 202 → arq job flow; the job runs as the nil tenant. platform-admin has a **Help docs** page (DataTable, same shape as merchant-admin's Knowledge base). |
| Store routes | `/documents` filters to the caller's own scope, so a store never lists or opens a platform document; deleting one finds no deletable row and 404s. |
| Citations | `knowledge_search` labels platform sources `Folkshops help: <file>`, both in the passage handed to the model and in the citation chip. The Copilot prompt tells it not to present one source as the other. |

## What is deliberately *not* a document

Facts about *this* store's current state ("what plan am I on?", "is my payments account live?") are live data. They belong as MCP tools in core-api next to `search_orders`, not as text that goes stale. Not built yet — no caller; add `get_my_plan` / `get_payments_status` when a merchant needs them.

## Failure modes and limits

- A bad or outdated platform doc is wrong for **every** store at once. There is no draft/review state yet: an upload is live once indexed. Add a publish step before more than a couple of admins author content.
- `get_platform_admin` doesn't re-check the admin still exists (core-api's guard does; ai-service can't read `platform_admins`). A removed admin keeps access for up to their 15-minute access token.
- Embedding model switches re-embed platform chunks like any others (`scripts/reembed_all.py` adds the nil tenant to its tenant loop explicitly, since it isn't a row in `tenants`).
- Query embeddings are cached per tenant as before; platform content adds no new cache surface.
- Tests: `tests/integration/test_platform_knowledge.py` (opt-in visibility, cross-store leakage, store can't write/delete/forge platform rows, scope/tenant agreement, store routes hide platform docs).
