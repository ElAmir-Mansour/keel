"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Github, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMounted } from "@/hooks/use-mounted";
import { ago } from "@/lib/dates";
import { clearGithubConfig, getGithubToken, saveGithubConfig, syncGithub, testGithubAccess, useGithubStatus } from "@/lib/github/service";

export function GithubSettings() {
  const s = useGithubStatus();
  const mounted = useMounted();
  const [repos, setRepos] = useState("");
  const [token, setToken] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  // Load stored values on the client without an effect.
  const sig = `${s.repos}|${s.hasToken}|${s.autoStatus}`;
  if (mounted && seen !== sig) {
    setSeen(sig);
    setRepos(s.repos);
    setToken(getGithubToken() ?? "");
    setAuto(s.autoStatus);
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Keel reads pull requests and commits from the repositories below and links them to issues by key: a branch <code className="rounded bg-muted px-1">feat/plat-12-audit</code>, a PR titled <code className="rounded bg-muted px-1">PLAT-12 Audit log</code> or a commit message mentioning <code className="rounded bg-muted px-1">PLAT-12</code>. Public repositories need no token; private ones need a fine-grained token with read access to contents and pull requests. Everything runs in this browser.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="gh-repos">Repositories</Label>
          <Textarea id="gh-repos" value={repos} onChange={(e) => setRepos(e.target.value)} placeholder={"owner/repo\nowner/other-repo"} rows={3} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="gh-token">Token (optional)</Label>
          <Input id="gh-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          <label className="mt-1 inline-flex items-center gap-2 text-sm">
            <Switch checked={auto} onCheckedChange={setAuto} /> Move issues with pull requests
          </label>
          <span className="text-xs text-muted-foreground">Opened → in review, merged → done, stamped with GitHub&apos;s times.</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run("GitHub configured", async () => saveGithubConfig({ repos, token, autoStatus: auto }))} disabled={busy || !repos.trim()}>
          <Github /> Save
        </Button>
        {s.configured ? (
          <>
            <Button size="sm" variant="outline" onClick={() => run("Access confirmed", () => testGithubAccess())} disabled={busy}>
              Test access
            </Button>
            <Button size="sm" variant="outline" onClick={() => run("Synced", () => syncGithub())} disabled={busy || s.running}>
              <RefreshCw className={s.running ? "animate-spin" : ""} /> Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run("GitHub disconnected", async () => clearGithubConfig())}>
              Disconnect
            </Button>
          </>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {s.lastSyncAt ? `Last sync ${ago(s.lastSyncAt)}` : s.configured ? "Not synced yet" : ""}
          {s.lastResult ? ` · ${s.lastResult.pulls} PRs and ${s.lastResult.commits} commits read, ${s.lastResult.linked} new links${s.lastResult.moved ? `, ${s.lastResult.moved} issues moved` : ""}` : ""}
        </span>
      </div>
      {s.lastError ? <p className="text-sm text-[var(--viz-critical)]">{s.lastError}</p> : null}
    </div>
  );
}
