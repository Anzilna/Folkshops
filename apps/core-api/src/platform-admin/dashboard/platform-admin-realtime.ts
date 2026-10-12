import type Redis from "ioredis";

export const PLATFORM_ADMIN_DASHBOARD_CHANNEL = "platform-admin:dashboard";

/**
 * Thin "something changed, re-fetch" signal — no tenant data on the wire,
 * same posture as apps/analytics' realtime-bridge.service.ts. Called from
 * AuthService.register() (a new tenant) and SubscriptionsService
 * .handleWebhookEvent() (a subscription status change) — the two mutations
 * that actually move the platform-admin dashboard's numbers. A failed
 * publish never blocks the caller; this is a convenience, not a
 * durability guarantee (the dashboard just misses one live tick, the next
 * manual refresh/page load is always correct regardless).
 */
export async function publishDashboardUpdate(redis: Redis): Promise<void> {
  try {
    await redis.publish(PLATFORM_ADMIN_DASHBOARD_CHANNEL, JSON.stringify({ occurredAt: new Date().toISOString() }));
  } catch {
    // best-effort — see module docstring
  }
}
