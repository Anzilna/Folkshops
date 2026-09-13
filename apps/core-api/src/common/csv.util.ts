/**
 * Hand-rolled RFC 4180 CSV — same reasoning as products/dto/update-product.dto.ts's
 * "avoid a dependency for one small thing": export/import only ever needs
 * flat rows of strings, not a general-purpose CSV library's streaming or
 * dialect options.
 */

export interface CsvColumn<T> {
  key: string;
  header: string;
  /** Defaults to String(row[key] ?? "") — override for booleans/dates/cents. */
  value?: (row: T) => string;
}

function escapeCsvField(value: string): string {
  // Quote whenever the field contains the delimiter, a quote, or a
  // newline — quoting everything unconditionally would also be correct
  // but is noisier to read/diff in the exported file.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(c.value ? c.value(row) : String((row as Record<string, unknown>)[c.key] ?? ""))).join(","),
  );
  // CRLF — the RFC 4180 line ending, and what spreadsheet apps expect.
  return [header, ...lines].join("\r\n") + "\r\n";
}

/**
 * Parses CSV text into an array of plain objects keyed by the header row.
 * A small hand-written state machine rather than split(",") — a naive
 * split breaks the moment any field contains a quoted comma or a newline,
 * both routine in exported product descriptions.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== "")) // skip blank trailing lines
    .map((row) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key.trim()] = row[i] ?? "";
      });
      return record;
    });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat \r\n as one break — skip the \n right after an \r.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Final field/row if the file doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
