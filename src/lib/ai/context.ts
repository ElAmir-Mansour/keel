import { subDays } from "date-fns";
import { db } from "@/lib/db";
import { semanticReady, semanticSearch } from "./semantic";
import { todayYMD } from "@/lib/dates";
import { isOpen, milestoneProgress } from "@/lib/metrics";
import {
  HEALTHS,
  ISSUE_STATUSES,
  NOTE_KINDS,
  RISK_KINDS,
  issueKey,
  riskScore,
  type Health,
  type Issue,
} from "@/lib/types";
import { backlinksTo, extractLinks, resolveLink } from "@/lib/wikilinks";

// Builders that turn the vault into compact markdown for the model. Each one
// reads Dexie directly (reads are fine outside repo.ts) and clips itself to a
// character budget, because the whole point of a local-first assistant is that
// the user can see, and bound, what leaves the device.

export const CONTEXT_BUDGET = 24_000;

export function clip(text: string, max: number) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Join parts in priority order, truncating whatever no longer fits. */
export function fitBudget(parts: (string | null | undefined)[], total = CONTEXT_BUDGET) {
  const out: string[] = [];
  let left = total;
  for (const p of parts) {
    if (!p) continue;
    if (left <= 200) break;
    const piece = clip(p, left);
    out.push(piece);
    left -= piece.length + 7;
  }
  return out.join("\n\n---\n\n");
}

const healthLabel = (h?: Health | null) => HEALTHS.find((x) => x.value === h)?.label ?? "No update";
const statusLabel = (s: Issue["status"]) => ISSUE_STATUSES.find((x) => x.value === s)?.label ?? s;
const byDue = (a: Issue, b: Issue) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

