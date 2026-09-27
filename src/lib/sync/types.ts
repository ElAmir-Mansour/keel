// The sync contract. The engine talks to a remote through this interface, so
// the same engine runs against Supabase in the app and an in-memory remote in
// tests. Rows are opaque JSON; the remote never needs to know the schema.

export interface RemoteRow {
  tbl: string;
  id: string;
  /** The record, or null for a tombstone. */
  data: Record<string, unknown> | null;
  /** The record's own version: updatedAt, createdAt or event time. */
  updated_at: string;
  deleted_at: string | null;
  /** Server-assigned arrival time; the pull cursor. */
  synced_at?: string;
}

export interface RemoteAdapter {
  /** Rows that arrived after `cursor` (all rows when null), oldest first. */
  pull(cursor: string | null): Promise<{ rows: RemoteRow[]; cursor: string | null }>;
  /** Upsert rows by (tbl, id). */
  push(rows: RemoteRow[]): Promise<void>;
  /** Remove everything this user has stored. */
  wipe?(): Promise<void>;
}

export interface SyncResult {
  startedAt: string;
  pushed: number;
  pulled: number;
  applied: number;
}
