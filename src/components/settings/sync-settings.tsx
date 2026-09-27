"use client";
import { useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { toast } from "sonner";
import { CloudOff, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { ago } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { clearSyncConfig, forgetCursors, getSyncConfig, saveSyncConfig, setAutoSync, signInWithEmail, signOut, syncNow, useSyncStatus, wipeRemote } from "@/lib/sync/service";

// Setup snippet: deliberately not translated (it names menus and a file in the repo).
const sqlHint = (origin: string) => `-- In your Supabase project: SQL editor → New query → paste supabase/schema.sql from the repo → Run.
-- Then Authentication → Providers → Email: enable, and add ${origin}/settings to the redirect URLs.`;

export function SyncSettings() {
  const t = useT();
  const s = useSyncStatus();
  const [url, setUrl] = useState("");
  const [anon, setAnon] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const mounted = useMounted();
  // Load the stored config once on the client, and again when it changes
  // (save/remove), without an effect: adjust state during render.
  const [seen, setSeen] = useState<boolean | null>(null);
  if (mounted && seen !== s.configured) {
    setSeen(s.configured);
    const c = getSyncConfig();
    setUrl(c.url);
    setAnon(c.anonKey);
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
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t("Bring your own Supabase project. Keel stays local-first: this browser keeps working offline, and every change is merged with your other devices when they are online. Last write wins; deletes travel too.")}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="sb-url">{t("Supabase URL")}</Label>
          <Input id="sb-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoComplete="off" dir="ltr" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sb-anon">{t("Anon key")}</Label>
          <Input id="sb-anon" type="password" value={anon} onChange={(e) => setAnon(e.target.value)} placeholder="eyJ…" autoComplete="off" dir="ltr" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run(t("Sync configured"), async () => saveSyncConfig(url, anon))} disabled={!url.trim() || !anon.trim() || busy}>
          {t("Save")}
        </Button>
        {s.configured ? (
          <Button size="sm" variant="ghost" onClick={() => run(t("Sync removed"), async () => clearSyncConfig())}>
            <CloudOff /> {t("Remove")}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{t("Stored in this browser only. The anon key is public by design; row-level security protects your rows.")}</span>
      </div>

      <details className="rounded-md border bg-muted/30 p-3 text-xs">
        <summary className="cursor-pointer font-medium">{t("One-time setup in Supabase")}</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed" dir="ltr">
          {sqlHint(mounted ? location.origin : "https://your-app")}
        </pre>
        <Button
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => {
            void navigator.clipboard.writeText("https://github.com/ElAmir-Mansour/keel/blob/main/supabase/schema.sql");
            toast.success(t("Link to schema.sql copied"));
          }}
        >
          <Copy /> {t("Copy link to schema.sql")}
        </Button>
      </details>

      {s.configured ? (
        <div className="space-y-3 rounded-md border p-3">
          {s.signedIn ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{t("Signed in")}</Badge>
                <span dir="ltr">{s.email}</span>
                <span className="text-xs text-muted-foreground">
                  {s.lastSyncAt ? t("Last sync {when}", { when: ago(s.lastSyncAt) }) : t("Not synced yet")}
                  {s.lastResult ? ` · ${t("pushed {pushed}, pulled {pulled}", { pushed: s.lastResult.pushed, pulled: s.lastResult.pulled })}` : ""}
                  {s.pending ? ` · ${t("{n} waiting", { n: s.pending })}` : ""}
                </span>
              </div>
              {s.lastError ? <p className="text-sm text-[var(--viz-critical)]">{s.lastError}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => run(t("Synced"), () => syncNow())} disabled={busy || s.running}>
                  <RefreshCw className={s.running ? "animate-spin" : ""} /> {t("Sync now")}
                </Button>
                <label className="inline-flex items-center gap-2 text-sm">
                  <Switch checked={s.auto} onCheckedChange={setAutoSync} /> {t("Sync automatically")}
                </label>
                <Button size="sm" variant="ghost" onClick={() => run(t("Signed out"), () => signOut())}>
                  {t("Sign out")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(t("Next sync will merge everything"), () => forgetCursors())}>
                  {t("Full re-sync")}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirmWipe(true)}>
                  {t("Delete cloud copy")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="sb-email">{t("Email for a magic link")}</Label>
                <Input id="sb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-64" dir="ltr" />
              </div>
              <Button size="sm" onClick={() => run(t("Check your inbox for the sign-in link"), () => signInWithEmail(email))} disabled={!email.includes("@") || busy}>
                {t("Send link")}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmWipe}
        onOpenChange={setConfirmWipe}
        title={t("Delete the cloud copy?")}
        description={t("Removes everything Keel stored in your Supabase project. This browser keeps its data and will push it again on the next sync.")}
        confirmLabel={t("Delete cloud copy")}
        destructive
        onConfirm={() => run(t("Cloud copy deleted"), () => wipeRemote())}
      />
    </div>
  );
}
