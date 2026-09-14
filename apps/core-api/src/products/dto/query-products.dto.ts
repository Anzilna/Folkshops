import { IsIn, IsOptional, IsUUID } from "class-validator";
import { IsActiveField } from "../../common/dto/is-active.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export class QueryProductsDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(["draft", "active", "archived"])
  status?: "draft" | "active" | "archived";

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsActiveField()
  isActive?: boolean;
}
