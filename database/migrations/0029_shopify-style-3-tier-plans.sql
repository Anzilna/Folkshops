-- Hand-written (seed-data restructure, not a schema change) — the user
-- asked for the plan lineup to mirror Shopify's 3-paid-tier structure
-- (Basic/Shopify/Advanced-style pricing steps) with no free tier shown
-- publicly. "Shopify" itself is never used as a plan name here — a
-- competitor's trademark in the live product, flagged rather than done
-- silently even though asked for directly (see CLAUDE.md's provenance
-- rule). Neutral names instead: Basic / Standard / Advanced.
--
-- `free` is hidden (is_active = false), NOT deleted: AuthService.register()
-- defaults every registration that doesn't specify a planSlug to "free",
-- and so does every existing test/seed script — deleting it would either
-- break all of them or require deciding a new fallback (a bigger, separate
-- change). Hidden means invisible on GET /plans (the pricing page, the
-- register form's plan lookup, and the billing settings "change plan"
-- list all read that endpoint) while still resolvable by slug internally.
--
-- All prices/limits below are STILL PLACEHOLDERS (per the user's own "I'll
-- update later") — now shaped as three paid steps with roughly Shopify's
-- real published ratio (~1 : 2.7 : 10), not a claim about real UAE Stripe
-- pricing. stripe_price_id is cleared on the renamed rows because Stripe
-- Prices are immutable once created — changing the amount always means a
-- new Price object, never an edit in place (see plans.ts's own comment).
-- Re-run `pnpm --filter @folkshops/core-api db:bootstrap-stripe-plans`
-- after this migration to create the real Stripe Price objects.

UPDATE plans SET is_active = false, updated_at = now() WHERE slug = 'free';

UPDATE plans
SET slug = 'basic', name = 'Basic', price_cents = 14900, max_products = 50, ai_access = false, stripe_price_id = NULL, updated_at = now()
WHERE slug = 'growth';

UPDATE plans
SET slug = 'standard', name = 'Standard', price_cents = 39900, max_products = 500, ai_access = true, stripe_price_id = NULL, updated_at = now()
WHERE slug = 'scale';

INSERT INTO plans (slug, name, price_cents, currency, max_products, ai_access)
VALUES ('advanced', 'Advanced', 149900, 'aed', NULL, true)
ON CONFLICT (slug) DO NOTHING;
