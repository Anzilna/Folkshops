-- Hand-written (like 0017/0019's RLS-enable migrations) rather than
-- drizzle-kit generated: the column-drop/add shape here is large enough
-- that drizzle-kit generate's interactive rename-vs-drop prompts can't
-- run non-interactively, and guessing wrong would silently misattribute
-- data. See docs/decisions/0006-payment-gateway.md's Stripe migration
-- addendum — payment_accounts no longer holds any merchant KYC fields at
-- all, Stripe's own hosted onboarding collects them.
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "email";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "legal_business_name";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "business_type";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "contact_name";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "category";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "subcategory";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "pan";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "gst";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "registered_address";
ALTER TABLE "payment_accounts" DROP COLUMN IF EXISTS "status";

ALTER TABLE "payment_accounts" ADD COLUMN "payouts_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "payment_accounts" ADD COLUMN "details_submitted" boolean NOT NULL DEFAULT false;

ALTER TABLE "payment_accounts" ALTER COLUMN "provider" SET DEFAULT 'stripe';
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'stripe';
ALTER TABLE "payment_events" ALTER COLUMN "provider" SET DEFAULT 'stripe';
