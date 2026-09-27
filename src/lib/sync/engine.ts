import type { KeelDB } from "@/lib/db";
import { SYNCED_TABLES, type SyncedTable } from "@/lib/db";
import type { RemoteAdapter, RemoteRow, SyncResult } from "./types";

// One sync = collect local changes since the last push, pull remote changes
// since the last pull, merge with last-write-wins on the record's own
// version, push what survived, advance both cursors. Every step is safe to
// repeat: a crash before the cursors are saved simply replays next time.

export const CURSOR_PUSH = "sync.cursor.push";
export const CURSOR_PULL = "sync.cursor.pull";

/** The version stamp a table's records carry. Immutable tables use their creation time. */
export function versionOf(tbl: string, row: Record<string, unknown>): string {
  if (tbl === "issueEvents") return String(row.at ?? "");
  if (tbl === "updates") return String(row.createdAt ?? "");
  return String(row.updatedAt ?? row.createdAt ?? "");
}

function isSynced(tbl: string): tbl is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(tbl);
}

export interface SyncHooks {
  /** Wraps local writes made on behalf of the remote, so change listeners can ignore them. */
  applying?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export async function syncOnce(remote: RemoteAdapter, local: KeelDB, hooks: SyncHooks = {}): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const lastPush = ((await local.settings.get(CURSOR_PUSH))?.value as string | undefined) ?? null;
  const pullCursor = ((await local.settings.get(CURSOR_PULL))?.value as string | undefined) ?? null;

  // 1. Local changes since the last push.
  const push = new Map<string, RemoteRow>();
  for (const tbl of SYNCED_TABLES) {
    const rows = (await local.table(tbl).toArray()) as Record<string, unknown>[];
    for (const r of rows) {
      const v = versionOf(tbl, r);
      if (!lastPush || v >= lastPush) push.set(`${tbl}:${r.id}`, { tbl, id: String(r.id), data: r, updated_at: v, deleted_at: null });
    }
  }
  for (const t of await local.deletions.toArray()) {
    if (!lastPush || t.deletedAt >= lastPush) push.set(`${t.tbl}:${t.id}`, { tbl: t.tbl, id: t.id, data: null, updated_at: t.deletedAt, deleted_at: t.deletedAt });
  }

  // 2. Remote changes since the last pull.
  const pulled = await remote.pull(pullCursor);

  // 3. Merge. A remote row wins only when it is strictly newer than what we
  //    hold (a record, or a tombstone for it); otherwise our version stays and
  //    is pushed.
  let applied = 0;
  const apply = hooks.applying ?? (<T,>(fn: () => Promise<T>) => fn());
  await apply(async () => {
    await local.transaction("rw", [...SYNCED_TABLES.map((t) => local.table(t)), local.deletions], async () => {
      for (const rr of pulled.rows) {
        if (!isSynced(rr.tbl)) continue;
        const table = local.table(rr.tbl);
        const localRow = (await table.get(rr.id)) as Record<string, unknown> | undefined;
        const tomb = await local.deletions.get(rr.id);
        const localVersion = localRow ? versionOf(rr.tbl, localRow) : tomb && tomb.tbl === rr.tbl ? tomb.deletedAt : null;
        const remoteVersion = rr.deleted_at ?? rr.updated_at;
        if (localVersion && localVersion >= remoteVersion) continue;
        push.delete(`${rr.tbl}:${rr.id}`);
        if (rr.deleted_at) {
          if (localRow) await table.delete(rr.id);
        } else if (rr.data) {
          await table.put(rr.data);
        }
        if (tomb && tomb.tbl === rr.tbl) await local.deletions.delete(rr.id);
        applied += 1;
      }
    });
  });

  // 4. Push what survived the merge.
  const toPush = [...push.values()];
  if (toPush.length) await remote.push(toPush);

  // 5. Cursors, then prune tombstones that have now been delivered.
  await local.settings.bulkPut([
    { key: CURSOR_PUSH, value: startedAt },
    { key: CURSOR_PULL, value: pulled.cursor ?? pullCursor },
  ]);
  await local.deletions.where("deletedAt").belowOrEqual(startedAt).delete();

  return { startedAt, pushed: toPush.length, pulled: pulled.rows.length, applied };
}

/** Count of local records and tombstones newer than the last push. */
export async function pendingChanges(local: KeelDB): Promise<number> {
  const lastPush = ((await local.settings.get(CURSOR_PUSH))?.value as string | undefined) ?? null;
  let n = 0;
  for (const tbl of SYNCED_TABLES) {
    const rows = (await local.table(tbl).toArray()) as Record<string, unknown>[];
    for (const r of rows) if (!lastPush || versionOf(tbl, r) >= lastPush) n += 1;
  }
  for (const t of await local.deletions.toArray()) if (!lastPush || t.deletedAt >= lastPush) n += 1;
  return n;
}

export async function resetCursors(local: KeelDB) {
  await local.settings.bulkDelete([CURSOR_PUSH, CURSOR_PULL]);
}
