import { Injectable } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";
import { DbRouter } from "../../database/db-router";
import { outboxEvents, tenants } from "../../database/schema";
import { AuditRow, PlatformAuditService } from "../audit/platform-audit.service";

export type ActivityKind = "store" | "billing" | "security";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  body: string;
  /** ISO timestamp. */
  at: string;
  href?: string;
}

/**
 * Outbox events that matter to whoever runs the platform. Already written
 * by the app for the email pipeline, so this feed needs no new publishing
 * code anywhere — it only reads what is already recorded.
 */
const PLATFORM_EVENTS: Record<string, { kind: ActivityKind; title: string; body: (store: string) => string }> = {
  "merchant.registered": { kind: "store", title: "New store", body: (s) => `${s} just signed up.` },
  "subscription.activated": { kind: "billing", title: "Subscription active", body: (s) => `${s} is now on a paid plan.` },
  "subscription.past_due": { kind: "billing", title: "Payment past due", body: (s) => `${s}'s last subscription payment failed.` },
  "subscription.canceled": { kind: "billing", title: "Subscription canceled", body: (s) => `${s} canceled its subscription.` },
  "payments.activated": { kind: "billing", title: "Payments live", body: (s) => `${s} can now accept payments.` },
};

const AUDIT_TEXT: Record<string, (row: AuditRow) => { title: string; body: string }> = {
  "tenant.suspended": (r) => ({ title: "Store suspended", body: `${r.adminEmail} suspended ${r.targetLabel}.` }),
  "tenant.reactivated": (r) => ({ title: "Store reactivated", body: `${r.adminEmail} reactivated ${r.targetLabel}.` }),
  "admin.created": (r) => ({ title: "Team member added", body: `${r.adminEmail} added ${r.targetLabel}.` }),
  "admin.removed": (r) => ({ title: "Team member removed", body: `${r.adminEmail} removed ${r.targetLabel}.` }),
  "admin.password_changed": (r) => ({ title: "Password changed", body: `${r.targetLabel} changed their password.` }),
};

@Injectable()
export class PlatformAdminActivityService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly audit: PlatformAuditService,
  ) {}

  /** The most recent platform events and admin actions, merged newest-first — feeds the notification bell. */
  async feed(limit: number): Promise<ActivityItem[]> {
    const [events, audits] = await Promise.all([
      this.dbRouter.read("eventual", (db) =>
        db
          .select({ id: outboxEvents.id, eventType: outboxEvents.eventType, createdAt: outboxEvents.createdAt, tenantId: tenants.id, tenantName: tenants.name })
          .from(outboxEvents)
          .innerJoin(tenants, eq(outboxEvents.tenantId, tenants.id))
          .where(inArray(outboxEvents.eventType, Object.keys(PLATFORM_EVENTS)))
          .orderBy(desc(outboxEvents.createdAt))
          .limit(limit),
      ),
      this.audit.recent(limit),
    ]);

    const items: ActivityItem[] = [
      ...events.map((e): ActivityItem => {
        const def = PLATFORM_EVENTS[e.eventType];
        return { id: `event:${e.id}`, kind: def.kind, title: def.title, body: def.body(e.tenantName), at: e.createdAt.toISOString(), href: `/tenants/${e.tenantId}` };
      }),
      ...audits.map((a): ActivityItem => {
        const text = (AUDIT_TEXT[a.action] ?? ((r: AuditRow) => ({ title: r.action, body: r.targetLabel })))(a);
        return {
          id: `audit:${a.id}`,
          kind: "security",
          ...text,
          at: a.createdAt,
          href: a.tenantId ? `/tenants/${a.tenantId}` : "/team",
        };
      }),
    ];
    return items.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
  }
}
