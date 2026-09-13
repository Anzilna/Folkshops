import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

// search matches against the joined product name — see inventory.service.ts.
export class QueryInventoryDto extends PaginationQueryDto {}
