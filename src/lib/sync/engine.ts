import { nanoid } from "nanoid";
import type { KeelDB } from "@/lib/db";
import { SYNCED_TABLES, type SyncedTable } from "@/lib/db";
import type { NoteVersion, SyncConflict } from "@/lib/types";
import type { RemoteAdapter, RemoteRow, SyncResult } from "./types";

// One sync = collect local changes since the last push, pull remote changes
// since the last pull, merge with last-write-wins on the record's own
// version, push what survived, advance both cursors. Every step is safe to
// repeat: a crash before the cursors are saved simply replays next time.
//
// When both sides changed a record since the last sync and the content
// differs, the newer edit still wins but the other is kept, never dropped: a
// note's losing text becomes a "sync conflict" version in its history, any
// other record is copied into a conflict record. Each conflict is listed in
// syncConflicts and pushed with this sync, so every device can review it.

export const CURSOR_PUSH = "sync.cursor.push";
export const CURSOR_PULL = "sync.cursor.pull";
/**
 * `tbl:id` → version for every row the last sync pushed or applied: versions
 * the remote is known to hold. A pulled row with one of these versions is our
 * own push coming back, and a local row with one is not an unsynced edit.
 */
export const KNOWN = "sync.known";

/** The version stamp a table's records carry. Immutable tables use their creation time. */
export function versionOf(tbl: string, row: Record<string, unknown>): string {
  if (tbl === "issueEvents") return String(row.at ?? "");
  if (tbl === "updates") return String(row.createdAt ?? "");
  return String(row.updatedAt ?? row.createdAt ?? "");
}

function isSynced(tbl: string): tbl is SyncedTable {
  return (SYNCED_TABLES as readonly string[]).includes(tbl);
}

/** JSON with sorted keys and undefined dropped, so stored and pulled copies compare equal. */
function canonical(v: unknown, skip?: string): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined && k !== skip)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Two copies of a record say the same thing: equal apart from their version stamp. A missing copy is a delete. */
export function sameContent(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return canonical(a, "updatedAt") === canonical(b, "updatedAt");
}

/** What the conflict list calls a record. */
function titleOf(row: Record<string, unknown>): string {
  const label = row.title ?? row.name ?? row.reason;
  if (typeof label === "string" && label.trim()) return label;
  if (typeof row.number === "number") return `#${row.number}`;
  return "";
}

/** A local version the remote does not have yet: newer than the last push and not one it is known to hold. */
function isChange(lastPush: string | null, known: Record<string, string>, key: string, version: string) {
  return (!lastPush || version >= lastPush) && known[key] !== version;
}

async function readKnown(local: KeelDB) {
  return ((await local.settings.get(KNOWN))?.value as Record<string, string> | undefined) ?? {};
}

export interface SyncHooks {
  /** Wraps local writes made on behalf of the remote, so change listeners can ignore them. */
  applying?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export async function syncOnce(remote: RemoteAdapter, local: KeelDB, hooks: SyncHooks = {}): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const lastPush = ((await local.settings.get(CURSOR_PUSH))?.value as string | undefined) ?? null;
  const pullCursor = ((await local.settings.get(CURSOR_PULL))?.value as string | undefined) ?? null;
  const known = await readKnown(local);
  const seen: Record<string, string> = {};

  // 1. Local changes since the last push.
  const push = new Map<string, RemoteRow>();
  for (const tbl of SYNCED_TABLES) {
    const rows = (await local.table(tbl).toArray()) as Record<string, unknown>[];
    for (const r of rows) {
      const v = versionOf(tbl, r);
      if (isChange(lastPush, known, `${tbl}:${r.id}`, v)) push.set(`${tbl}:${r.id}`, { tbl, id: String(r.id), data: r, updated_at: v, deleted_at: null });
    }
  }
  for (const t of await local.deletions.toArray()) {
    if (isChange(lastPush, known, `${t.tbl}:${t.id}`, t.deletedAt)) push.set(`${t.tbl}:${t.id}`, { tbl: t.tbl, id: t.id, data: null, updated_at: t.deletedAt, deleted_at: t.deletedAt });
  }

  // 2. Remote changes since the last pull.
  const pulled = await remote.pull(pullCursor);

  // 3. Merge. A remote row wins only when it is strictly newer than what we
  //    hold (a record, or a tombstone for it); otherwise our version stays and
  //    is pushed. When both sides changed, the loser is kept (see top).
  let applied = 0;
  let conflicts = 0;
  const apply = hooks.applying ?? (<T,>(fn: () => Promise<T>) => fn());

  /** Store a row this sync wrote on its own account, and send it with this push. */
  async function add(tbl: "noteVersions" | "syncConflicts", row: NoteVersion | SyncConflict) {
    await local.table(tbl).add(row);
    push.set(`${tbl}:${row.id}`, { tbl, id: row.id, data: { ...row }, updated_at: row.updatedAt, deleted_at: null });
  }

