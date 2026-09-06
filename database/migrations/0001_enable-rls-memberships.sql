-- memberships is the first tenant-owned table. Row-Level Security enforces
-- isolation at the database itself, as a backstop below auth/RBAC/tenant
-- resolution in the app layer (never rely on application code alone).
--
-- FORCE (not just ENABLE) is required: by default Postgres RLS does not
-- apply to a table's owner, and our app connects as that owning role.
-- Without FORCE, every policy below would be silently ignored for all
-- application traffic.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

-- current_setting(..., true) returns NULL (not an error) when unset, and
-- `tenant_id = NULL` evaluates to NULL/false — so a request that forgot to
-- set tenant context sees zero rows rather than every tenant's rows.
CREATE POLICY "tenant_isolation" ON "memberships"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
