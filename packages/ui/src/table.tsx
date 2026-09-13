"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { parseCsv } from "./csv";
import { ConfirmDialog } from "./confirm-dialog";
import { Checkbox, Input, Select, type SelectOption } from "./inputs";

export interface TableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
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
   * per-row results — mirrors core-api's bulk-import.util.ts on the wire. */
  importFetcher?: (rows: Record<string, string>[]) => Promise<ImportResult>;
  /** Right end of the toolbar — the page's primary action ("New product"). */
  toolbarActions?: ReactNode;
  /** Shown while rows are selected, replacing the toolbar filters. */
  bulkActions?: (selectedIds: string[], clearSelection: () => void) => ReactNode;
  actions?: (row: T) => ReactNode;
  /** Makes the whole row a target (cursor + hover) — typically navigates to the edit page. */
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  defaultSortBy?: string;
  defaultSortDir?: "asc" | "desc";
  pageSizeOptions?: number[];
  /** Bump this (e.g. after a delete) to force a refetch. */
  refreshKey?: number | string;
}

function SortIcon({ state }: { state: "asc" | "desc" | "none" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M8 10l4-4 4 4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={state === "asc" ? "opacity-100" : state === "none" ? "opacity-30" : "opacity-20"}
      />
      <path
        d="M8 14l4 4 4-4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={state === "desc" ? "opacity-100" : state === "none" ? "opacity-30" : "opacity-20"}
      />
    </svg>
  );
}

const ALIGN: Record<NonNullable<TableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * The one table component every list page uses — merchant-admin's
 * products/categories/inventory/customers/orders and platform-admin's
 * tenants all render through this, each only supplying columns + a
 * fetcher. Sorting/pagination/filtering/search all drive the fetcher's
 * params rather than filtering an already-fetched page client-side — the
 * backend owns the actual query (see core-api's src/common/pagination.util.ts),
 * this component owns only the state around it.
 */
export function DataTable<T>({
  columns,
  getRowId,
  fetcher,
  filters = [],
  searchPlaceholder = "Search...",
  selectable = false,
  exportFetcher,
  exportFilename = "export.csv",
  importFetcher,
  toolbarActions,
  bulkActions,
  actions,
  onRowClick,
  emptyMessage = "Nothing here yet.",
  emptyAction,
  defaultSortBy,
  defaultSortDir = "asc",
  pageSizeOptions = [10, 20, 50],
  refreshKey,
}: DataTableProps<T>) {
  const [result, setResult] = useState<PaginatedResult<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeOptions.includes(20) ? 20 : pageSizeOptions[0]);
  const [sortBy, setSortBy] = useState<string | undefined>(defaultSortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce free-text search so every keystroke doesn't refetch.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
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
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const rows = result?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(getRowId(r)));
  const colSpan = columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0);
  const activeFilterCount = Object.values(filterValues).filter(Boolean).length + (search ? 1 : 0);

  function toggleSelectAll() {
    const ids = rows.map(getRowId);
    setSelected(allOnPageSelected ? new Set() : new Set(ids));
  }
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearFilters() {
    setSearchInput("");
    setFilterValues({});
    setPage(1);
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

  // Parse first, then confirm with the row count — a mis-picked file is
  // caught before anything is written.
  async function handleImportFile(file: File) {
    const rows = parseCsv(await file.text());
    setPendingImport({ name: file.name, rows });
  }

  async function runImport(rows: Record<string, string>[]) {
    if (!importFetcher) return;
    setImporting(true);
    setImportResult(null);
    try {
      setImportResult(await importFetcher(rows));
      setResult(await fetcher(params));
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

  const selectedIds = Array.from(selected);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {bulkActions && selectedIds.length > 0 ? (
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-sm">
            <span className="font-medium">{selectedIds.length} selected</span>
            <span className="h-4 w-px bg-border" />
            {bulkActions(selectedIds, () => setSelected(new Set()))}
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
        ) : (
          <>
            <div className="relative w-64">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
            </div>
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
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
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
                {importing ? "Importing..." : "Import CSV"}
              </Button>
            </>
          )}
          {exportFetcher && (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          )}
          {toolbarActions}
        </div>
      </div>

      {importResult && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-[1]">
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                {selectable && (
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox checked={allOnPageSelected} onChange={toggleSelectAll} aria-label="Select all on page" />
                  </th>
                )}
                {columns.map((col) => {
                  const state = sortBy === col.key ? sortDir : "none";
                  return (
                    <th key={col.key} className={`px-4 py-2.5 font-medium ${ALIGN[col.align ?? "left"]} ${col.className ?? ""}`}>
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={`group inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground ${
                            state !== "none" ? "text-foreground" : ""
                          }`}
                          aria-sort={state === "none" ? undefined : state === "asc" ? "ascending" : "descending"}
                        >
                          {col.header}
                          <SortIcon state={state} />
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
                {actions && <th className="w-px px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="border-b border-border last:border-0">
                    {selectable && (
                      <td className="px-4 py-3">
                        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-3.5 animate-pulse rounded bg-muted" style={{ width: `${45 + ((i * 17 + col.key.length * 9) % 40)}%` }} />
                      </td>
                    ))}
                    {actions && <td className="px-4 py-3" />}
                  </tr>
                ))}

              {!loading && error && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-destructive">
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-14">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {activeFilterCount > 0 ? "No results match these filters." : emptyMessage}
                      </p>
                      {activeFilterCount > 0 ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : (
                        emptyAction
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                rows.map((row) => {
                  const id = getRowId(row);
                  const isSelected = selected.has(id);
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={`border-b border-border transition-colors last:border-0 ${
                        isSelected ? "bg-accent/5" : "hover:bg-muted/40"
                      } ${onRowClick ? "cursor-pointer" : ""}`}
                    >
                      {selectable && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={isSelected} onChange={() => toggleRow(id)} aria-label="Select row" />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td key={col.key} className={`px-4 py-3 text-foreground ${ALIGN[col.align ?? "left"]} ${col.className ?? ""}`}>
                          {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                        </td>
                      ))}
                      {actions && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {actions(row)}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {result && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                {result.total === 0 ? "0 results" : `${(result.page - 1) * result.limit + 1}–${Math.min(result.page * result.limit, result.total)} of ${result.total.toLocaleString()}`}
              </span>
              <label className="flex items-center gap-1.5">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
                >
                  {pageSizeOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </Button>
              <span className="tabular-nums">
                {result.page} / {result.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= result.totalPages} onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        onConfirm={() => runImport(pendingImport?.rows ?? [])}
        title={`Import ${pendingImport?.rows.length ?? 0} rows?`}
        description={`From ${pendingImport?.name}. Rows that fail validation are skipped and reported; the rest are created.`}
        confirmLabel="Import"
        destructive={false}
      />
    </div>
  );
}
