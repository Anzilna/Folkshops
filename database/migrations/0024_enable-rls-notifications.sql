-- notifications is tenant-owned, same reasoning as products/payments
-- (0004_enable-rls-products.sql / 0017_enable-rls-payments.sql), using the
-- nullif(...) empty-string-safe pattern from day one
-- (0002_fix-rls-empty-string-guc.sql).
--
-- outbox_events gets NO policy here, deliberately — see its own schema
-- comment (database/schema/outbox-events.ts): apps/workers' relay scans
-- across every tenant with no established tenant context, the same reason
-- membership_lookup/payment_order_lookup have none either.

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "notifications"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
