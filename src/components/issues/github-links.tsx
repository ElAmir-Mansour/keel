"use client";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { db } from "@/lib/db";
import { fmtShort } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import type { CodeLink } from "@/lib/types";
import { useGithubStatus } from "@/lib/github/service";

function StateIcon({ state }: { state: CodeLink["state"] }) {
  const c = "size-3.5 shrink-0";
  switch (state) {
    case "merged":
      return <GitMerge className={`${c} text-[var(--viz-series-7)]`} />;
    case "open":
      return <GitPullRequest className={`${c} text-[var(--viz-good)]`} />;
    case "draft":
      return <GitPullRequestDraft className={`${c} text-muted-foreground`} />;
    case "closed":
      return <GitPullRequestClosed className={`${c} text-[var(--viz-critical)]`} />;
    default:
      return <GitCommitHorizontal className={`${c} text-muted-foreground`} />;
  }
}

// Whole-line keys per state, so the raw state code is never used as a
// translation key on its own (where "open" would collide with the verb).
const STATE_LINE: Record<Exclude<CodeLink["state"], "merged" | "committed">, string> = {
  open: "open · {date}",
  draft: "draft · {date}",
  closed: "closed · {date}",
};

/** Pull requests and commits that mention this issue's key. */
export function GithubLinks({ issueId }: { issueId: string }) {
  const t = useT();
  const gh = useGithubStatus();
  const links = useLiveQuery(() => db.codeLinks.where({ issueId }).toArray(), [issueId], [] as CodeLink[]);
  if (!gh.configured && !links.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Connect a GitHub repository in")}{" "}
        <Link href="/settings#github" className="underline underline-offset-2">
          {t("Settings")}
        </Link>{" "}
        {t("to see pull requests and commits that mention this key.")}
      </p>
    );
  }
  if (!links.length) return <p className="text-sm text-muted-foreground">{t("No pull requests or commits mention this key yet.")}</p>;
  const sorted = [...links].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <ul className="space-y-1.5 text-sm">
      {sorted.map((l) => (
        <li key={l.id} className="flex items-center gap-2">
          <StateIcon state={l.state} />
          <a href={l.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate hover:underline" title={l.title}>
            {l.kind === "pr" ? `#${l.number} ` : `${l.sha?.slice(0, 7)} `}
            {l.title}
          </a>
          <span className="shrink-0 text-xs text-muted-foreground">
            {l.state === "merged"
              ? t("merged {date}", { date: fmtShort(l.mergedAt ?? l.updatedAt) })
              : l.state === "committed"
                ? fmtShort(l.createdAt)
                : t(STATE_LINE[l.state], { date: fmtShort(l.updatedAt) })}
            {l.author ? ` · ${l.author}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
