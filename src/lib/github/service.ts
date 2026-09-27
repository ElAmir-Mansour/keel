"use client";
import { useSyncExternalStore } from "react";
import { db } from "@/lib/db";
import { transitionIssue } from "@/lib/repo";
import { nowISO } from "@/lib/dates";
import type { CodeLink, Issue, Project } from "@/lib/types";
import { checkAccess, listCommits, listPulls } from "./api";
import { extractIssueKeys, parseRepoList } from "./keys";

// Links pull requests and commits to issues by the keys they mention, and
// optionally moves issues along with the PR: opened → in review, merged →
// done, stamped with GitHub's own timestamps so cycle time reflects reality.
// Runs in the browser; nothing is stored server-side.

const KEY_TOKEN = "keel.github.token";
const KEY_REPOS = "keel.github.repos";
const KEY_AUTO = "keel.github.autoStatus";
const KEY_LAST = "keel.github.lastSyncAt";
const KEY_CURSORS = "keel.github.cursors";

export interface GithubStatus {
  configured: boolean;
  repos: string;
  hasToken: boolean;
  autoStatus: boolean;
  running: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastResult: { pulls: number; commits: number; linked: number; moved: number } | null;
}

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

let state: GithubStatus = { configured: false, repos: "", hasToken: false, autoStatus: false, running: false, lastSyncAt: null, lastError: null, lastResult: null };
const SERVER: GithubStatus = { ...state };
const listeners = new Set<() => void>();
function set(patch: Partial<GithubStatus>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
export function useGithubStatus() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}

function load() {
  const repos = read(KEY_REPOS) ?? "";
  set({ repos, configured: parseRepoList(repos).length > 0, hasToken: Boolean(read(KEY_TOKEN)), autoStatus: read(KEY_AUTO) === "1", lastSyncAt: read(KEY_LAST) });
}

export function saveGithubConfig(cfg: { repos: string; token: string; autoStatus: boolean }) {
  localStorage.setItem(KEY_REPOS, cfg.repos.trim());
  if (cfg.token.trim()) localStorage.setItem(KEY_TOKEN, cfg.token.trim());
  else localStorage.removeItem(KEY_TOKEN);
  localStorage.setItem(KEY_AUTO, cfg.autoStatus ? "1" : "0");
  load();
}

export function clearGithubConfig() {
  for (const k of [KEY_TOKEN, KEY_REPOS, KEY_AUTO, KEY_LAST, KEY_CURSORS]) localStorage.removeItem(k);
  load();
}

export function getGithubToken() {
  return read(KEY_TOKEN);
}

export async function testGithubAccess() {
  const repos = parseRepoList(read(KEY_REPOS) ?? "");
  if (!repos.length) throw new Error("Add at least one repository as owner/name.");
  for (const r of repos) await checkAccess(r.owner, r.name, getGithubToken());
}

function cursors(): Record<string, string> {
  try {
    return JSON.parse(read(KEY_CURSORS) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

let inFlight: Promise<void> | null = null;

export async function syncGithub(): Promise<void> {
  if (inFlight) return inFlight;
  const repos = parseRepoList(read(KEY_REPOS) ?? "");
  if (!repos.length) return;
  set({ running: true, lastError: null });
  inFlight = (async () => {
    const token = getGithubToken();
    const auto = read(KEY_AUTO) === "1";
    const cur = cursors();
    const projects = await db.projects.toArray();
    const byKey = new Map(projects.map((p) => [p.key.toUpperCase(), p]));
    const result = { pulls: 0, commits: 0, linked: 0, moved: 0 };
    try {
      for (const r of repos) {
        const full = `${r.owner}/${r.name}`;
        const since = cur[full] ?? null;
        const startedAt = nowISO();
        const [pulls, commits] = await Promise.all([listPulls(r.owner, r.name, token, since), listCommits(r.owner, r.name, token, since)]);
        result.pulls += pulls.length;
        result.commits += commits.length;
        for (const p of pulls) {
          const text = `${p.head.ref} ${p.title} ${p.body ?? ""}`;
          for (const k of extractIssueKeys(text, byKey.keys())) {
            const project = byKey.get(k.key);
            const issue = project ? await db.issues.where("[projectId+seq]").equals([project.id, k.seq]).first() : undefined;
            if (!project || !issue) continue;
            const link: CodeLink = {
              id: `pr:${full}#${p.number}`,
              issueId: issue.id,
              projectId: project.id,
              kind: "pr",
              repo: full,
              number: p.number,
              title: p.title,
              url: p.html_url,
              state: p.merged_at ? "merged" : p.state === "open" ? (p.draft ? "draft" : "open") : "closed",
              author: p.user?.login,
              createdAt: p.created_at,
              mergedAt: p.merged_at ?? undefined,
              updatedAt: p.updated_at,
              syncedAt: startedAt,
            };
            const before = await db.codeLinks.get(link.id);
            await db.codeLinks.put(link);
            if (!before) result.linked += 1;
            if (auto) result.moved += await followPull(issue, link, before);
          }
        }
        for (const c of commits) {
          for (const k of extractIssueKeys(c.commit.message, byKey.keys())) {
            const project = byKey.get(k.key);
            const issue = project ? await db.issues.where("[projectId+seq]").equals([project.id, k.seq]).first() : undefined;
            if (!project || !issue) continue;
            const id = `commit:${full}@${c.sha.slice(0, 12)}`;
            const before = await db.codeLinks.get(id);
            await db.codeLinks.put({
              id,
              issueId: issue.id,
              projectId: project.id,
              kind: "commit",
              repo: full,
              sha: c.sha,
              title: c.commit.message.split("\n")[0].slice(0, 120),
              url: c.html_url,
              state: "committed",
              author: c.author?.login ?? c.commit.author?.name,
              createdAt: c.commit.author?.date ?? startedAt,
              updatedAt: c.commit.author?.date ?? startedAt,
              syncedAt: startedAt,
            });
            if (!before) result.linked += 1;
          }
        }
        cur[full] = startedAt;
      }
      localStorage.setItem(KEY_CURSORS, JSON.stringify(cur));
      localStorage.setItem(KEY_LAST, nowISO());
      set({ lastSyncAt: nowISO(), lastResult: result });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Move the issue with the PR, using GitHub's timestamps. Returns 1 when it moved. */
async function followPull(issue: Issue, link: CodeLink, before: CodeLink | undefined): Promise<number> {
  const fresh = (await db.issues.get(issue.id)) ?? issue;
  if (link.state === "merged" && fresh.status !== "done" && fresh.status !== "cancelled") {
    await transitionIssue(fresh.id, "done", { at: link.mergedAt ?? link.updatedAt });
    return 1;
  }
  if ((link.state === "open" || link.state === "draft") && !before && (fresh.status === "backlog" || fresh.status === "todo" || fresh.status === "in_progress" || fresh.status === "triage")) {
    if (fresh.status !== "in_progress") await transitionIssue(fresh.id, "in_progress", { at: link.createdAt });
    if (link.state === "open") await transitionIssue(fresh.id, "in_review", { at: link.updatedAt });
    return 1;
  }
  return 0;
}

let interval: ReturnType<typeof setInterval> | undefined;

export function bootGithub() {
  load();
  clearInterval(interval);
  if (!state.configured) return;
  setTimeout(() => void syncGithub(), 4000);
  interval = setInterval(() => void syncGithub(), 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.configured) void syncGithub();
  });
}

export type { Project };
