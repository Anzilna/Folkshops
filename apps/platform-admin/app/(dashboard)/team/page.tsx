"use client";

import { Button, ConfirmDialog, DataTable, PageHeader, useBreadcrumbs, type TableColumn } from "@folkshops/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createTableFetcher } from "../../../lib/api";
import { formatDate, formatRelative } from "../../../lib/format";
import { fetchCurrentAdmin, removeAdmin } from "../../../lib/platform-api";

interface MemberRow {
  id: string;
  email: string;
  name: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function TeamPage() {
  useBreadcrumbs([{ label: "Team" }]);
  const fetcher = createTableFetcher<MemberRow>("/platform-admin/admins");
  const [me, setMe] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<MemberRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentAdmin()
      .then((a) => setMe(a.sub))
      .catch(() => setMe(null));
  }, []);

  const columns: TableColumn<MemberRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.id === me && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">You</span>}
        </span>
      ),
    },
    { key: "email", header: "Email", sortable: true },
    {
      key: "lastLoginAt",
      header: "Last sign-in",
      sortable: true,
      render: (row) => (row.lastLoginAt ? formatRelative(row.lastLoginAt) : <span className="text-muted-foreground">Never</span>),
    },
    { key: "createdAt", header: "Added", sortable: true, align: "right", render: (row) => formatDate(row.createdAt) },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone who can sign in to Platform Admin. All admins have the same access."
        actions={
          <Link href="/team/new">
            <Button variant="primary">Add admin</Button>
          </Link>
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <DataTable<MemberRow>
        columns={columns}
        getRowId={(row) => row.id}
        fetcher={fetcher}
        searchPlaceholder="Search name or email..."
        defaultSortBy="createdAt"
        defaultSortDir="asc"
        refreshKey={refreshKey}
        actions={(row) =>
          row.id === me ? null : (
            <Button size="sm" variant="ghost" onClick={() => setToRemove(row)}>
              Remove
            </Button>
          )
        }
        emptyMessage="No admins."
      />

      <ConfirmDialog
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove) return;
          try {
            await removeAdmin(toRemove.id);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't remove this admin");
          }
          setRefreshKey((k) => k + 1);
        }}
        title={`Remove ${toRemove?.name ?? "this admin"}?`}
        description="They are signed out immediately and can no longer sign in. This can't be undone — you would have to add them again."
        confirmLabel="Remove"
      />
    </>
  );
}
