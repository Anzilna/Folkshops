# 0010 — Partial CQRS migration (Products, Payments, Orders, Analytics)

## Context

An explicit request to introduce a Command/Query separation into the backend — `Controller → CommandBus/QueryBus → Command/Query → Handler → existing Service → DbRouter` — without rewriting the app, without DDD/aggregate abstractions, and without moving business logic into handlers. This is deliberately a **partial** migration: 4 of `core-api`'s 18 controllers, plus `apps/analytics`'s query API. Everything else (categories, inventory, customers, cart, all three auth surfaces, storefront store/customer-auth, uploads, notifications, platform-admin) is untouched.

## Decisions

**`@nestjs/cqrs@^11.0.3`, not `^12.0.0`.** Both `apps/core-api` and `apps/analytics` pin NestJS v11. The latest `@nestjs/cqrs` (`12.0.0`) requires `@nestjs/common@^12` — checked directly against the npm registry before installing anything, not assumed. `11.0.3` is the newest release compatible with this codebase's actual Nest version.

**`CqrsModule.forRoot()` imported once per app, in each `AppModule`.** It's `@Global()`, so `CommandBus`/`QueryBus` become injectable everywhere without re-importing — but `@CommandHandler`/`@QueryHandler` classes still must be listed in their own feature module's `providers` array to be discovered at Nest's boot-time explorer scan. Importing `CqrsModule` into every feature module would have been redundant.

**No Repository layer introduced.** `find apps/core-api/src -iname "*.repository.ts"` returns nothing — every Service (`ProductsService`, `OrdersService`, `PaymentsService`) already talks directly to Drizzle via `dbRouter.write()`/`dbRouter.read()` composed with `withTenantContext()`, deliberately (see `docs/decisions/0002-drizzle-orm.md` — Drizzle was chosen specifically so transaction-scoped `SET LOCAL app.tenant_id` control isn't hidden behind an abstraction). Wrapping these same calls in a new `*.repository.ts` with zero independent logic would be an empty layer added purely to match a diagram, or would split one atomic transaction (e.g. `PaymentsService.initiatePayment()`'s idempotency check happening *before* any Stripe call, inside one transaction) across two classes — strictly worse. Services keep doing double duty as business logic *and* persistence, unchanged.

**A new collision risk, distinct from CLAUDE.md bug #7, found and mitigated during this work.** `CommandBus`/`QueryBus` are global singletons whose internal handler map is keyed by the Command/Query **class**, independent of which module registered the handler. `OrdersService` is deliberately provided as two separate DI instances — once in `OrdersModule` (staff, imports `AuthModule`), once in `StorefrontOrdersModule` (customer, imports `StorefrontModule`) — specifically to avoid bug #7's `JwtService` collision. If one shared `GetOrderQuery`/`GetOrderHandler` pair were registered as a provider in *both* modules, the second module's handler would silently overwrite the first in the bus's map at boot, and one auth surface would silently start reading through the other's `OrdersService` instance. Mitigation: staff and customer "get order"/"list orders" got **distinct Query classes** (`GetOrderQuery`/`ListOrdersQuery` for staff, `GetCustomerOrderQuery`/`ListCustomerOrdersQuery` for customer), each registered in exactly one module. `PaymentsService`/`AnalyticsService` don't have this problem — neither is duplicated across modules, so their handlers are registered once each.

**Naming deviates from the request's literal examples where the codebase's own vocabulary already differs.** The request named `CreateOrderCommand`; the actual operation is `OrdersService.checkout()` — named `CheckoutCommand` here instead, since inventing "create order" terminology the code doesn't otherwise use would be confusing, not clarifying (`orders.service.ts`'s own comment: checkout snapshots the cart into an order in one transaction, no inventory decrement, no payment yet — a specific, named business action, not a generic "create").

## What was migrated

| Module | Commands | Queries | Notes |
|---|---|---|---|
| Products | `CreateProductCommand`, `UpdateProductCommand` | `GetProductQuery`, `ListProductsQuery` | Single module, no collision risk — migrated first to validate the wiring pattern. |
| Payments | `InitiatePaymentCommand`, `ProcessPaymentWebhookCommand` | — | Both registered once in the already-shared `PaymentsCoreModule`. Idempotency, the payments-enabled gate, Stripe integration, and the outbox write are all untouched inside `PaymentsService`. |
| Orders | `CheckoutCommand` | `GetOrderQuery`, `ListOrdersQuery` (staff), `GetCustomerOrderQuery`, `ListCustomerOrdersQuery` (customer) | Dual-module split preserved; see the collision-risk decision above. |
| Analytics (`apps/analytics`) | — | `GetRevenueQuery`, `GetTopProductsQuery`, `GetSalesOverTimeQuery` | Elasticsearch aggregations in `AnalyticsService` are untouched; tenant still resolved only via the verified staff JWT, never a query param. |

Every handler is a one-line orchestration body (`execute(query) { return this.service.method(query.tenantId, ...); }`) — no business logic, validation, or transaction handling was duplicated into any handler. Every migrated `DbRouter` consistency level (`"strong"` for `GetProductQuery`/order queries, `"eventual"`+cache for `ListProductsQuery`) is exactly what the underlying Service method already used — this migration changed dispatch, not behavior.

## What was deliberately NOT migrated

- **11 other controllers**: `categories`, `inventory`, `customers`, `cart`, `auth` (staff/platform-admin/customer), `store`, `uploads`, `notifications`, `platform-admin-tenants` — none had a command/query named in the request, and the three auth controllers plus `cart` sit exactly on the `AuthModule`/`StorefrontModule` collision fault line bug #7 already warns about, so touching them for zero named benefit is pure added risk.
- **Within the four migrated modules**: `products` export/import/delete, `orders` export, `analytics` `orders()`/`productPerformance()` stay direct Service calls — CSV-streaming endpoints don't fit the return-a-value Command/Query shape, and no command/query was named for the others.
- **`CancelOrderCommand`/`UpdateOrderCommand`**: not implemented. `OrdersService` has no `update`/`cancel` method — orders "only ever come from a customer's own checkout" (this file's own existing comment). Inventing a command with no backing business operation would be exactly the kind of "abstraction with no caller" this project's own conventions already warn against.
- **`SearchProductsQuery`**: not implemented, for the same reason, discovered during this work — `apps/analytics`'s `SearchService` only has `index()`/`delete()`/`getDocument()` (a by-id lookup), no full-text query method exists anywhere in either app.

This is explicitly **not** "the project is now CQRS" — it's four modules, wired through a bus, with everything else unchanged.
