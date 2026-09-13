import { IsArray } from "class-validator";

/**
 * The body shape for every bulk-import endpoint: `{ rows: [...] }`, where
 * each row is a plain string-keyed object straight from a parsed CSV file
 * (parsing happens client-side in the reusable table component). Content
 * validation happens per-row against the resource's own create DTO inside
 * bulkImport() — this DTO only confirms the top-level shape.
 */
export class ImportRowsDto {
  @IsArray()
  rows!: Record<string, string>[];
}
