import type { RemoteAdapter, RemoteRow } from "./types";

/** An in-memory remote with a monotonic server clock. Used by tests. */
export class MemoryAdapter implements RemoteAdapter {
  rows = new Map<string, RemoteRow>();
  private tick = 0;

  private stamp() {
    this.tick += 1;
    return new Date(Date.UTC(2030, 0, 1) + this.tick * 1000).toISOString();
  }

  async pull(cursor: string | null) {
    const rows = [...this.rows.values()]
      .filter((r) => !cursor || (r.synced_at ?? "") > cursor)
      .sort((a, b) => (a.synced_at ?? "").localeCompare(b.synced_at ?? ""));
    const last = rows.length ? rows[rows.length - 1].synced_at ?? cursor : cursor;
    return { rows: rows.map((r) => ({ ...r })), cursor: last ?? null };
  }

  async push(rows: RemoteRow[]) {
    for (const r of rows) this.rows.set(`${r.tbl}:${r.id}`, { ...r, synced_at: this.stamp() });
  }

  async wipe() {
    this.rows.clear();
  }
}
