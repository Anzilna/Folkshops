-- payments/payment_events are tenant-owned, same reasoning as products
-- (0004_enable-rls-products.sql), using the nullif(...) empty-string-safe
-- pattern from day one (0002_fix-rls-empty-string-guc.sql).
--
-- payment_order_lookup gets NO policy here, deliberately — see its own
-- schema comment (database/schema/payment-order-lookup.ts): it must be
-- queryable before any tenant context exists (a webhook resolving which
-- tenant a Razorpay order belongs to), the same reason membership_lookup
-- has none either.

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payments"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payment_events"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