  /** Keep the copy that lost to `winner` (null when the winner is a delete). */
  async function keepLoser(tbl: SyncedTable, recordId: string, loser: Record<string, unknown>, winner: Record<string, unknown> | null) {
    if (tbl === "syncConflicts" || sameContent(loser, winner)) return;
    const now = new Date().toISOString();
    const conflict: SyncConflict = { id: nanoid(12), tbl, recordId, title: titleOf(loser), createdAt: now, updatedAt: now };
    if (tbl === "notes" && winner && (loser.title !== winner.title || loser.body !== winner.body)) {
      const version: NoteVersion = { id: nanoid(12), noteId: recordId, title: String(loser.title ?? ""), body: String(loser.body ?? ""), savedAt: now, updatedAt: now, label: "sync-conflict" };
      await add("noteVersions", version);
      conflict.versionId = version.id;
    } else {
      conflict.data = loser;
      if (!winner) conflict.winnerDeleted = true;
    }
    await add("syncConflicts", conflict);
    conflicts += 1;
  }

  await apply(async () => {
    await local.transaction("rw", [...SYNCED_TABLES.map((t) => local.table(t)), local.deletions], async () => {
      for (const rr of pulled.rows) {
        if (!isSynced(rr.tbl)) continue;
        const key = `${rr.tbl}:${rr.id}`;
        const table = local.table(rr.tbl);
        const localRow = (await table.get(rr.id)) as Record<string, unknown> | undefined;
        const tomb = await local.deletions.get(rr.id);
        const localVersion = localRow ? versionOf(rr.tbl, localRow) : tomb && tomb.tbl === rr.tbl ? tomb.deletedAt : null;
        const remoteVersion = rr.deleted_at ?? rr.updated_at;
        // Both changed: ours waits to be pushed, and theirs is not our own
        // last push coming back.
        const bothChanged = push.has(key) && known[key] !== remoteVersion;
        if (localVersion && localVersion >= remoteVersion) {
          // Ours is pushed over theirs.
          if (bothChanged && rr.data) await keepLoser(rr.tbl, rr.id, rr.data, localRow ?? null);
          continue;
        }
        if (bothChanged && localRow) await keepLoser(rr.tbl, rr.id, localRow, rr.deleted_at ? null : rr.data);
        push.delete(key);
        if (rr.deleted_at) {
          if (localRow) await table.delete(rr.id);
        } else if (rr.data) {
          await table.put(rr.data);
        }
        if (tomb && tomb.tbl === rr.tbl) await local.deletions.delete(rr.id);
        seen[key] = remoteVersion;
        applied += 1;
      }
    });
  });

  // 4. Push what survived the merge. What the remote holds is recorded only
  //    after the push succeeds: recorded first, a failed push would mark these
  //    edits as delivered and they would never be sent. If a crash lands
  //    between the push and step 5, the next pull brings our own copies back
  //    and sameContent() keeps them from being taken for conflicts.
  const toPush = [...push.values()];
  if (toPush.length) await remote.push(toPush);
  for (const r of toPush) seen[`${r.tbl}:${r.id}`] = r.deleted_at ?? r.updated_at;

  // 5. Cursors, then prune tombstones that have now been delivered. Known
  //    versions older than the new push cursor no longer matter.
  const stillNew = Object.entries(known).filter(([, v]) => v >= startedAt);
  await local.settings.bulkPut([
    { key: CURSOR_PUSH, value: startedAt },
    { key: CURSOR_PULL, value: pulled.cursor ?? pullCursor },
    { key: KNOWN, value: { ...Object.fromEntries(stillNew), ...seen } },
  ]);
  await local.deletions.where("deletedAt").belowOrEqual(startedAt).delete();

  return { startedAt, pushed: toPush.length, pulled: pulled.rows.length, applied, conflicts };
}

/** Count of local records and tombstones the next sync would push. */
export async function pendingChanges(local: KeelDB): Promise<number> {
  const lastPush = ((await local.settings.get(CURSOR_PUSH))?.value as string | undefined) ?? null;
  const known = await readKnown(local);
  let n = 0;
  for (const tbl of SYNCED_TABLES) {
    const rows = (await local.table(tbl).toArray()) as Record<string, unknown>[];
    for (const r of rows) if (isChange(lastPush, known, `${tbl}:${r.id}`, versionOf(tbl, r))) n += 1;
  }
  for (const t of await local.deletions.toArray()) if (isChange(lastPush, known, `${t.tbl}:${t.id}`, t.deletedAt)) n += 1;
  return n;
}

export async function resetCursors(local: KeelDB) {
  await local.settings.bulkDelete([CURSOR_PUSH, CURSOR_PULL, KNOWN]);
}
