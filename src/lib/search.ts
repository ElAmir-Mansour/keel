import type { Decision, Issue, Note, Project } from "./types";

export interface SearchHit {
  kind: "note" | "issue" | "decision" | "project";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
}

function score(q: string, title: string, body: string) {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  if (b.includes(q)) return 30;
  return 0;
}

export function searchAll(
  query: string,
  data: { notes: Note[]; issues: Issue[]; decisions: Decision[]; projects: Project[] },
  limit = 12,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const p of data.projects) {
    const s = score(q, p.name, p.description + " " + p.key);
    if (s) hits.push({ kind: "project", id: p.id, title: p.name, subtitle: p.key, href: `/projects/${p.id}`, score: s + 5 });
  }
  const byId = new Map(data.projects.map((p) => [p.id, p]));
  for (const i of data.issues) {
    const p = byId.get(i.projectId);
    const key = p ? `${p.key}-${i.seq}` : "";
    const s = Math.max(score(q, i.title, i.description), key.toLowerCase().startsWith(q) ? 90 : 0);
    if (s && p) hits.push({ kind: "issue", id: i.id, title: i.title, subtitle: key, href: `/projects/${p.id}/issues/${i.seq}`, score: s });
  }
  for (const n of data.notes) {
    const s = score(q, n.title, n.body + " " + n.tags.join(" "));
    if (s) hits.push({ kind: "note", id: n.id, title: n.title, subtitle: n.folder, href: `/notes/${n.id}`, score: s });
  }
  for (const d of data.decisions) {
    const s = score(q, d.title, d.context + " " + d.decision);
    if (s) hits.push({ kind: "decision", id: d.id, title: d.title, subtitle: `ADR-${d.seq}`, href: `/decisions/${d.id}`, score: s });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
