import { IsIn, IsOptional } from "class-validator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export class QueryOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(["pending", "cancelled"])
  status?: "pending" | "cancelled";
}
