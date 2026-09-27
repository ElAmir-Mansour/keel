"use client";
import { getISOWeek, getISOWeekYear, startOfISOWeek, subDays } from "date-fns";
import { useSyncExternalStore } from "react";
import { db } from "@/lib/db";
import { createNote } from "@/lib/repo";
import { ymd } from "@/lib/dates";
import { HEALTHS, issueKey, riskScore, type Note } from "@/lib/types";
import { getApiKey, streamChat } from "./client";
import { projectContext } from "./context";
import { buildSystem } from "./prompts";

// A weekly digest note across every active project, written on the chosen
// weekday the first time Keel is opened that week. With an API key the
// assistant writes it from the activity; without one a plain draft is built
// from the same facts, so the habit never depends on the model.

const KEY_ENABLED = "keel.digest.enabled";
const KEY_DAY = "keel.digest.weekday";
const KEY_LAST = "keel.digest.lastWeek";
const KEY_LAST_AT = "keel.digest.lastAt";

export interface DigestSettings {
  enabled: boolean;
  weekday: number; // 1 = Monday … 7 = Sunday
  lastWeek: string | null;
  lastAt: string | null;
  running: boolean;
}

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

let state: DigestSettings = { enabled: false, weekday: 1, lastWeek: null, lastAt: null, running: false };
const SERVER: DigestSettings = { ...state };
const listeners = new Set<() => void>();
function set(patch: Partial<DigestSettings>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function load() {
  set({ enabled: read(KEY_ENABLED) === "1", weekday: Number(read(KEY_DAY) ?? 1) || 1, lastWeek: read(KEY_LAST), lastAt: read(KEY_LAST_AT) });
}
export function useDigestSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}
export function setDigestEnabled(on: boolean) {
  localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  set({ enabled: on });
}
export function setDigestWeekday(day: number) {
  localStorage.setItem(KEY_DAY, String(day));
  set({ weekday: day });
}

export function weekKey(d = new Date()) {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

/** Plain draft from the week's facts, no model involved. */
export async function localWeeklyDraft(projectId: string, days = 7): Promise<string | null> {
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const since = subDays(new Date(), days).toISOString();
  const [issues, risks, updates, milestones] = await Promise.all([
    db.issues.where({ projectId }).toArray(),
    db.risks.where({ projectId }).toArray(),
    db.updates.where({ projectId }).toArray(),
    db.milestones.where({ projectId }).toArray(),
  ]);
  const latest = updates.sort((a, b) => b.date.localeCompare(a.date))[0];
  const health = HEALTHS.find((h) => h.value === latest?.health)?.label ?? "No update yet";
  const done = issues.filter((i) => i.status === "done" && i.completedAt && i.completedAt >= since);
  const next = issues
    .filter((i) => i.status === "in_progress" || i.status === "in_review" || i.status === "todo")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 6);
  const hot = risks.filter((r) => r.status !== "closed" && riskScore(r) >= 10).sort((a, b) => riskScore(b) - riskScore(a));
  const overdueMs = milestones.filter((m) => m.status !== "done" && m.dueDate && m.dueDate < ymd(new Date()));
  const line = (arr: string[]) => (arr.length ? arr.map((x) => `- ${x}`).join("\n") : "- Nothing this week.");
  return [
    `## Health`,
    `${health}${overdueMs.length ? ` — ${overdueMs.length} milestone${overdueMs.length === 1 ? "" : "s"} overdue (${overdueMs.map((m) => m.title).join(", ")})` : ""}`,
    ``,
    `## Shipped this week`,
    line(done.map((i) => `${issueKey(project, i)} ${i.title}`)),
    ``,
    `## Next week`,
    line(next.map((i) => `${issueKey(project, i)} ${i.title}${i.dueDate ? ` (due ${i.dueDate})` : ""}`)),
    ``,
    `## Risks and asks`,
    line(hot.map((r) => `${r.title} (score ${riskScore(r)}, ${r.status})`)),
  ].join("\n");
}

export async function buildDigest(useAI: boolean): Promise<{ body: string; ai: boolean }> {
  const projects = await db.projects.where("status").equals("active").sortBy("name");
  if (useAI && getApiKey()) {
    try {
      const contexts = (await Promise.all(projects.map((p) => projectContext(p.id, 7, 5_000)))).filter(Boolean).join("\n\n");
      const prompt = `Write this week's digest for every project in the context. For each project, in order, output:

## <Project name> — <On track | At risk | Off track>
### Shipped this week
- …
### Next week
- …
### Risks and asks
- …

Use issue keys (PLAT-12) and milestone names, keep each project under 120 words, and write "- Nothing this week." under an empty section. Justify each health verdict in one short sentence right after the heading. Return only the markdown.`;
      const text = await streamChat({ system: buildSystem(contexts), messages: [{ role: "user", content: prompt }] }, () => {});
      if (text.trim()) return { body: text.trim(), ai: true };
    } catch {
      // Fall through to the plain draft.
    }
  }
  const parts: string[] = [];
  for (const p of projects) {
    const d = await localWeeklyDraft(p.id);
    if (d) parts.push(`## ${p.name}\n\n${d.replace(/^## /gm, "### ")}`);
  }
  return { body: parts.join("\n\n") || "No active projects this week.", ai: false };
}

export async function generateDigest(opts: { ai: boolean }): Promise<Note> {
  set({ running: true });
  try {
    const { body, ai } = await buildDigest(opts.ai);
    const weekStart = ymd(startOfISOWeek(new Date()));
    const note = await createNote({
      kind: "weekly",
      folder: "Updates",
      title: `Weekly digest — ${weekStart}`,
      body: `${body}\n\n_${ai ? "Drafted by the assistant" : "Drafted from activity"} on ${ymd(new Date())}._`,
      tags: ["digest"],
    });
    const wk = weekKey();
    localStorage.setItem(KEY_LAST, wk);
    localStorage.setItem(KEY_LAST_AT, new Date().toISOString());
    set({ lastWeek: wk, lastAt: new Date().toISOString() });
    return note;
  } finally {
    set({ running: false });
  }
}

/** On app start: write the digest once per week, on or after the chosen day. */
export async function maybeRunDigest(): Promise<Note | null> {
  load();
  if (!state.enabled || state.running) return null;
  const today = new Date();
  const iso = ((today.getDay() + 6) % 7) + 1; // 1 = Monday
  if (iso < state.weekday) return null;
  if (state.lastWeek === weekKey(today)) return null;
  if ((await db.projects.where("status").equals("active").count()) === 0) return null;
  return generateDigest({ ai: true });
}

export function bootDigest() {
  load();
}
