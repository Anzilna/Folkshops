import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Tenant-owned, RLS-enabled, at most one row per tenant (uniqueIndex
 * below) — a store's Stripe Connect account connection. No secrets stored
 * here: a connected account is created/called using the *platform's own*
 * STRIPE_SECRET_KEY (env var) — this table only stores the Connect
 * account id Stripe returns and its cached capability flags, nothing
 * sensitive enough to need encryption at rest.
 *
 * Deliberately holds none of a merchant's business/KYC details — unlike
 * the old Razorpay Route flow (see docs/decisions/0006-payment-gateway.md's
 * Stripe migration addendum for why), Stripe's own hosted Account Link
 * onboarding collects legal name, business type, address, bank details,
 * etc. directly, and Folkshops never sees them. "Connect Stripe" creates
 * this row with nothing but a fresh `linkedAccountId` in it.
 *
 * `live` is the actual payment-acceptance gate, mirroring Stripe's own
 * `charges_enabled` on the Account object — it stays false until Stripe's
 * own (external, asynchronous) account review completes. Folkshops cannot
 * make that happen faster; `live`/`payoutsEnabled`/`detailsSubmitted` are
 * a cached copy of whatever Stripe last reported, refreshed by calling
 * PaymentAccountsService.refreshStatus() (merchant-admin's "Refresh
 * status" button, and automatically on returning from Stripe's onboarding
 * flow) — not kept continuously in sync by a webhook, same
 * anti-overengineering reasoning as before.
 */
export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull().default("stripe"),
    // Stripe's "acct_..." Connect account id.
    linkedAccountId: text("linked_account_id"),
    live: boolean("live").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("payment_accounts_tenant_unique").on(table.tenantId)],
);
