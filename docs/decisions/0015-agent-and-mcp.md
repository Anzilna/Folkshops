# 0015 — Tool-calling agent and MCP (Store Copilot + Shopper Assistant)

Status: accepted, built and verified (2026-10-01). Extends ADR 0011.

## Decision

- **One bounded agent loop** (originally hand-written, now a LangGraph StateGraph with the same control flow — see ADR 0018), not a planner/executor or multi-agent setup. Every Folkshops task is a short chain of lookups plus at most one change; a single loop with hard limits covers it and stays auditable.
- **Two profiles on that loop**, picked only by the verified token type: staff → **Store Copilot** (standard model tier), customer → **Shopper Assistant** (fast tier). Nothing in a request can choose the profile.
- **MCP only at the ai-service → core-api boundary.** core-api hosts the MCP server (`src/mcp/`); ai-service is the client (`infrastructure/tools/mcp/`). `knowledge_search` stays an in-process tool over the existing RAG pipeline — an MCP hop to our own data would only add latency and a failure mode.
- **Gemini** is the LLM vendor (`LLM_PROVIDER=gemini`, `infrastructure/llm/gemini.py`), behind the same `LLMProvider` seam. The OpenAI adapter gained tool calling too, so switching vendors stays a config change.

## Trust model

`browser cookie → ai-service verifies JWT → ActorContext (tenant, actor, role, the user's own token) → tool call → core-api /internal/mcp/{staff|customer} → InternalServiceGuard + Staff/CustomerMcpGuard → existing Commands/Queries → withTenantContext → RLS`

- **Tenant** comes only from the verified JWT, on both sides. No tool has a tenant/store/user argument; core-api's tool schemas are `.strict()`, so a smuggled `tenant_id` is a validation error. On `/internal/mcp/*`, `McpActorGuard` resolves the tenant from the token's `tenantId` and overwrites anything `TenantResolverMiddleware` set (a dev `X-Tenant-Id` can't redirect a call — tested).
- **Two credentials per MCP request**: `X-Internal-Service-Token` (proves the caller is ai-service; unset = every request rejected) and `Authorization: Bearer <the user's own access token>`. The agent can never do more than the user could by clicking. Bearer tokens are accepted only on these routes; browser routes stay cookie-only.
- **Separate surfaces in separate Nest modules** (`StaffMcpModule`, `CustomerMcpModule`) — CLAUDE.md bug #7.
- **Authorization source of truth is core-api** (guards, ownership checks, RLS). ai-service's `PolicyEngine` is an earlier gate: profile allowlist, role, per-run budgets, and the confirmation requirement.
- **Fail-closed tool catalog**: a tool reaches the model only if it is in ai-service's catalog (`domain/tools/catalog.py`) AND served by core-api for this actor AND both sides agree on argument names/required-ness. Drift hides the tool and logs `tool_schema_mismatch`.
- **Projections, not rows**: every MCP tool returns a purpose-built DTO (`src/mcp/projections.ts`); customer phones are masked for the copilot; descriptions are converted from Editor.js JSON to plain text and capped.

## Tools (v1)

| Profile | Tool | Tier |
|---|---|---|
| both | `knowledge_search` (local) | read |
| copilot | `search_products`, `get_product`, `list_inventory`, `search_orders`, `get_order`, `get_customer` | read |
| copilot | `update_product`, `set_inventory_quantity` | **write, human confirmation** |
| shopper | `search_products`, `get_product`, `get_cart`, `list_my_orders`, `get_my_order` | read |
| shopper | `set_cart_item_quantity` | write, no confirmation (own cart, reversible) |

Not exposed: checkout (the assistant sends the shopper to the cart), cancel/refund/delete (no endpoint or caller exists; the copilot points to the admin page). Every mutating tool **sets an absolute value**, so retrying after a lost response can't double-apply — the cart tool deliberately does not use `CartService.addItem`'s `+=`.

## Confirmation

A `write_confirm` call never runs from the loop. `ConfirmationService.propose()` reads the current values (fresh `get_product`), builds an **ActionCard** server-side (title, before → after), stores the exact validated arguments in `agent_pending_actions` (10-minute expiry) and the run ends with `awaiting_confirmation` — no further model call. `POST /agent/actions/{id}/confirm` from the user's own session moves it `pending → executing` in one conditional UPDATE (a double click runs once), runs the **stored** arguments (the model isn't consulted again) and records the real outcome. Another user, or another store (RLS), gets 404.

