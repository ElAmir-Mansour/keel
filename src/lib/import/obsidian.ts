import { NOTE_STATUSES, type Note, type NoteKind, type NoteStatus } from "@/lib/types";
import { asList, parseFrontMatter } from "./frontmatter";

// Markdown files from an Obsidian vault (or any folder). The relative path
// becomes the folder, the file name the title, front-matter the properties.
// [[wikilinks]] are the same syntax, so they keep working.

export interface VaultFile {
  path: string; // relative, "/" separated
  text: string;
  modifiedAt?: number; // epoch ms
}

export interface ObsidianPlan {
  notes: Omit<Note, "id">[];
  skipped: string[]; // non-markdown or unreadable
}

const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

function kindFor(title: string, folder: string, fm: Record<string, string | string[]>): NoteKind {
  const k = String(fm.kind ?? fm.type ?? "").toLowerCase();
  const known: NoteKind[] = ["page", "daily", "meeting", "oneonone", "retro", "quick", "prd", "rfc", "runbook", "postmortem", "weekly"];
  if (known.includes(k as NoteKind)) return k as NoteKind;
  if (k === "1:1" || k === "1-1" || k === "one-on-one") return "oneonone";
  if (DAILY_RE.test(title) || /^(daily|journal)/i.test(folder)) return "daily";
  if (/meeting/i.test(folder)) return "meeting";
  if (/1-1|1:1|one-on-one/i.test(folder)) return "oneonone";
  if (/retro/i.test(folder)) return "retro";
  if (/runbook/i.test(folder)) return "runbook";
  if (/post-?mortem|incident/i.test(folder)) return "postmortem";
  if (/spec|prd|rfc|design/i.test(folder)) return "rfc";
  return "page";
}

export function planObsidian(files: VaultFile[]): ObsidianPlan {
  const plan: ObsidianPlan = { notes: [], skipped: [] };
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith(".md")) {
      plan.skipped.push(f.path);
      continue;
    }
    if (f.path.split("/").some((seg) => seg.startsWith("."))) {
      plan.skipped.push(f.path); // .obsidian, .trash
      continue;
    }
    const parts = f.path.split("/");
    const file = parts.pop() ?? f.path;
    const title = file.replace(/\.md$/i, "").trim() || "Untitled";
    const folder = parts.join("/") || "Pages";
    const { data, body } = parseFrontMatter(f.text);
    const kind = kindFor(title, folder, data);
    const dateRaw = String(data.date ?? data.created ?? "");
    const date = /^\d{4}-\d{2}-\d{2}/.test(dateRaw)
      ? dateRaw.slice(0, 10)
      : DAILY_RE.test(title)
        ? title
        : new Date(f.modifiedAt ?? Date.now()).toISOString().slice(0, 10);
    const statusRaw = String(data.status ?? "").toLowerCase().replace(/\s+/g, "_");
    const status = NOTE_STATUSES.some((s) => s.value === statusRaw) ? (statusRaw as NoteStatus) : undefined;
    const inline = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
    const tags = [...new Set([...asList(data.tags), ...asList(data.tag), ...inline])];
    const stamp = new Date(f.modifiedAt ?? Date.now()).toISOString();
    plan.notes.push({
      kind,
      folder,
      title,
      date,
      status,
      body: body.trim(),
      tags,
      pinned: String(data.pinned ?? "").toLowerCase() === "true",
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  return plan;
}
