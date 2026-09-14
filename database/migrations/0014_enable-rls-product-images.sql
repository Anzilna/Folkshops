-- product_images is tenant-owned, same reasoning as products
-- (0004_enable-rls-products.sql), using the nullif(...) empty-string-safe
-- pattern from day one (0002_fix-rls-empty-string-guc.sql).

ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "product_images"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
