-- payment_accounts is tenant-owned, same reasoning as products
-- (0004_enable-rls-products.sql), using the nullif(...) empty-string-safe
-- pattern from day one (0002_fix-rls-empty-string-guc.sql).

ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_accounts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payment_accounts"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
