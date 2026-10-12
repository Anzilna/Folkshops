-- Hand-written (RLS enable + seed data, not a schema-structure change
-- drizzle-kit's generator expresses) — same pattern as 0024's RLS-enable
-- migrations and 0026's role/grant migration.

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "subscriptions"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- plans: not tenant-owned, no RLS (same posture as `tenants` itself — see
-- plans.ts's own comment). subscription_customer_lookup: deliberately
-- non-RLS too, same reasoning as payment_order_lookup/membership_lookup
-- (see subscriptions.ts's own comment) — the webhook has no tenant context
-- yet when it needs to read this table.

GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO folkshops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plans, subscription_customer_lookup TO folkshops_app;

-- PLACEHOLDER pricing/limits — user explicitly asked to add this now and
-- update the real numbers later (see docs/decisions/0012's table).
-- stripe_price_id stays NULL here; scripts/bootstrap-stripe-plans.ts
-- creates the real Stripe Price objects (idempotent, safe to re-run) and
-- fills it in afterward — a migration is the wrong place to make a live
-- network call to Stripe.
INSERT INTO plans (slug, name, price_cents, currency, max_products, ai_access) VALUES
  ('free', 'Free', 0, 'aed', 20, false),
  ('growth', 'Growth', 9900, 'aed', 200, true),
  ('scale', 'Scale', 29900, 'aed', NULL, true)
ON CONFLICT (slug) DO NOTHING;
