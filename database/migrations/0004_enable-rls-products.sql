-- products is tenant-owned, same reasoning as memberships
-- (0001_enable-rls-memberships.sql): app-code filtering alone isn't
-- sufficient tenant isolation, so RLS is the database-level backstop.
--
-- Uses nullif(...) from the start, not the bare cast 0001 originally
-- shipped with — current_setting('app.tenant_id', true) returns '' (not
-- NULL) on a pooled connection that has previously had tenant context
-- set, and '' :: uuid throws rather than failing closed. See
-- 0002_fix-rls-empty-string-guc.sql for the incident this pattern fixes.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "products"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
