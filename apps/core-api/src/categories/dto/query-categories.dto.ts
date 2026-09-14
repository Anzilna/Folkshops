import { IsActiveField } from "../../common/dto/is-active.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

export class QueryCategoriesDto extends PaginationQueryDto {
  @IsActiveField()
  isActive?: boolean;
}
