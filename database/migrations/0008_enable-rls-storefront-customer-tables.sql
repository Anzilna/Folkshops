-- customers and otp_codes are both tenant-owned, same reasoning as
-- memberships (0001) and products (0004): app-code filtering alone isn't
-- sufficient tenant isolation, so RLS is the database-level backstop.
--
-- Uses nullif(...) from the start (see 0002_fix-rls-empty-string-guc.sql
-- for why a bare cast is wrong on a pooled connection).
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "customers"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otp_codes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "otp_codes"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
