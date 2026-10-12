import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export const AUDIT_ACTIONS = ["tenant.suspended", "tenant.reactivated", "admin.created", "admin.removed", "admin.password_changed"] as const;

export class QueryAuditLogDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: (typeof AUDIT_ACTIONS)[number];
}
