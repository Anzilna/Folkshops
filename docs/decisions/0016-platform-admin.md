# 0016 — Platform admin: operating the platform

Status: accepted, built and verified (2026-10-02). Extends ADR 0003 (tenancy) and ADR 0012 (billing).

Platform admin is the internal Folkshops staff app (`apps/platform-admin`, `core-api/src/platform-admin/`). Until now it had a login, a read-only tenant list and a backend dashboard summary that nothing displayed; its `Settings` page was "coming soon" and `suspended` was a status nothing set or enforced. This ADR records what it does now and why.

## What it does

| Page | Backend | Notes |
|---|---|---|
| Dashboard | `GET /platform-admin/dashboard` (+ SSE `/stream`) | KPI strip (MRR hero, stores, active subs, past due), stores-per-plan bars, subscription-health bar, recent stores. Live over one shared EventSource. |
| Tenants | `GET /platform-admin/tenants`, `GET :id`, `POST :id/suspend`, `POST :id/reactivate` | List adds plan + subscription status. Detail: owners, plan, usage, payments, history. |
| Plans | `GET /platform-admin/plans` | **Read-only**: a price is bound to an immutable Stripe Price, so changing one is a billing operation (`bootstrap-stripe-plans.ts`), not a form. Never exposes Stripe ids. |
| Activity | `GET /platform-admin/audit-log` | The audit log, newest first, filterable. |
| Team | `GET/POST /platform-admin/admins`, `DELETE :id` | Add/remove admins. |
| Settings | `POST /platform-admin/auth/change-password` | Own account. |

The header bell is fed by `GET /platform-admin/activity`: recent `outbox_events` (store registered, subscription activated/past due/canceled, payments live) merged with audit entries. That needs **no new publishing code** — those events were already written for the email pipeline. Read state is per browser (localStorage), because the feed is a shared stream with no per-admin rows. The old canned notifications and the canned "Platform Copilot" were removed: the only assistant this project has is tenant-scoped, and a canned one invents numbers.

## Suspension is enforced, in layers

A suspended store (`tenants.status = 'suspended'`, with an INTERNAL `suspension_reason` the merchant never sees) is refused at several independent points, none relying on another:

1. **`StoreAvailableGuard`** (global `APP_GUARD`, `tenancy/`): any request that resolves to a suspended store — storefront, staff and customer auth, catalog — gets `403 {code: "store_suspended"}` before a controller runs. `TenantContext` now carries `status`, so the guard can refuse with a reason instead of every route seeing "no store". Logout (`@AllowSuspendedStore()`) still works so people can clear their cookies.
2. **`AuthService.login/refresh`** re-check on their own, so a token is never *issued* for a suspended store even if called from somewhere the guard doesn't cover.
3. **Suspending revokes every refresh token for the store** (staff and customers) in the same transaction as the status change and the audit entry.
4. **`McpActorGuard`** (the AI tool endpoints identify the store from the token, not a hostname, so layer 1 never sees them) refuses a non-active store.
5. **ai-service** `EntitlementService` starts from `tenants` (a column grant on `id, status` only — migration 0005) and returns `tenant_suspended` → 403 on both AI surfaces.

Residual: `apps/analytics` verifies the staff JWT itself, so a suspended store's already-issued access token can still read analytics for the rest of its 15-minute life (it can't refresh). Not closed because nothing sensitive is mutable there; recorded here so it isn't a surprise.

Frontends: merchant-admin sends a signed-in user to `/suspended` (its layout and middleware would otherwise redirect-loop between `/login` and `/`), and shows the message inline on the login form; the storefront renders a "temporarily unavailable" page. Neither shows the reason.

## Audit log

`platform_audit_log` (migration 0032): who, what, to what, when, and metadata (the reason). Global, no RLS. **No foreign keys on purpose** — an audit record must outlive what it describes — so `admin_email` and `target_label` are snapshots. Insert-only: the service has no update/delete. `record()` takes the caller's transaction, so an action and its record commit or roll back together. Actions: `tenant.suspended`, `tenant.reactivated`, `admin.created`, `admin.removed`, `admin.password_changed`. Reactivation records the previous reason, so clearing it from the tenant row doesn't erase why it happened.

## Team management and admin security

- **No roles.** Every admin is equal (still the deliberate state; add roles when a second capability needs restricting), so any admin may add or remove another. There is no invitation email: the creating admin sets a temporary password and hands it over; the new admin changes it in Settings.
- **A removed admin loses access on their next request.** `PlatformAdminJwtAuthGuard` now checks the admin still exists (one primary-key lookup per request) instead of trusting a JWT that stays valid for 15 minutes. Removal also revokes their refresh tokens.
- **Never zero admins.** `remove()` locks every admin row `FOR UPDATE … ORDER BY id` and refuses if only one is left; two admins removing each other at once serialize (and the fixed order means they can't deadlock). You can't remove yourself.
- **Change password** verifies the current one, revokes every refresh token for the account, then issues a fresh session to the browser that did it. Other devices' access tokens work for their remaining minutes (a JWT can't be recalled) but can't refresh. Passwords max 72 chars — bcrypt silently truncates beyond that.
- Login and change-password are throttled; admin email lookup is case-insensitive.

## Bugs found while building it

- **A stray `app/page.tsx` (Next's scaffold) shadowed `app/(dashboard)/page.tsx`**: signing in landed on a bare "Folkshops Platform Admin" heading with no shell. It was removed.
- **`PaginationQueryDto.sortDir` defaults to `"asc"`**, so "no direction given" can't be told from "asc requested". The audit log therefore returned oldest-first until it was changed to default to newest unless a `sortBy` is explicit.
- **`Card` always applies `p-6`** and a `p-0` passed alongside doesn't reliably win, double-padding any card laying out its own sections. Platform admin uses a padding-free `Panel` for those.

## Not built

Roles/permissions; emailing a merchant when their store is suspended or reactivated (the outbox + email pipeline makes it one event and one template when wanted); editing plans; impersonating a store; 2FA for platform admins; a platform-level assistant.
