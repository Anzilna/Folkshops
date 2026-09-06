-- 0001's policy assumed current_setting('app.tenant_id', true) returns NULL
-- whenever tenant context isn't set, making the comparison NULL/false
-- (fail closed). That's only true on a connection that has NEVER had this
-- custom GUC touched. On a real pooled connection — which will have run at
-- least one tenant-scoped transaction — the value reverts to '' (empty
-- string) once the transaction-local SET ends, not NULL. ''::uuid doesn't
-- evaluate to NULL/false, it raises "invalid input syntax for type uuid",
-- turning "forgot to set tenant context" into a 500 instead of zero rows.
--
-- nullif(value, '') normalizes both the true-NULL and the empty-string
-- case to NULL before the cast, so both fail closed identically.
ALTER POLICY "tenant_isolation" ON "memberships"
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
