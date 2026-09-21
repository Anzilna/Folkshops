/**
 * Debezium's own change-event envelope shape (Postgres connector, pgoutput
 * plugin, tombstones.on.delete=false — see database/debezium/postgres-connector.json).
 * Deliberately kept as-is, not flattened via Debezium's own
 * ExtractNewRecordState SMT, so a consumer sees `op`/`before`/`after`
 * explicitly rather than a single merged row that hides which kind of
 * change produced it.
 */
export interface DebeziumChangeEvent<TRow = Record<string, unknown>> {
  before: TRow | null;
  after: TRow | null;
  source: {
    table: string;
    ts_ms: number;
    lsn: number;
    snapshot?: string | boolean;
  };
  /** c=create/insert, u=update, d=delete, r=read (initial snapshot) */
  op: "c" | "u" | "d" | "r";
  ts_ms: number;
}
