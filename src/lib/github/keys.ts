// Issue keys mentioned in branch names, PR titles, bodies and commit
// messages: PLAT-12, plat-12 in a branch like feat/plat-12-audit-log.

const KEY_RE = /(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,6})(?![A-Za-z0-9])/g;

/** Unique keys (upper-cased) found in the text that belong to known project keys. */
export function extractIssueKeys(text: string, knownKeys: Iterable<string>): { key: string; seq: number }[] {
  const known = new Set([...knownKeys].map((k) => k.toUpperCase()));
  const out = new Map<string, { key: string; seq: number }>();
  for (const m of text.matchAll(KEY_RE)) {
    const key = m[1].toUpperCase();
    if (!known.has(key)) continue;
    const seq = Number(m[2]);
    out.set(`${key}-${seq}`, { key, seq });
  }
  return [...out.values()];
}

export function parseRepo(input: string): { owner: string; name: string } | null {
  const t = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
  const m = t.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

export function parseRepoList(text: string) {
  return text
    .split(/[\s,]+/)
    .map(parseRepo)
    .filter((r): r is { owner: string; name: string } => r !== null);
}
