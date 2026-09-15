import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Tenant-owned, RLS-enabled, at most one row per tenant (uniqueIndex
 * below) — a store's Route/Linked Account connection. No secrets stored
 * here: unlike a "paste your own API keys" model, a Linked Account under
 * Route is created/called using the *platform's own* RAZORPAY_KEY_ID/
 * SECRET (env vars, unchanged since Slice 1) — this table only stores the
 * Linked Account id Razorpay returns and its own KYC submission, nothing
 * sensitive enough to need encryption at rest.
 *
 * `live` is the actual payment-acceptance gate — see RazorpayProvider's
 * RazorpayAccount type: `activated_at` stays null and `live` stays false
 * until Razorpay's own (external, asynchronous) account review completes.
 * Folkshops cannot make that happen faster; `status`/`live`/`activatedAt`
 * are a cached copy of whatever Razorpay last reported, refreshed by
 * calling PaymentsService.refreshLinkedAccountStatus() (merchant-admin's
 * "Refresh status" button), not kept continuously in sync by a webhook —
 * see docs/decisions/0006-payment-gateway.md for why that's not built.
 */
export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull().default("razorpay"),
    linkedAccountId: text("linked_account_id"),
    // KYC submission — see PaymentProvider's CreateLinkedAccountInput for
    // what each maps to in the actual Razorpay API call.
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    legalBusinessName: text("legal_business_name").notNull(),
    businessType: text("business_type").notNull(),
    contactName: text("contact_name").notNull(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    pan: text("pan"),
    gst: text("gst"),
    registeredAddress: jsonb("registered_address").notNull(),
    // Cached copy of Razorpay's own account status — see comment above.
    status: text("status"),
    live: boolean("live").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("payment_accounts_tenant_unique").on(table.tenantId)],
);
