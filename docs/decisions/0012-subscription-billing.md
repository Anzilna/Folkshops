# 0012 — Platform subscription billing (Folkshops charges merchants)

## Context

Not part of any phase in the original master spec's Build order — this is a new capability the user asked for directly: Folkshops (the platform) charges each merchant a recurring subscription to use the platform, separate from and unrelated to the existing Stripe Connect integration (which routes a *shopper's* payment to a *merchant*, docs/decisions/0006). Scoped via three explicit decisions:

1. **Real Stripe Subscriptions billing**, not a placeholder — a second, independent Stripe integration on the platform's own account (same `STRIPE_SECRET_KEY`, a different API surface: Customers/Subscriptions/Checkout in `mode: "subscription"`, no Connect account involved at all).
2. **Enforce real limits now** — a plan's limits actually block actions, not just display.
3. **Public pricing page → register with plan preselected** — `apps/marketing` gets a `/pricing` page; picking a plan carries it into `apps/merchant-admin`'s existing `/register`.

**Plan names, prices, and limit numbers are explicit placeholders**, provided by the user as "add it, I'll update later" rather than real business decisions — see `PLACEHOLDER` comments at every number. Nothing about the *shape* of the feature depends on these numbers being final; changing them later is an update to one seed script, not a code change.

## Why this is a separate integration from Stripe Connect, not an extension of it

`PaymentProvider` (`payments/payment-provider.interface.ts`) is shaped entirely around Connect: `createCheckoutSession` takes a `connectedAccountId` and routes money *away* from the platform to a merchant's linked account. Subscription billing is the opposite direction — money flows *to* the platform, no connected account exists or is relevant. Bolting subscription methods onto `PaymentProvider` would mean every future alternate Connect-style gateway also has to implement subscription billing methods it has no use for — a violation of interface segregation for no benefit. A new `BillingProvider` interface (`subscriptions/billing-provider.interface.ts`) and `BILLING_GATEWAY` token follow the exact same swap-seam shape, just for a genuinely different capability.

## Schema

- **`plans`** — global catalog, not tenant-owned, no RLS (same posture as `tenants` itself): `slug`, `name`, `priceCents`, `currency`, `maxProducts` (nullable = unlimited), `aiAccess` (bool, stored but not enforced yet — see below), `stripePriceId`, `isActive`.
- **`subscriptions`** — tenant-owned, RLS-enabled, one row per tenant (`uniqueIndex` on `tenantId`, same shape as `payment_accounts`): `planId`, `status` (`incomplete | active | past_due | canceled`), `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd`.
- **`subscription_customer_lookup`** — deliberately non-RLS, same reasoning as `payment_order_lookup`/`membership_lookup`: the Stripe webhook must resolve which tenant a `customer.subscription.*` event belongs to before any tenant context exists, keyed by `stripeCustomerId`.

## Placeholder plans (seeded by migration, update via `scripts/bootstrap-stripe-plans.ts`)

Restructured in migration `0029` at the user's request: no free tier shown publicly, three paid tiers shaped to mirror a well-known competitor's 3-tier pricing structure (~1 : 2.7 : 10 price ratio) **without using that competitor's name** — "Shopify" is a trademark, never used as a plan name in this product even though it was the literal comparison asked for (see CLAUDE.md's provenance rule: flag third-party brand use even when explicitly requested, don't silently do it).

| Plan | Price/mo (AED) | Max products | AI access |
|---|---|---|---|
| Free | 0 | 20 | no — **hidden** (`isActive: false`), see below |
| Basic | 149 | 50 | no |
| Standard | 399 | 500 | yes |
| Advanced | 1,499 | unlimited | yes |

