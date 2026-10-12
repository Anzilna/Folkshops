-- Read-only, column-level access to core-api's billing tables so this
-- service can check a tenant's plan entitlement (plans.ai_access) on every
-- request without calling core-api over HTTP — see
-- app/application/entitlements.py and docs/decisions/0011's addendum.
--
-- Column grants, not table grants: folkshops_ai sees which plan a tenant is
-- on and whether it's paid up, never Stripe customer/subscription ids or
-- prices. `subscriptions` is RLS-enabled (core-api migration 0028), so the
-- tenant_context() this service already sets scopes it to one tenant.
GRANT SELECT (tenant_id, plan_id, status) ON subscriptions TO folkshops_ai;
GRANT SELECT (id, slug, name, ai_access) ON plans TO folkshops_ai;
