import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

// No resource-specific filters yet beyond the shared search/sort/page —
// categories has no status/enum field to filter by today.
export class QueryCategoriesDto extends PaginationQueryDto {}
