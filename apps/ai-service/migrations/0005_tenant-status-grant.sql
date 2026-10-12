-- Read-only, column-level access to whether a store is suspended, so the
-- entitlement check can stop AI for a suspended store without an HTTP call
-- back to core-api (same approach and reasoning as 0002, see
-- app/application/entitlements.py). `tenants` has no RLS — it is the registry
-- RLS keys off — so this grant exposes id + status only: not the store's
-- name, slug, or the internal suspension reason.
GRANT SELECT (id, status) ON tenants TO folkshops_ai;
