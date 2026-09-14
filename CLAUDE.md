# Folkshops — project context for Claude

India-first, multi-tenant e-commerce SaaS platform (Shopify-like). This file exists so a **new chat session starting cold in this repo has full context** without the user re-explaining the project. Read this before doing anything else here.

## Governing principles (from the original master spec)

- **Build in phases, incrementally.** Don't implement a later phase's tech (Kafka, Debezium, advanced AI, K8s autoscaling, custom domains, etc.) before its dependencies exist. See "Build order" below.
- **Explain before implementing.** For any new technology/component: what it is, what problem it solves, why Folkshops needs it now (not later), what alternative was passed over, where it sits architecturally, what happens if it fails, how it scales.
- Every technology must have a concrete reason. Never add something to look sophisticated.
- **Tenant isolation is layered, never single-mechanism**: authentication → membership → RBAC → tenant resolution → PostgreSQL RLS. Never rely on application code alone. The same "layered, never single-mechanism" idea extends to auth *itself*: staff/platform_admin/customer each get their own JWT secret and cookie pair, not one shared secret with a role field — see "Three separate auth surfaces" below for why.
- Before modifying existing code: inspect what's actually there. Never assume a file/table/env var/service exists.
- Two repos: `folkshops-app` (this repo — frontends, backend, migrations, tests) and a separate `folkshops-infra` (Terraform/Helm/Argo CD) — not created yet, out of scope until Phase 6.
- Don't add features, abstractions, or guards that have no caller yet (see "Deliberately deferred" below) — but don't leave things half-finished either.
- Never use copyrighted/third-party content (competitor UI illustrations, other brands' product photography) in the actual product — flag it before wiring it in, even if asked directly. Payment network logos (Visa/UPI/RuPay) are the one common exception: displaying them to indicate accepted payment methods is standard, widely-permitted practice.

## Repository layout

```
apps/            marketing, storefront, merchant-admin, platform-admin (Next.js — see status below, no longer placeholders),
                 core-api (NestJS — the only service that touches Postgres/Redis), ai-service, workers (still placeholders)
packages/        shared build-time packages — ui (real: theming, ThemeToggle), api-client, types, validation, config, analytics, tool-contracts (still placeholders)
database/        migrations/ (Drizzle-generated + hand-written SQL), init/ (Postgres bootstrap), rls-tests/ (standalone test package), seeds/, functions/
docs/decisions/  numbered ADRs — read these for the "why" behind every non-obvious choice
```

Root `README.md` has the up-to-date local dev setup commands (including the optional Dockerized `core-api`). Follow it, don't re-derive it.

## Current status (mid-Phase 1)

**Backend (`apps/core-api`) — built and verified live:**

- Monorepo: pnpm workspaces + Turborepo. Drizzle ORM on raw `pg.Pool`, not Prisma (`docs/decisions/0002-drizzle-orm.md`).
- Tenancy + RLS (`docs/decisions/0003-tenancy-rls.md`): `tenants`/`users`/`memberships`, RLS enforced on every tenant-owned table.
- Primary/replica DB routing (`docs/decisions/0005-primary-replica-routing.md`): `DbRouter.write()` / `.read("strong"|"eventual")`. No real replica exists — both env vars point at the same Postgres, deliberately.
- `products` module: public `GET`, authenticated `POST`/`PATCH`/`DELETE`. `list()` is `"eventual"` + cached (see Redis below); `findById()` and tenant resolution stay `"strong"`/uncached on purpose — both documented in their own files as needing fresh reads, don't "fix" this by caching them. Products now have a nullable `categoryId` FK.
- `categories` module: same public-read/authenticated-write shape as `products`. Flat (no parent/subcategory tree) and a single `categoryId` per product rather than a many-to-many join table — neither has a caller yet, add them when one exists.
- `inventory` module: staff-only, no public read. One row per product, a plain `quantity` counter — **not** a reservation/hold system (that's Phase 2, see Build order). `PATCH /inventory/:productId` upserts and verifies the product belongs to the tenant first.
- `cart`/`orders` modules (storefront, customer-auth only): one active cart per customer (no guest carts). `POST /storefront/orders/checkout` snapshots the cart into an order (`order_items` stores product name/price at checkout time, not a live join) in one write transaction, then clears the cart. No inventory decrement, no payment, no state machine beyond `pending`/`cancelled` — all Phase 2. Staff read tenant orders via `GET /orders`; customers read their own via `GET /storefront/orders`. **Note:** `OrdersModule` (staff) and `StorefrontOrdersModule` (customer) are deliberately two separate NestJS modules, not one — see bug #7.
- **Three separate auth surfaces**, each with its own JWT secret and cookie pair (`auth-cookies.ts`) so none can be replayed against another — this is deliberate, not duplication:
  - **Staff** (`/auth/*`) — email+password, tenant-scoped via `memberships`, cookies `fk_access_token`/`fk_refresh_token`.
  - **Platform admin** (`/platform-admin/auth/*`) — email+password, global (no tenant), own `platform_admins` table, no self-service signup (`scripts/bootstrap-platform-admin.ts` is the only way in), cookies `fk_pa_access_token`/`fk_pa_refresh_token`.
  - **Customer** (`/storefront/auth/*`) — phone + OTP, own `customers` table (tenant-scoped), `OtpProvider` interface with `ConsoleOtpProvider` for dev (real SMS vendor not chosen yet), cookies `fk_customer_access_token`/`fk_customer_refresh_token`.
  - Shared: `TokenService` (rotation-on-use refresh tokens, stored hashed in `refresh_tokens` — not RLS-protected, see that table's own comment for why), `TokensModule`, cookie helpers. Access tokens are 15 min, refresh 30 days.
  - `auth/`, `platform-admin/`, `storefront/` are each organized into `guards/`, `decorators/`, `dto/` subfolders — keep new files in the matching subfolder, don't go back to flat.
- **Redis** — first real usage (container existed in `docker-compose.yml` since Phase 1 setup, unused until now): `RedisThrottlerStorage` (atomic Lua-script rate limiting on the OTP-request route, survives multiple pods, fails open if Redis is down) and `CacheService` (cache-aside, applied only to `ProductsService.list()`).
- `core-api` can optionally run in Docker (`docker compose up -d --build core-api`) with hot-reload via a bind mount — see README. Native `pnpm dev` still works and is unaffected; don't run both at once (port 4000 conflict).
- `database/rls-tests` and `apps/core-api`'s own unit + integration suites (`pnpm test`, `pnpm test:integration`) all pass. CI (`.github/workflows/ci.yml`) runs a real Postgres + Redis service container.

**Frontend — no longer placeholders:**

- All four Next.js apps (`marketing`, `storefront`, `merchant-admin`, `platform-admin`) are real Next.js 15 + Tailwind v4 apps with **fixed local dev ports**: storefront=3000, merchant-admin=3001, platform-admin=3002, marketing=3003 (`package.json`'s `dev` script on each). `core-api`'s `CORS_ORIGINS` must list whichever of these are actually running.
- `packages/ui`: real theming (`ThemeProvider`/`useTheme`/`ThemeToggle`/`ThemeScript`, CSS vars in `theme.css`) **plus a shared component set** exported from one barrel (`import { ... } from "@folkshops/ui"`): `DataTable` (server-driven pagination/sort/filter/search, row selection, CSV export/import, row-action slot — knows nothing about auth/tenant/base URL, each app passes `fetcher`/`exportFetcher`/`importFetcher` built by its own `lib/api.ts`'s `createTableFetcher`/`createExportFetcher`/`createImportFetcher`), `Button` (5 variants), `Input`/`Select`/`Checkbox`/`Label`, `Modal`, and a browser-side `parseCsv`. `theme.css` also has `destructive`/`success` token pairs. **Every list page in every app must use `DataTable`** — don't hand-roll a table. See bug #9 before adding a new consuming app. `merchant-admin`/`platform-admin` follow the OS light/dark setting + have a manual `ThemeToggle` in their navbar; `storefront`/`marketing` are **light-only by permanent design decision** (not "for now") — don't add theme switching there without being asked again.
- **`merchant-admin`**: full login UI, working end-to-end — `/login` (store slug + email + password, since local dev has no real subdomain to resolve the tenant from — see `lib/api.ts`'s dev-only tenant-slug cookie), a `(dashboard)` route group whose `layout.tsx` does the real auth check once (via `/auth/me`) for every page in it, `middleware.ts` for the cheap cookie-presence redirect (matcher excludes static files — a real bug was found and fixed here: anonymous asset requests were getting redirected to `/login`). Sidebar + navbar shell (`dashboard-shell.tsx`) with nav icons, active-item accent bar, `ThemeToggle`, logout. Dashboard has 5 onboarding cards (Shopify-checklist-style, real images from `public/`, tilted/oversized "bleed past the card edge" treatment) — some cards still use temporary stand-in images pending real assets (see `page.tsx`'s `TODO` comments: original `name-tag`/`chrome-cursor`/`box-in` images were deleted per a copyright concern and not yet replaced).
- **`platform-admin`**: same architecture as merchant-admin, simplified (no tenant slug — platform admins are global). `/login` (email + password only), same route-group + middleware pattern, sidebar with Dashboard/Tenants/Settings (the latter two are honest "Coming soon" pages).
- **`storefront`**: still just the Tailwind-scaffolded placeholder — the OTP login UI (phone → code, two-step form) has **not** been built yet. This is the next planned piece.
- **Design skills live in `.claude/skills/`** (`animate`, `apple-design`, `emil-design-eng` — exported from the user's claude.ai account; `animate/RECIPES.md` is a stub until it's exported too). Invoke them for any motion or component-polish work. Their rules are already baked into `packages/ui`: strong easing tokens override Tailwind's `--ease-out`/`--ease-in-out` in `theme.css` (so every `ease-out` utility is the strong curve), transitions always name their properties (never `transition-all`), pressables get `active:scale-[0.97]`, surfaces enter from `scale(0.96–0.97)+opacity` and exit the same path via `usePresence()` (transitions, not keyframes, so rapid toggles retarget), popovers set `transform-origin` at their trigger (modals stay centered), hover motion is gated by `(hover: hover) and (pointer: fine)`, and every motion collapses to opacity-only under `prefers-reduced-motion` (`.fk-presence`). UI durations stay ≤ 200ms except modals (200 in / 150 out). Run a review against `emil-design-eng`'s Before/After table before shipping new UI.
- Image/asset provenance matters here: only use real images the user has explicitly provided and confirmed rights to, or fully original assets (flat SVG illustrations) — never reuse another product's/brand's actual UI illustrations or product photography without an explicit confirmation. Two rounds of this exact judgment call happened this session; check before reusing anything that looks like a screenshot or real photography.

- **Both admin apps render `@folkshops/ui`'s `AdminShell`** (sidebar + top bar) — each app's `dashboard-shell.tsx` is now a ~40-line wrapper passing nav items, brand, its own `LogoutButton`, `ThemeToggle`, `next/link`, and `usePathname()`. The shell owns the breadcrumb bar (`useBreadcrumbs([...])` in a page publishes the trail; fallback is brand / active nav label), the notification bell and the floating chat. **Bell and chat are UI-only previews with canned data** (`demoNotifications()`, canned `reply()` in `chat-widget.tsx`) — notifications are Phase 2 (outbox/BullMQ), the copilot is Phase 3; don't wire either to anything until then.
- **merchant-admin list pages are all real** (`products`, `categories`, `inventory`, `customers`, `orders` — Inventory was added to the sidebar), each a client component on `DataTable`. **CRUD is page-based, never a modal**: `/<resource>/new` and `/<resource>/[id]` share one `*-form.tsx` (auto-slug from name until the slug is edited); `/orders/[id]` is a read-only detail page. Inventory edits quantity inline (no create/delete — a row appears when a quantity is first set). Customers' phone is create-only (OTP login identity). Row click navigates to the edit page. **Every destructive action goes through `ConfirmDialog`** (single delete, bulk delete, CSV import) — no `window.confirm`. `lib/hooks.ts` has `useTenantSlug`/`useResource`, `lib/format.ts` the money/date formatters.
- **Demo data:** `DATABASE_PRIMARY_URL=... pnpm --filter @folkshops/core-api db:seed-demo` seeds store `demo` (login: slug `demo`, `owner@demo.test`, `Password123!`) with 180 products/75 customers/120 orders; re-running wipes and reseeds. Use it before judging any table/pagination change.
- **platform-admin `/tenants`** is real: read-only list of every store with status filter/search/export. No create (tenants come from `POST /auth/register`), no import.
- **Backend list endpoints are all paginated/sortable/filterable** (`?page&limit&sortBy&sortDir&search` + per-resource filters, response `{data,total,page,limit,totalPages}` — `src/common/`), each with `GET /<resource>/export` (CSV) and, where it makes sense, `POST /<resource>/import` (`{rows:[...]}` validated per-row against the resource's own Create DTO, one insert per row, per-row errors returned). **No import on orders or tenants — deliberate**, see the comments in `OrdersService`/`TenantsService`. `ProductsService.list()` is **no longer cached** (every filter/sort/page combo is a distinct key and `CacheService` can't wildcard-invalidate) — `CacheService` currently has no consumer; leave it, Phase 2 will.

**Not built yet anywhere:** storefront cart/checkout/orders **UI** (customer-side backend is done); storefront OTP UI, marketing site content; `RolesGuard`/`@Roles()` enforcement (see Deferred). No automated browser tests — the admin tables were verified with a throwaway Playwright script + screenshots, not a checked-in suite.

## Real bugs found (know these before touching auth/RLS/guards/Redis again)

Full detail on #1-3 in `docs/decisions/0003-tenancy-rls.md`. All of these were caught by actually running the thing, not by code review — keep doing that.

1. **The Postgres role must never be a superuser** — `folkshops_app` (app runtime) must stay `NOSUPERUSER NOBYPASSRLS`; migrations run as the separate `folkshops` owner role. Never point `DATABASE_PRIMARY_URL`/`DATABASE_REPLICA_URL` at the owner role.
2. **`current_setting('app.tenant_id', true)` returns `''`, not `NULL`, on a reused pooled connection.** Any new RLS policy must use `nullif(current_setting('app.tenant_id', true), '')::uuid` — see `database/migrations/0002_fix-rls-empty-string-guc.sql`.
3. **`AuthModule` must export `JwtModule` itself, not just its guards** — any module importing it purely for the guards needs `JwtService` resolvable too, or `UnknownDependenciesException` at boot.
4. **Next.js middleware matchers must exclude static files.** A matcher like `"/((?!_next/static|_next/image|favicon.ico).*)"` still catches `/products/whatever.svg` under `public/` — anonymous asset requests were getting redirected to `/login`. Harmless in practice (a real browser sends the session cookie alongside the page requesting the image) but wasteful and not what the guard is for. Fix: exclude any path with a file extension, e.g. add `|.*\..*` to the negative lookahead. Applied in both `merchant-admin` and `platform-admin`'s `middleware.ts`.
5. **A `next dev` process can get into a corrupted hot-reload state** (`__webpack_modules__[moduleId] is not a function`) after rapid file deletions/renames in the same session. Not a code bug — `kill -9` the stale process and `rm -rf apps/<app>/.next` before restarting.
6. **`rm -f` on a file does not go through macOS Trash and is not recoverable if never committed to git.** Confirm before deleting user-provided assets that aren't yet committed — there is no undo.
7. **A NestJS module importing two `JwtModule.registerAsync(...)` registrations (e.g. both `AuthModule` and `StorefrontModule`) silently breaks auth for one of them.** `@nestjs/jwt` always registers `JwtService` under the same DI token, so when two differently-secret'd `JwtModule`s are both in scope, Nest resolves one `JwtService` for the whole module instead of erroring — every guard in it uses whichever one won, not necessarily the one it needs. Caught when `POST /storefront/orders/checkout` (customer-auth) failed with "invalid signature" using a token that verified fine on `/storefront/auth/me`, because the original single `OrdersModule` imported both `AuthModule` and `StorefrontModule`. Fix: one module per auth surface — split into `OrdersModule` (staff) and `StorefrontOrdersModule` (customer), matching the three-separate-auth-surfaces architecture rather than working around the collision. If a module ever needs guards from two different auth surfaces, split it instead of importing both.
8. **The global `ValidationPipe`'s whitelist silently strips any request field a DTO doesn't declare** — it's not a validation error, the field just disappears. Adding a new column (e.g. `products.categoryId`) requires adding it to the relevant DTOs too, or writes silently ignore it. Caught by actually POSTing the field and seeing `null` come back.
9. **Tailwind v4 does not scan `node_modules`, and `@folkshops/ui` resolves through the pnpm workspace symlink there.** Any class used *only* inside a shared component (`hidden` on DataTable's file input, `h-9`, `rounded-2xl`, ...) is silently never generated and the component renders unstyled — `tsc` and `next build` both pass. Both admin apps' `globals.css` now carry `@source "../../../packages/ui/src";` — a new app consuming `@folkshops/ui` needs the same line. Caught only by screenshotting the real page in a browser (Playwright via `npx playwright`, `channel: "chrome"`); do that for UI work, a green build proves nothing about styling.
10. **Never run `next build` while `next dev` is serving the same app.** Both write to that app's `.next/`; the build wipes the dev server's manifests mid-run (`routes-manifest.json` ENOENT, every route 500s until you kill it, `rm -rf .next`, restart). While a dev server is up, verify with `npx tsc --noEmit -p tsconfig.json` + `npx eslint` instead — they touch nothing.
11. **A `page.tsx` may only export the page (plus Next's config fields).** Exporting a shared helper/badge/type from one fails `next build` with "X is not a valid Page export field". Shared bits go in a sibling module (`orders/order-shared.tsx`, `lib/format.ts`).
12. **A transformed ancestor becomes the containing block for `position: fixed` descendants.** `.fk-fade-in` (the route-content wrapper) originally used `animation-fill-mode: both`, which leaves `transform: translateY(0)` applied forever — so a `ConfirmDialog` rendered inside a page centered on the page div, not the viewport (it sat at the bottom of the screen). Fixed with `fill-mode: backwards`. Rule: never leave a `transform`/`filter`/`backdrop-filter` on any wrapper that pages render into; if a fixed element ever positions wrong, look up the tree for one.
## Local dev quick reference

```bash
pnpm install
docker compose up -d                                    # Postgres + Redis (core-api optionally too, see README)
cp apps/core-api/.env.example apps/core-api/.env         # + platform-admin/merchant-admin's own .env.example
pnpm --filter @folkshops/core-api db:migrate             # schema-owner role
pnpm --filter @folkshops/core-api dev                    # app role — or run it in Docker instead, not both (port 4000)
pnpm --filter @folkshops/storefront dev                  # :3000
pnpm --filter @folkshops/merchant-admin dev               # :3001
pnpm --filter @folkshops/platform-admin dev               # :3002
pnpm test                                                # unit + mandatory RLS suite
pnpm --filter @folkshops/core-api test:integration       # real Postgres + Redis integration suite
```

Dev-only tenant resolution override: `X-Tenant-Id: <slug>` header (never honored when `NODE_ENV=production`; `merchant-admin`'s frontend sends this automatically via a cookie set at login — see `lib/api.ts`). Production resolves tenant from the hostname subdomain.

To get a test account: `POST /auth/register` (merchant), `pnpm --filter @folkshops/core-api db:bootstrap-platform-admin` (platform admin — see the script's header comment for required env vars), OTP via `ConsoleOtpProvider` logs the code to the `core-api` console instead of sending a real SMS.

## Git workflow

- `main` — baseline. `develop` — integration branch, phase branches merge back in.
- Remote: `https://github.com/Anzilna/Folkshops.git`.
- **Never add a Claude/Anthropic co-author line to commit messages** (explicit user instruction) — **superseded 2026-09-08 by a harness-level attribution setting that requires the opposite** (`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` on commits, a Claude Code footer on PRs). If a session sees a system-reminder about commit/PR attribution, follow it — it's the more current instruction. If neither signal is present, ask rather than assume.
- Check `git status`/`git log` yourself rather than assuming anything is saved — don't treat this file as proof something is committed. (As of this writing everything described above through the categories/inventory/cart/orders backend is committed on `develop`; `apps/merchant-admin/public/dashboard/{name-tag,chrome,box}.png` are a deliberate exception — flagged copyright-risk assets left untracked on disk, not in any commit.)

## Build order (what's next)

Per the master spec's phasing — current position is mid-**Phase 1**:

1. **Phase 1 (Foundation)** — auth/tenancy/RBAC/RLS/products/categories/inventory/cart/orders **backend** done. Auth now spans all three surfaces (staff/platform_admin/customer) with real login UIs for merchant-admin and platform-admin. **Remaining**: storefront's OTP login UI and storefront cart/checkout/orders UI (merchant-admin's management UI for products/categories/inventory/customers/orders is done); marketing site content.
2. **Phase 2 (Commerce Hardening)** — Razorpay test integration, webhooks, idempotency, order state machine, inventory reservation, BullMQ, outbox pattern, notifications, search. (Redis itself is already in use for rate limiting/caching — BullMQ and other Phase 2 Redis uses are still not started.)
3. **Phase 3 (AI)** — Shopper Agent, Tool Registry, SSE, Merchant Copilot, guardrails, MCP.
4. **Phase 4 (Analytics/Marketing)** — event tracking, campaigns, attribution, affiliates, SMS/WhatsApp/email (this would be the natural home for a *real* OTP SMS provider decision, though OTP login itself is already Phase 1).
5. **Phase 5 (Scale)** — Kafka, Debezium/CDC, Elasticsearch pipeline, read replicas, HPA/KEDA/Karpenter. This is also when a Redis-backed (rather than in-memory) rate-limiter would matter for multiple `core-api` pods — already anticipated in `RedisThrottlerStorage`'s design, not yet needed since only one instance runs today.
6. **Phase 6 (GitOps)** — separate `folkshops-infra` repo: Terraform, Helm, Argo CD.

Don't jump ahead — each phase assumes the previous one's tables/services exist.

## Deliberately deferred (not bugs, not forgotten)

- `tenant_domains` table / custom domains — subdomain-only resolution for now.
- `RolesGuard`/`@Roles()` route-level RBAC — role data exists on `memberships`/JWT, but no route needs it yet. Platform admin has no role concept at all yet (every platform admin is identical) — add one only once a second internal admin capability actually needs restricting.
- Staff invitations. (A demo seed script exists now — `db:seed-demo` — but there are no per-environment/fixture seeds beyond it.)
- Real RDS Read Replica — `DbRouter` is ready, none exists.
- Real SMS provider for OTP (MSG91/Twilio/AWS SNS) — `ConsoleOtpProvider` logs to console in dev/CI; swap the `OTP_PROVIDER` binding in `storefront.module.ts` once one is chosen.
- Automated tests for the newer auth/Redis logic beyond the integration suite already written — most of the frontend UI work (merchant-admin/platform-admin dashboards) has been verified live/manually (curl + real login cycles), not via an automated browser test suite.
- Refresh-token cleanup job (`refresh_tokens` grows forever, nothing prunes expired/revoked rows yet) and OTP verify-attempt limiting (only the resend cooldown is rate-limited, not brute-force attempts against one still-valid code) — both flagged, neither fixed.
