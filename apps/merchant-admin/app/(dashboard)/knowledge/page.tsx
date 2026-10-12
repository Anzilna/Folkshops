"use client";

import { Button, Card, ConfirmDialog, DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  KNOWLEDGE_ACCEPT,
  KNOWLEDGE_MAX_BYTES,
  deleteDocument,
  fetchDocument,
  fetchDocuments,
  uploadDocument,
  type DocumentStatus,
  type KnowledgeDocument,
} from "../../../lib/ai-api";
import { useAiEntitlement } from "../../../lib/hooks";
import { AiUpgradeNotice } from "../ai-upgrade-notice";

const STATUS_FILTER_OPTIONS = [
  { value: "indexed", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "uploaded", label: "Queued" },
  { value: "failed", label: "Failed" },
];

const STATUS_STYLES: Record<DocumentStatus, { label: string; className: string }> = {
  indexed: { label: "Ready", className: "bg-success/15 text-success" },
  processing: { label: "Processing", className: "bg-accent/15 text-accent" },
  uploaded: { label: "Queued", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
};

const POLL_INTERVAL_MS = 2000;

/**
 * Polls its own document until ingestion finishes, rather than refetching
 * the whole table (DataTable swaps every row for a skeleton on refetch, so
 * polling it would flicker).
 */
function StatusBadge({ row }: { row: KnowledgeDocument }) {
  const [doc, setDoc] = useState(row);

  useEffect(() => setDoc(row), [row]);

  useEffect(() => {
    if (doc.status === "indexed" || doc.status === "failed") return;
    const t = setTimeout(() => {
      fetchDocument(doc.id)
        .then(setDoc)
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [doc]);

  const style = STATUS_STYLES[doc.status];
  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
        {(doc.status === "processing" || doc.status === "uploaded") && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
        )}
        {style.label}
      </span>
      {doc.status === "failed" && doc.error && (
        <span className="max-w-xs truncate text-xs text-muted-foreground" title={doc.error}>
          {doc.error}
        </span>
      )}
    </div>
  );
}

function fileKind(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/markdown") return "Markdown";
  if (mime === "text/html") return "HTML";
  return "Text";
}

export default function KnowledgeBasePage() {
  useBreadcrumbs([{ label: "Knowledge base" }]);
  const entitlement = useAiEntitlement();
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const tooBig = files.find((f) => f.size > KNOWLEDGE_MAX_BYTES);
    if (tooBig) {
      setPageError(`"${tooBig.name}" is larger than 20 MB.`);
      return;
    }

    setUploading(true);
    setPageError(null);
    const failures: string[] = [];
    for (const file of files) {
      try {
        await uploadDocument(file);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      }
    }
    setUploading(false);
    if (failures.length > 0) setPageError(failures.join(" · "));
    setRefreshKey((k) => k + 1);
  }

  const header = (
    <PageHeader
      title="Knowledge base"
      description="Documents the Store Copilot answers from — return policy, shipping FAQ, size guides. Only your staff can see them."
    />
  );

  if (entitlement === null) {
    return (
      <>
        {header}
        <Card className="h-64 animate-pulse bg-muted/40" />
      </>
    );
  }

  if ("unavailable" in entitlement || !entitlement.allowed) {
    return (
      <>
        {header}
        <Card className="max-w-2xl">
          <AiUpgradeNotice entitlement={entitlement} />
        </Card>
      </>
    );
  }

  const columns: TableColumn<KnowledgeDocument>[] = [
    {
      key: "filename",
      header: "Document",
      sortable: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.filename}</span>
          <span className="text-xs text-muted-foreground">{fileKind(row.mime_type)}</span>
        </div>
      ),
    },
    { key: "status", header: "Status", sortable: true, render: (row) => <StatusBadge row={row} /> },
    {
      key: "createdAt",
      header: "Uploaded",
      sortable: true,
      align: "right",
      render: (row) => <span className="text-muted-foreground">{new Date(row.created_at).toLocaleDateString("en-AE")}</span>,
    },
  ];

  const uploadButton = (
    <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
      {uploading ? "Uploading..." : "Upload documents"}
    </Button>
  );

  return (
    <>
      {header}

      <input ref={fileInputRef} type="file" accept={KNOWLEDGE_ACCEPT} multiple onChange={onFilesPicked} className="hidden" />

      {pageError && (
        <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{pageError}</p>
      )}

      <DataTable<KnowledgeDocument>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetchDocuments}
        filters={[{ key: "status", label: "All statuses", options: STATUS_FILTER_OPTIONS }]}
        searchPlaceholder="Search documents..."
        defaultSortBy="createdAt"
        defaultSortDir="desc"
        toolbarActions={uploadButton}
        actions={(row) => (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(row)}>
              Delete
            </Button>
          </div>
        )}
        emptyMessage="No documents yet. Upload PDFs, Markdown, HTML or text files (up to 20 MB each)."
        emptyAction={uploadButton}
        refreshKey={refreshKey}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteDocument(pendingDelete.id);
            setPageError(null);
          } catch (err) {
            setPageError(err instanceof Error ? err.message : "Delete failed");
          }
          setRefreshKey((k) => k + 1);
        }}
        title={`Delete "${pendingDelete?.filename}"?`}
        description="The Store Copilot stops using it immediately. This can't be undone — upload the file again to restore it."
      />
    </>
  );
}
