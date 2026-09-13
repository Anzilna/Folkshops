import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export class QueryTenantsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(["active", "suspended"])
  status?: "active" | "suspended";
}
