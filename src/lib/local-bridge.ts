import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// The local folder bridge: when Keel runs on your own machine with
// KEEL_LOCAL_DIR set, it can read Markdown notes and JSON bundles that other
// tools (or an AI assistant working in your terminal) drop into that folder.
// Every route refuses requests that do not come from localhost, so a public
// deployment never exposes a filesystem.

export function localDir(): string | null {
  const raw = process.env.KEEL_LOCAL_DIR?.trim();
  if (!raw) return null;
  return raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
}

export function isLocalRequest(req: Request) {
  const host = (req.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

export function refuse() {
  return Response.json({ error: "local_only" }, { status: 404 });
}

export interface LocalNoteFile {
  path: string;
  text: string;
  modifiedAt: number;
}

const MAX_FILES = 2000;
const MAX_BYTES = 20 * 1024 * 1024;

/** Every .md under <dir>/vault, dot-folders skipped, capped for sanity. */
export async function readVault(dir: string): Promise<LocalNoteFile[]> {
  const root = path.join(dir, "vault");
  const out: LocalNoteFile[] = [];
  let bytes = 0;
  async function walk(rel: string) {
    let entries;
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(relPath);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        if (out.length >= MAX_FILES || bytes > MAX_BYTES) return;
        const full = path.join(root, relPath);
        const [text, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
        bytes += text.length;
        out.push({ path: relPath, text, modifiedAt: stat.mtimeMs });
      }
    }
  }
  await walk("");
  return out;
}

export interface LocalBundle {
  name: string;
  size: number;
  modifiedAt: number;
}

/** JSON bundles under <dir>/import. */
export async function listBundles(dir: string): Promise<LocalBundle[]> {
  const root = path.join(dir, "import");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const out: LocalBundle[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".json") || e.name.startsWith(".")) continue;
      const stat = await fs.stat(path.join(root, e.name));
      out.push({ name: e.name, size: stat.size, modifiedAt: stat.mtimeMs });
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    return [];
  }
}

export async function readBundle(dir: string, name: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._ -]+\.json$/.test(name)) return null;
  try {
    return await fs.readFile(path.join(dir, "import", name), "utf8");
  } catch {
    return null;
  }
}

export async function ensureLayout(dir: string) {
  for (const sub of ["vault", "import", "backups"]) await fs.mkdir(path.join(dir, sub), { recursive: true });
}
