import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

export interface BulkImportRowError {
  /** 1-based, matching what a spreadsheet shows (header is row 1, first data row is row 2). */
  row: number;
  errors: string[];
}

export interface BulkImportResult {
  successCount: number;
  errorCount: number;
  errors: BulkImportRowError[];
}

/**
 * Validates each parsed CSV row against the same DTO class the single-row
 * create endpoint uses — one source of truth for what a valid row looks
 * like, not a second hand-maintained set of import rules. Rows are
 * inserted one at a time (not a single bulk INSERT) so one bad row
 * doesn't roll back every good one around it — a merchant re-uploading a
 * large CSV gets a per-row error list and keeps whatever already
 * succeeded, rather than an all-or-nothing failure.
 *
 * `enableImplicitConversion: true` on plainToInstance: every CSV cell
 * arrives as a string, and the create DTOs (priceCents: number, etc.)
 * have no explicit @Type(() => Number) decorators — they've never needed
 * them, since a JSON POST body already carries real types. This uses the
 * DTO fields' own TypeScript types (via emitDecoratorMetadata) to coerce
 * "49900" -> 49900 the same way the global ValidationPipe would for a
 * query param, without touching every existing DTO.
 */
export async function bulkImport<DtoClass extends object>(
  rows: Record<string, string>[],
  DtoType: new () => DtoClass,
  insert: (dto: DtoClass) => Promise<unknown>,
): Promise<BulkImportResult> {
  const errors: BulkImportRowError[] = [];
  let successCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const instance = plainToInstance(DtoType, rows[i], { enableImplicitConversion: true });
    const violations = await validate(instance as object, { whitelist: true });

    if (violations.length > 0) {
      errors.push({
        row: rowNumber,
        errors: violations.flatMap((v) => Object.values(v.constraints ?? {})),
      });
      continue;
    }

    try {
      await insert(instance);
      successCount++;
    } catch (err) {
      errors.push({ row: rowNumber, errors: [err instanceof Error ? err.message : "Insert failed"] });
    }
  }

  return { successCount, errorCount: errors.length, errors };
}
