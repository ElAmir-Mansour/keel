import { db, TABLE_NAMES } from "./db";

export const EXPORT_FORMAT = "keel/1";

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<ExportFile> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction("r", TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) tables[t] = await db.table(t).toArray();
  });
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), tables };
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Replace everything with the contents of an export file. */
export async function importAll(file: ExportFile, mode: "replace" | "merge" = "replace") {
  if (!file || file.format !== EXPORT_FORMAT || typeof file.tables !== "object") {
    throw new Error("Not a Keel export file");
  }
  await db.transaction("rw", TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) {
      const rows = (file.tables[t] ?? []) as Record<string, unknown>[];
      if (mode === "replace") await db.table(t).clear();
      if (rows.length) await db.table(t).bulkPut(rows);
    }
  });
}

export async function clearAll() {
  await db.transaction("rw", TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) await db.table(t).clear();
  });
}

export async function countAll() {
  const out: Record<string, number> = {};
  for (const t of TABLE_NAMES) out[t] = await db.table(t).count();
  return out;
}
