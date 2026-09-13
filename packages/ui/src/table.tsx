"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { parseCsv } from "./csv";
import { Checkbox, Input, Select, type SelectOption } from "./inputs";

export interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface TableFilter {
  key: string;
  label: string;
  options: SelectOption[];
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TableQueryParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  filters: Record<string, string>;
}

export interface ImportResult {
  successCount: number;
  errorCount: number;
  errors: { row: number; errors: string[] }[];
}

export interface DataTableProps<T> {
  title?: string;
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  /** Decoupled from any specific HTTP client on purpose — this component
   * knows nothing about auth cookies, tenant headers, or base URLs. Each
   * app wires its own apiFetch-based fetcher in. */
  fetcher: (params: TableQueryParams) => Promise<PaginatedResult<T>>;
  filters?: TableFilter[];
  searchPlaceholder?: string;
  selectable?: boolean;
  exportFetcher?: (params: TableQueryParams) => Promise<Blob>;
  exportFilename?: string;
  /** Given rows parsed from an uploaded CSV, POST them and report back
   * per-row results — see core-api's bulk-import.util.ts, which this
   * mirrors on the wire. */
  importFetcher?: (rows: Record<string, string>[]) => Promise<ImportResult>;
  actions?: (row: T) => ReactNode;
  emptyMessage?: string;
  defaultSortBy?: string;
  defaultSortDir?: "asc" | "desc";
  pageSize?: number;
  /** Bump this (e.g. after creating a row elsewhere on the page) to force a refetch. */
  refreshKey?: number | string;
}

/**
 * The one table component every list page uses — merchant-admin's
 * products/categories/inventory/customers/orders and platform-admin's
 * tenants all render through this, each only supplying columns + a
 * fetcher. Sorting/pagination/filtering/search all drive the fetcher's
 * params rather than filtering an already-fetched page client-side — the
 * backend owns the actual query (see core-api's src/common/pagination.util.ts),
 * this component owns only the URL/state around it.
 */
export function DataTable<T>({
  title,
  columns,
  getRowId,
  fetcher,
  filters = [],
  searchPlaceholder = "Search...",
  selectable = false,
  exportFetcher,
  exportFilename = "export.csv",
  importFetcher,
  actions,
  emptyMessage = "No results.",
  defaultSortBy,
  defaultSortDir = "asc",
  pageSize = 20,
  refreshKey,
}: DataTableProps<T>) {
  const [result, setResult] = useState<PaginatedResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<string | undefined>(defaultSortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce free-text search so every keystroke doesn't refetch.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params: TableQueryParams = {
    page,
    limit: pageSize,
    sortBy,
    sortDir,
    search: search || undefined,
    filters: filterValues,
  };
  const paramsKey = JSON.stringify(params) + String(refreshKey ?? "");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(params)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  function toggleSort(key: string) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleSelectAll() {
    if (!result) return;
    const ids = result.data.map(getRowId);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport() {
    if (!exportFetcher) return;
    setExporting(true);
    try {
      const blob = await exportFetcher(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(file: File) {
    if (!importFetcher) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await importFetcher(rows);
      setImportResult(res);
      const refreshed = await fetcher(params);
      setResult(refreshed);
    } catch (err) {
      setImportResult({
        successCount: 0,
        errorCount: 1,
        errors: [{ row: 0, errors: [err instanceof Error ? err.message : "Import failed"] }],
      });
    } finally {
      setImporting(false);
    }
  }

  const rows = result?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(getRowId(r)));
  const colSpan = columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {title && <h2 className="mr-auto text-lg font-medium text-foreground">{title}</h2>}

        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-48"
        />

        {filters.map((f) => (
          <Select
            key={f.key}
            value={filterValues[f.key] ?? ""}
            onChange={(e) => {
              setFilterValues((prev) => ({ ...prev, [f.key]: e.target.value }));
              setPage(1);
            }}
            options={f.options}
            placeholder={f.label}
            className="w-40"
          />
        ))}

        {importFetcher && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportFile(file);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? "Importing..." : "Import"}
            </Button>
          </>
        )}

        {exportFetcher && (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting..." : "Export"}
          </Button>
        )}
      </div>

      {importResult && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            importResult.errorCount > 0
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              Imported {importResult.successCount} row{importResult.successCount === 1 ? "" : "s"}
              {importResult.errorCount > 0 ? `, ${importResult.errorCount} failed` : ""}.
            </span>
            <button type="button" onClick={() => setImportResult(null)} className="text-xs underline underline-offset-2">
              Dismiss
            </button>
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-1.5 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs opacity-90">
              {importResult.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.errors.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <Checkbox checked={allOnPageSelected} onChange={toggleSelectAll} />
                </th>
              )}
              {columns.map((col) => (
                <th key={col.key} className={`px-3 py-2.5 font-medium ${col.className ?? ""}`}>
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {col.header}
                      {sortBy === col.key && <span>{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
              {actions && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-destructive">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((row) => {
                const id = getRowId(row);
                return (
                  <tr key={id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    {selectable && (
                      <td className="px-3 py-2.5">
                        <Checkbox checked={selected.has(id)} onChange={() => toggleRow(id)} />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`px-3 py-2.5 text-foreground ${col.className ?? ""}`}>
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                      </td>
                    ))}
                    {actions && <td className="px-3 py-2.5 text-right">{actions(row)}</td>}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {result && result.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(result.page - 1) * result.limit + 1}
            {"–"}
            {Math.min(result.page * result.limit, result.total)} of {result.total}
            {selected.size > 0 ? ` · ${selected.size} selected` : ""}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </Button>
            <span>
              Page {result.page} of {result.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= result.totalPages}
              onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