function firstLine(body: string, max = 120) {
  const line =
    body
      .split(/\r?\n/)
      .map((l) => l.replace(/^[\s#>*+-]+/, "").replace(/^\[[ xX]\]\s*/, "").trim())
      .find(Boolean) ?? "";
  return clip(line, max);
}

// ----- overview --------------------------------------------------------------

export async function workspaceOverview(): Promise<string> {
  const [projects, noteCount, issues, decisionCount, risks, updates, timelines] = await Promise.all([
    db.projects.toArray(),
    db.notes.count(),
    db.issues.toArray(),
    db.decisions.count(),
    db.risks.toArray(),
    db.updates.toArray(),
    db.timelines.toArray(),
  ]);
  const active = projects.filter((p) => p.status === "active" || p.status === "paused");
  const latestUpdate = (pid: string) =>
    updates.filter((u) => u.projectId === pid).sort((a, b) => b.date.localeCompare(a.date))[0];
  const projectBits = active.map((p) => {
    const u = latestUpdate(p.id);
    const health = u ? `${healthLabel(u.health)} as of ${u.date}` : "no update yet";
    return `${p.name} (${p.key}): ${health}${p.status === "paused" ? ", paused" : ""}`;
  });
  const open = issues.filter(isOpen);
  const doing = open.filter((i) => i.status === "in_progress" || i.status === "in_review").length;
  const triage = open.filter((i) => i.status === "triage").length;
  const openRisks = risks.filter((r) => r.status === "open" || r.status === "mitigating").length;
  const today = new Date();
  const weekday = today.toLocaleDateString("en-US", { weekday: "long" });
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    `Today is ${todayYMD(today)} (${weekday}).`,
    `Workspace: ${plural(active.length, "active project")}${projectBits.length ? ` — ${projectBits.join("; ")}` : ""}.`,
    `${plural(noteCount, "note")}, ${plural(open.length, "open issue")} (${doing} in progress, ${triage} in triage), ${plural(decisionCount, "decision")}, ${plural(openRisks, "open risk")}.`,
    timelines.length ? `Timelines: ${timelines.map((tl) => `“${tl.title}” (${tl.entries.length} entries)`).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// ----- one note ---------------------------------------------------------------

export async function noteContext(noteId: string, budget = 12_000): Promise<string | null> {
  const note = await db.notes.get(noteId);
  if (!note) return null;
  const [notes, issues, decisions, projects, person] = await Promise.all([
    db.notes.toArray(),
    db.issues.toArray(),
    db.decisions.toArray(),
    db.projects.toArray(),
    note.personId ? db.people.get(note.personId) : undefined,
  ]);
  const idx = { notes, issues, decisions, projects };
  const project = projects.find((p) => p.id === note.projectId);

  const meta = [
    `Kind: ${NOTE_KINDS.find((k) => k.value === note.kind)?.label ?? note.kind}`,
    `Folder: ${note.folder}`,
    `Date: ${note.date}`,
    note.status ? `Status: ${note.status}` : null,
    project ? `Project: ${project.name} (${project.key})` : null,
    person ? `About: ${person.name}` : null,
    note.tags.length ? `Tags: ${note.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const linked: string[] = [];
  const seen = new Set<string>();
  for (const l of extractLinks(note.body)) {
    const key = l.target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const r = resolveLink(l.target, idx);
    if (r.kind === "note" && r.note.id !== note.id) linked.push(`- [[${r.note.title}]] — ${firstLine(r.note.body)}`);
    else if (r.kind === "issue") linked.push(`- ${r.label} ${r.issue.title} (${statusLabel(r.issue.status)})`);
    else if (r.kind === "decision") linked.push(`- ADR-${r.decision.seq} ${r.decision.title} (${r.decision.status})`);
    if (linked.length >= 12) break;
  }
  const backlinks = backlinksTo([note.title], notes)
    .filter((n) => n.id !== note.id)
    .slice(0, 12)
    .map((n) => `- [[${n.title}]] — ${firstLine(n.body)}`);

  const head = `# Note: ${note.title}\n${meta}\n\n## Body\n`;
  const tail =
    (linked.length ? `\n\n## Links out\n${linked.join("\n")}` : "") +
    (backlinks.length ? `\n\n## Backlinks\n${backlinks.join("\n")}` : "");
  const bodyBudget = Math.max(1_500, budget - head.length - tail.length);
  return head + clip(note.body || "(empty)", bodyBudget) + tail;
}

// ----- one project's recent activity ------------------------------------------

export async function projectContext(projectId: string, days = 7, budget = 8_000): Promise<string | null> {
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const [milestones, issues, risks, updates, decisions, people] = await Promise.all([
    db.milestones.where({ projectId }).sortBy("order"),
    db.issues.where({ projectId }).toArray(),
    db.risks.where({ projectId }).toArray(),
    db.updates.where({ projectId }).toArray(),
    db.decisions.where({ projectId }).toArray(),
    db.people.toArray(),
  ]);
  const name = (id?: string) => people.find((p) => p.id === id)?.name;
  const key = (i: Issue) => issueKey(project, i);
  const sinceISO = subDays(new Date(), days).toISOString();
  const sinceYMD = sinceISO.slice(0, 10);
  const today = todayYMD();

  updates.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const latest = updates[0];
  const done = issues
    .filter((i) => i.status === "done" && i.completedAt && i.completedAt >= sinceISO)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const doing = issues.filter((i) => i.status === "in_progress" || i.status === "in_review").sort(byDue);
  const todo = issues.filter((i) => i.status === "todo").sort(byDue);
  const queued = issues.filter((i) => i.status === "backlog" || i.status === "triage").length;
  const openRisks = risks
    .filter((r) => r.status === "open" || r.status === "mitigating")
    .sort((a, b) => riskScore(b) - riskScore(a));
  const recentDecisions = decisions.filter((d) => d.date >= sinceYMD).sort((a, b) => b.date.localeCompare(a.date));

  const issueLine = (i: Issue) => {
    const bits = [
      name(i.assigneeId),
      i.dueDate ? `due ${i.dueDate}${i.dueDate < today ? " (overdue)" : ""}` : null,
      i.status === "in_review" ? "in review" : null,
    ].filter(Boolean);
    return `- ${key(i)} ${i.title}${bits.length ? ` — ${bits.join(", ")}` : ""}`;
  };

  const sections = [
    `# Project: ${project.name} (${project.key})`,
    project.description ? clip(project.description, 600) : null,
    [
      `- Status: ${project.status}${project.targetDate ? ` · Target date: ${project.targetDate}` : ""}${name(project.leadId) ? ` · Lead: ${name(project.leadId)}` : ""}`,
      `- Health: ${latest ? `${healthLabel(latest.health)} (update of ${latest.date})` : "no update posted yet"}`,
    ].join("\n"),
    milestones.length
      ? `## Milestones\n${milestones
          .map((m) => {
            const p = milestoneProgress(m, issues);
            return `- ${m.title} — ${m.status}${m.dueDate ? `, due ${m.dueDate}` : ""}, ${p.done}/${p.total} issues done (${p.pct}%)`;
          })
          .join("\n")}`
      : null,
    `## Done in the last ${days} days (${done.length})\n${
      done
        .slice(0, 25)
        .map((i) => `- ${key(i)} ${i.title} — done ${(i.completedAt ?? "").slice(0, 10)}`)
        .join("\n") || "- Nothing completed."
    }`,
    `## In progress (${doing.length})\n${doing.slice(0, 20).map(issueLine).join("\n") || "- Nothing in progress."}`,
    `## Todo (${todo.length}${queued ? `, plus ${queued} in backlog/triage` : ""})\n${
      todo.slice(0, 15).map(issueLine).join("\n") || "- Nothing queued."
    }`,
    `## Open risks (${openRisks.length})\n${
      openRisks
        .slice(0, 12)
        .map((r) => {
          const kind = RISK_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind;
          const owner = name(r.ownerId);
          return `- R-${r.seq} [${kind}] ${r.title} — likelihood ${r.likelihood} × impact ${r.impact} = ${riskScore(r)}, ${r.status}${owner ? `, owner ${owner}` : ""}${r.mitigation ? `; mitigation: ${clip(r.mitigation, 160)}` : ""}`;
        })
        .join("\n") || "- None open."
    }`,
    updates.length
      ? `## Latest updates\n${updates
          .slice(0, 2)
          .map((u) => `### ${u.date} — ${healthLabel(u.health)}\n${clip(u.summary, 800)}`)
          .join("\n\n")}`
      : null,
    recentDecisions.length
      ? `## Decisions in the last ${days} days\n${recentDecisions
          .slice(0, 8)
          .map((d) => `- ADR-${d.seq} ${d.title} (${d.status}, ${d.date})`)
          .join("\n")}`
      : null,
  ];
  return clip(sections.filter(Boolean).join("\n\n"), budget);
}

// ----- "ask your vault" keyword retrieval -------------------------------------

const STOP = new Set([
  "the", "and", "for", "with", "what", "how", "why", "when", "who", "which", "where", "is", "are", "was", "were",
  "this", "that", "these", "those", "about", "from", "into", "our", "we", "my", "me", "of", "to", "in", "on", "at",
  "a", "an", "it", "do", "does", "did", "have", "has", "had", "be", "been", "can", "could", "should", "would",
  "will", "not", "any", "all", "there", "tell", "show", "list", "give", "please",
  "في", "من", "على", "عن", "إلى", "الى", "ما", "هل", "هذا", "هذه", "أن", "ان", "أو", "او", "و", "ماذا", "كيف",
  "لماذا", "متى", "أين", "اين", "هو", "هي", "مع", "كل", "لم", "لا",
]);

export function queryTerms(query: string) {
  const out = new Set<string>();
  for (const m of query.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)) {
    const t = m[0];
    if (t.length >= 2 && !STOP.has(t)) out.add(t);
  }
  return [...out];
}

interface Doc {
  id: string;
  kind: "Note" | "Issue" | "Decision";
  title: string;
  subtitle: string;
  tags: string[];
  body: string;
  /** What a [[wikilink]] to this record resolves through. */
  link: string;
}

export interface Source {
  n: number;
  kind: "Note" | "Issue" | "Decision";
  title: string;
  /** Wikilink target: the note title, PLAT-12 or ADR-3. */
  link: string;
}

export async function vaultRetrieval(query: string, k = 8, budget = 6_000): Promise<string | null> {
  return (await vaultRetrievalWithSources(query, k, budget))?.text ?? null;
}

/** Excerpts numbered [1]…[k] so the answer can cite them, plus the source list. */
export async function vaultRetrievalWithSources(query: string, k = 8, budget = 6_000): Promise<{ text: string; sources: Source[] } | null> {
  const terms = queryTerms(query);
  if (!terms.length && !semanticReady()) return null;
  const [notes, issues, decisions, projects] = await Promise.all([
    db.notes.toArray(),
    db.issues.toArray(),
    db.decisions.toArray(),
    db.projects.toArray(),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const docs: Doc[] = [
    ...notes.map((n) => ({ id: n.id, kind: "Note" as const, title: n.title, subtitle: n.folder, tags: n.tags, body: n.body, link: n.title })),
    ...issues.map((i) => {
      const p = byId.get(i.projectId);
      return {
        id: i.id,
        kind: "Issue" as const,
        title: i.title,
        subtitle: `${p ? issueKey(p, i) : "?"}, ${statusLabel(i.status)}`,
        tags: i.labels,
        body: i.description,
        link: p ? issueKey(p, i) : i.title,
      };
    }),
    ...decisions.map((d) => ({
      id: d.id,
      kind: "Decision" as const,
      title: d.title,
      subtitle: `ADR-${d.seq}, ${d.status}`,
      tags: d.tags,
      body: [d.context, d.decision, d.consequences].filter(Boolean).join("\n\n"),
      link: `ADR-${d.seq}`,
    })),
  ];

  const phrase = query.trim().toLowerCase();
  const scored = docs
    .map((d) => {
      const title = d.title.toLowerCase();
      const tags = d.tags.join(" ").toLowerCase();
      const body = d.body.toLowerCase();
      let score = phrase && title.includes(phrase) ? 4 : 0;
      let best = -1;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        if (tags.includes(t)) score += 2;
        let idx = body.indexOf(t);
        let hits = 0;
        while (idx !== -1 && hits < 3) {
          if (best === -1 || idx < best) best = idx;
          hits += 1;
          idx = body.indexOf(t, idx + t.length);
        }
        score += hits;
      }
      return { d, score, best };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k) as { d: Doc; score: number; best: number; excerpt?: string }[];

  // Meaning-based hits fill in what the words missed, when the index is on.
  if (semanticReady()) {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const seen = new Set(scored.map((x) => x.d.id));
    for (const h of await semanticSearch(query, k)) {
      const d = byId.get(h.recordId);
      if (!d || seen.has(d.id)) continue;
      scored.push({ d, score: h.score * 10, best: -1, excerpt: h.text });
    }
    scored.sort((a, b) => b.score - a.score);
    scored.splice(k);
  }
  if (!scored.length) return null;

  const perDoc = Math.max(300, Math.floor((budget - 200) / scored.length) - 80);
  const sources: Source[] = scored.map(({ d }, idx) => ({ n: idx + 1, kind: d.kind, title: d.title, link: d.link }));
  const blocks = scored.map(({ d, best, excerpt: pre }, idx) => {
    let excerpt: string;
    if (pre) excerpt = clip(pre, perDoc);
    else if (!d.body.trim()) excerpt = "(no body)";
    else if (best === -1) excerpt = clip(d.body, Math.min(perDoc, 300));
    else {
      const start = Math.max(0, best - Math.floor(perDoc / 3));
      const end = Math.min(d.body.length, start + perDoc);
      excerpt = `${start > 0 ? "…" : ""}${d.body.slice(start, end).trim()}${end < d.body.length ? "…" : ""}`;
    }
    return `### [${idx + 1}] ${d.kind}: ${d.title} (${d.subtitle})\n${excerpt.replace(/\n{3,}/g, "\n\n")}`;
  });
  const text = clip(`## Vault excerpts for "${clip(query, 80)}"\nCite the excerpts you rely on as [n].\n\n${blocks.join("\n\n")}`, budget);
  return { text, sources };
}
