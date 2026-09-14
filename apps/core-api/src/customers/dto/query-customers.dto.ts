import { IsActiveField } from "../../common/dto/is-active.decorator";
import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

// search matches against phone or name — see customers.service.ts.
export class QueryCustomersDto extends PaginationQueryDto {
  @IsActiveField()
  isActive?: boolean;
}