## Outcome honesty

Every tool result is a `ToolOutcome` with `succeeded | failed | unknown | rejected | requires_confirmation`, set by our code. A mutation whose response was lost (timeout, transport error, a core-api error after a possible write) is **unknown** — never success, never failure — and the UI says "couldn't confirm". Cards and the activity line are built from outcomes, not from the model's prose.

## Limits and loop safety

Per profile (`application/agent/profiles.py`): iterations (6 / 4), tool calls (10 / 6), mutations, wall clock (45s / 25s), input tokens, output tokens. Reads in one turn run in parallel; at most one mutation per turn. A repeated identical call returns the earlier result once, then ends the run (`loop_detected`). A cut-short run gets one tool-less finalize call. Per-tenant rolling 24h run cap (`AGENT_TENANT_DAILY_RUNS`) is counted in Postgres; an optional platform-wide `LLM_GLOBAL_RPM` protects a shared free-tier quota, and `LLM_TENANT_RPM` caps each store's share of it (checked first, so a store over its own cap never takes a global slot) — one store with many shoppers can't leave every other store "busy". One run per conversation at a time (Postgres lock with expiry; Redis fails open so it can't be the lock). Resends with the same `client_message_id` return the first response.

## Failure model

| Failure | Behaviour |
|---|---|
| Gemini 429/5xx/timeout | one retry on the fallback model, then a "busy" answer (run `failed`, not a 500) |
| core-api MCP down | that run gets no commerce tools (knowledge_search still works); per-surface circuit breaker |
| Bad/expired user token at MCP | tools unavailable for that caller; does **not** trip the shared breaker |
| Tool timeout (read) | retried, then `failed` |
| Tool timeout (mutation) | retried once (idempotent), then `unknown` |
| Invalid model arguments | `rejected` with the validation errors; next iteration escalates to the standard model |
| Unknown/hidden tool | `rejected` |
| Oversized result | lists trimmed, `truncated: true` |
| Vendor safety block | "can't help with that" |

## Persistence & observability

`migrations/0004_agent.sql`: `agent_runs` (status, models, tokens, `cost_usd_micros`, response, trace id), `agent_steps` (every LLM and tool call; sensitive args redacted, results never stored), `agent_pending_actions`; `conversations.active_run_id/locked_until`; `messages.run_id/meta`. All RLS'd like 0001. Spans `agent.run` → `llm.generate` / `tool.execute`; metrics `agent.runs`, `agent.iterations`, `agent.tool_calls`, `agent.cost_usd_micros`, `llm.tokens{kind,model}`. Cost uses `LLM_PRICE_*` (0 on the free tier; tokens are always counted). History replays only user/assistant text — old tool payloads are never re-sent.

## Gemini free tier

Fine for development. Two limits make it unsuitable for real stores: free-tier prompts may be used by Google (never send real customer data through it), and its rate limits are per project, shared by every tenant. Use a separate paid project in production.

## Surfaces

- merchant-admin: the Store Copilot widget calls `POST /agent/chat` and renders action cards with Confirm/Cancel (`@folkshops/ui`'s `ChatWidget` gained `onAction`, `actions`, `activity`).
- storefront: a Shopping assistant widget, shown only when `GET /storefront/store` reports `aiAssistantEnabled` (display only; ai-service checks the plan on every message). It goes through a same-origin `/ai/*` rewrite, as ADR 0011 required, so the customer cookie reaches ai-service.

## Not built

Conversation summarisation (history is a fixed window), streaming, semantic caching (deliberately — answers are personalised), refunds/cancellation tools, a public MCP endpoint for merchants' own clients (would be a separate OAuth surface, never `/internal/mcp`), OpenTelemetry in core-api (traceparent isn't propagated across the hop yet).
