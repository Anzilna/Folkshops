import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { paymentAccounts } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CacheService } from "../redis/cache.service";
import { storeCacheKey } from "../storefront/store-cache";
import { PAYMENT_GATEWAY, PaymentProvider } from "./payment-provider.interface";

/**
 * Owns the Stripe Connect account creation + hosted-onboarding-link +
 * status refresh — the "store admin connects and activates payments"
 * flow. Separate from PaymentsService (checkout/webhook), which only
 * *reads* whether a tenant's account is live via isPaymentsEnabled()
 * below; it never touches account creation/onboarding itself.
 */
@Injectable()
export class PaymentAccountsService {
  constructor(
    private readonly dbRouter: DbRouter,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentProvider,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async getForTenant(tenantId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, tenantId)).limit(1);
        return row ?? null;
      }),
    );
  }

  private merchantAdminUrl(): string {
    return this.config.get<string>("MERCHANT_ADMIN_URL") ?? "http://localhost:3001";
  }

  /**
   * "Connect Stripe" — creates the connected account on first call (one
   * per tenant, matching the old Route flow's cardinality) and always
   * returns a fresh onboarding URL, since Stripe's Account Link URLs
   * expire after a few minutes and are single-use. Safe to call again for
   * an existing not-yet-onboarded account — that's exactly the
   * refresh_url case (see createAccountLink()'s comment) and what
   * merchant-admin's "Continue onboarding" action hits.
   */
  async connect(tenantId: string, contactEmail: string) {
    const existing = await this.getForTenant(tenantId);

    const accountId =
      existing?.linkedAccountId ??
      (await (async () => {
        const created = await this.gateway.createConnectAccount(contactEmail);
        await this.dbRouter.write((db) =>
          withTenantContext(db, tenantId, (tx) =>
            tx.insert(paymentAccounts).values({ tenantId, linkedAccountId: created.accountId }),
          ),
        );
        return created.accountId;
      })());

    // Both refresh_url and return_url point at the same page — Connect's
    // return_url carries no state either way (Stripe's own docs: "check
    // details_submitted after redirect, don't trust the URL"), so
    // merchant-admin's own useEffect-on-mount refresh handles both "the
    // link expired, come back to get a new one" and "onboarding actually
    // finished" identically: land on /settings/payments, refresh status.
    const settingsUrl = `${this.merchantAdminUrl()}/settings/payments`;
    const link = await this.gateway.createAccountLink(accountId, settingsUrl, settingsUrl);
    return { url: link.url };
  }

  /** Re-fetches the account from Stripe and updates the cached
   * capability flags — "Refresh status" in merchant-admin, and called
   * automatically when the merchant lands back on /settings/payments
   * after exiting Stripe's onboarding flow. Not a webhook/background
   * poller, see payment-account.ts's schema comment for why. */
  async refreshStatus(tenantId: string) {
    const existing = await this.getForTenant(tenantId);
    if (!existing?.linkedAccountId) throw new NotFoundException("No payment account set up for this store yet");

    const status = await this.gateway.getConnectAccountStatus(existing.linkedAccountId);

    const row = await this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [updated] = await tx
          .update(paymentAccounts)
          .set({
            live: status.chargesEnabled,
            payoutsEnabled: status.payoutsEnabled,
            detailsSubmitted: status.detailsSubmitted,
            activatedAt: status.chargesEnabled && !existing.activatedAt ? new Date() : existing.activatedAt,
            updatedAt: new Date(),
          })
          .where(eq(paymentAccounts.tenantId, tenantId))
          .returning();
        return updated;
      }),
    );

    // `live` feeds directly into StoreController's cached response
    // (paymentsEnabled) — a store connecting Stripe and clicking "Refresh
    // status" must unlock checkout for real visitors immediately, not
    // after CACHE_STORE_TTL_SECONDS happens to expire. This is UI-hint
    // staleness only, not a security gap either way — the actual
    // enforcement (PaymentsService.initiatePayment()) always re-reads
    // payment_accounts fresh, uncached.
    await this.cache.invalidate(storeCacheKey(tenantId));

    return row;
  }

  /** The actual server-side gate — used by PaymentsService.initiatePayment()
   * (never trust the frontend hiding the Pay button as the only
   * enforcement) and by StoreController's public paymentsEnabled flag. */
  async isPaymentsEnabled(tenantId: string): Promise<boolean> {
    const account = await this.getForTenant(tenantId);
    return account?.live ?? false;
  }
}
