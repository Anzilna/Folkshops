import { Controller, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { CurrentTenant } from "../auth/current-tenant.decorator";
import { StaffJwtGuard } from "../auth/staff-jwt.guard";
import { RealtimeService } from "./realtime.service";

/**
 * Real-Sent-Events (SSE), not WebSocket — one-directional (server to
 * dashboard) is all this needs, and it rides the same same-origin rewrite
 * proxy merchant-admin already needs for cookie auth (see
 * apps/merchant-admin/next.config.ts). Never polled by the browser —
 * that's the entire point of this endpoint existing. See
 * docs/decisions/0009.
 */
@UseGuards(StaffJwtGuard)
@Controller("analytics/realtime")
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse("stream")
  stream(@CurrentTenant() tenantId: string): Observable<MessageEvent> {
    return this.realtime.subscribe(tenantId);
  }
}
