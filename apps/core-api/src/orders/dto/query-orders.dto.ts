import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

// Kept in sync with orderStatusEnum (database/schema/orders.ts) — this had
// drifted to just "pending" | "cancelled" (pre-dating the payment state
// machine), so GET /orders?status=paid was silently rejected by the
// global ValidationPipe. Caught live: merchant-admin's own status filter
// dropdown offered "Paid" as an option that 400'd if clicked.
export type OrderStatus = "pending" | "awaiting_payment" | "paid" | "payment_failed" | "cancelled" | "refunded" | "partially_refunded";

export class QueryOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(["pending", "awaiting_payment", "paid", "payment_failed", "cancelled", "refunded", "partially_refunded"])
  status?: OrderStatus;
}