**`free` is hidden, not deleted.** `PlansService.listActive()` (backing `GET /plans` — the pricing page, the register form's plan lookup, and the billing settings "change plan" list) filters `WHERE is_active = true`, so it never appears publicly. `PlansService.findBySlug()` has no such filter, so it's still resolvable — `AuthService.register()` defaults every registration without an explicit `planSlug` to `"free"`, and so does every existing integration test and `db:seed-demo`. Deleting the row outright would require deciding a new no-plan-specified default and touching all of those call sites; hiding it was the deliberately smaller change. Revisit this if the product decision becomes "registration must always require picking a paid plan."

**PLACEHOLDER — user said these will be updated.** To change them: edit the values in `scripts/bootstrap-stripe-plans.ts` and re-run it (creates new Stripe Price objects — Stripe prices are immutable once created, so a price change is always a new Stripe Price id, never an edit to an existing one) and update the `plans` rows.

## What's enforced vs. tracked-only, and why

**Enforced (has a real caller today):** `maxProducts`, checked in `ProductsService.create()` before insert. This is the only limit with an existing code path that creates the resource it would limit.

**Tracked but NOT enforced (no real caller exists yet — rule 30, no abstraction without a caller):**
- **Staff seats** — there is no staff-invitation endpoint in this codebase at all (CLAUDE.md lists this under "Deliberately deferred"); only the owner exists from registration. A seat limit would have nothing to gate.
- ~~**AI access** (`plans.aiAccess`)~~ — **now enforced** (2026-10-01) by `apps/ai-service`, see ADR 0011's "Addendum: plan-gated Store Copilot". AI access requires `aiAccess` **and** a status of `active`/`past_due`, which is stricter than the product limit above (AI calls cost money per request).

**Not built at all:** revoking/downgrading limits when a subscription's payment fails (`past_due`) — a tenant's plan limits apply based on which plan they're on, regardless of payment status, in this first pass. A `past_due` tenant keeps their plan's limits until either payment recovers or the subscription is canceled outright (`customer.subscription.deleted` sets `status = 'canceled'`, at which point... there is currently no fallback-to-free-plan-limits step either — flagged here rather than silently assumed to work).

## Flow

```
apps/marketing: GET /pricing
  → fetches GET /plans (public, core-api) → renders real plan cards, real placeholder numbers
  → "Get started" links to merchant-admin /register?plan=<slug>

apps/merchant-admin: /register?plan=growth
  → register-form shows the selected plan
  → POST /auth/register { ...fields, planSlug: "growth" }
      → AuthService.register(): creates tenant+user+membership (unchanged) in the same
        transaction, THEN creates a `subscriptions` row:
          - free plan → status: "active", no Stripe call
          - paid plan → status: "incomplete", Stripe Customer created, response includes
            checkoutUrl
  → if checkoutUrl present, browser redirects to Stripe's hosted Checkout (subscription mode)
  → Stripe webhook (`checkout.session.completed`, mode=subscription) → subscriptions.status = "active",
    stores stripeSubscriptionId/currentPeriodEnd

apps/merchant-admin: /settings/billing (new)
  → GET /subscriptions/me → plan, status, product usage vs. limit
  → "Manage billing" → POST /subscriptions/portal-session → Stripe's hosted Billing Portal
  → "Change plan" → POST /subscriptions/change-plan { planSlug } → updates the Stripe
    subscription's price directly (proration), or starts Checkout if moving off "free"
```

## Webhook

`POST /subscriptions/webhooks/stripe` — a **separate endpoint and a separate signing secret** (`STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET`) from the existing Connect webhook (`POST /payments/webhooks/stripe`), for the same reason ADR 0009 keeps CDC and business-event Kafka consumers structurally separate: these are different concerns with different event vocabularies, and Stripe itself requires one signing secret per registered endpoint anyway. `SubscriptionsWebhookController`/`StripeBillingSignatureGuard` are near-identical copies of the existing `PaymentsWebhookController`/`StripeSignatureGuard` shape — same `req.rawBody` requirement, same "always ACK 200 once the signature is valid" posture.

Events handled: `checkout.session.completed` (mode=subscription) → activate; `customer.subscription.updated` → sync `status`/`currentPeriodEnd`; `customer.subscription.deleted` → `status = "canceled"`.

## Failure modes

- **Stripe down during registration**: tenant/user/membership creation still succeeds (that transaction doesn't touch Stripe at all); only the Checkout Session creation call can fail, which surfaces as a clear error rather than a half-created tenant.
- **Webhook never arrives** (network blip, Stripe retries exhausted): the subscription stays `incomplete` — the merchant is registered and logged in, but the settings page would show "payment not completed." No automatic reconciliation job exists yet; would need one for production (documented gap).
- **Product limit check race** (two concurrent `POST /products` right at the limit): not made transactionally atomic against the count check in this pass — a documented, accepted gap for a placeholder limit, not something to solve with row locks yet.
