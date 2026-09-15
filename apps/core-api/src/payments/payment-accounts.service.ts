import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { paymentAccounts } from "../database/schema";
import { withTenantContext } from "../database/tenant-context";
import { CreatePaymentAccountDto } from "./dto/create-payment-account.dto";
import { PAYMENT_GATEWAY, PaymentProvider } from "./payment-provider.interface";

/**
 * Owns the Route Linked Account KYC submission + status refresh — the
 * "store admin fills and activates payments" flow. Separate from
 * PaymentsService (checkout/webhook), which only *reads* whether a
 * tenant's account is live via isPaymentsEnabled() below; it never
 * touches the KYC fields themselves.
 */
@Injectable()
export class PaymentAccountsService {
  constructor(
    private readonly dbRouter: DbRouter,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentProvider,
  ) {}

  async getForTenant(tenantId: string) {
    return this.dbRouter.read("strong", (db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, tenantId)).limit(1);
        return row ?? null;
      }),
    );
  }

  /** One KYC submission per tenant — a genuine correction/resubmission
   * flow (Razorpay's own accounts.edit()) is a real follow-up, not built
   * here; this only covers "hasn't set anything up yet". */
  async create(tenantId: string, dto: CreatePaymentAccountDto) {
    const existing = await this.getForTenant(tenantId);
    if (existing) throw new ConflictException("This store already has a payment account set up");

    const result = await this.gateway.createLinkedAccount({
      email: dto.email,
      phone: dto.phone,
      legalBusinessName: dto.legalBusinessName,
      businessType: dto.businessType,
      contactName: dto.contactName,
      category: dto.category,
      subcategory: dto.subcategory,
      pan: dto.pan,
      gst: dto.gst,
      registeredAddress: dto.registeredAddress,
    });

    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .insert(paymentAccounts)
          .values({
            tenantId,
            email: dto.email,
            phone: dto.phone,
            legalBusinessName: dto.legalBusinessName,
            businessType: dto.businessType,
            contactName: dto.contactName,
            category: dto.category,
            subcategory: dto.subcategory,
            pan: dto.pan,
            gst: dto.gst,
            registeredAddress: dto.registeredAddress,
            linkedAccountId: result.linkedAccountId,
            status: result.status,
          })
          .returning();
        return row;
      }),
    );
  }

  /** Re-fetches the account from Razorpay and updates the cached status —
   * "Refresh status" in merchant-admin. Not a webhook/background poller,
   * see payment-account.ts's schema comment for why. */
  async refreshStatus(tenantId: string) {
    const existing = await this.getForTenant(tenantId);
    if (!existing?.linkedAccountId) throw new NotFoundException("No payment account set up for this store yet");

    const status = await this.gateway.getLinkedAccountStatus(existing.linkedAccountId);

    return this.dbRouter.write((db) =>
      withTenantContext(db, tenantId, async (tx) => {
        const [row] = await tx
          .update(paymentAccounts)
          .set({ status: status.status, live: status.live, activatedAt: status.activatedAt, updatedAt: new Date() })
          .where(eq(paymentAccounts.tenantId, tenantId))
          .returning();
        return row;
      }),
    );
  }

  /** The actual server-side gate — used by PaymentsService.initiatePayment()
   * (never trust the frontend hiding the Pay button as the only
   * enforcement) and by StoreController's public paymentsEnabled flag. */
  async isPaymentsEnabled(tenantId: string): Promise<boolean> {
    const account = await this.getForTenant(tenantId);
    return account?.live ?? false;
  }
}
