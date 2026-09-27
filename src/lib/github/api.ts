// Thin GitHub REST client for the browser. Works unauthenticated on public
// repositories (60 requests an hour) and with a fine-grained read-only token
// on private ones.

export interface GhPull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  draft?: boolean;
  head: { ref: string };
  user: { login: string } | null;
}

export interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

async function get<T>(path: string, token: string | null): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let msg = `GitHub returned ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* keep */
    }
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") msg = "GitHub rate limit reached; add a token in Settings or wait an hour.";
    throw new GitHubError(msg, res.status);
  }
  return (await res.json()) as T;
}

/** Pull requests updated after `since`, newest first, up to `max`. */
export async function listPulls(owner: string, repo: string, token: string | null, since: string | null, max = 100): Promise<GhPull[]> {
  const out: GhPull[] = [];
  for (let page = 1; out.length < max; page += 1) {
    const batch = await get<GhPull[]>(`/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50&page=${page}`, token);
    if (!batch.length) break;
    for (const p of batch) {
      if (since && p.updated_at <= since) return out;
      out.push(p);
      if (out.length >= max) break;
    }
    if (batch.length < 50) break;
  }
  return out;
}

/** Commits on the default branch since a date (or the last 100). */
export async function listCommits(owner: string, repo: string, token: string | null, since: string | null): Promise<GhCommit[]> {
  const q = since ? `?since=${encodeURIComponent(since)}&per_page=100` : "?per_page=100";
  return get<GhCommit[]>(`/repos/${owner}/${repo}/commits${q}`, token);
}

export async function checkAccess(owner: string, repo: string, token: string | null) {
  await get<unknown>(`/repos/${owner}/${repo}`, token);
}
