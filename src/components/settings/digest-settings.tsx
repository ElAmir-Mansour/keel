"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ago } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isAiReady, useAiConfig } from "@/lib/ai/client";
import { generateDigest, setDigestEnabled, setDigestWeekday, useDigestSettings } from "@/lib/ai/digest";

// Day names stay English here and are translated at render time with t().
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function DigestSettings() {
  const t = useT();
  const s = useDigestSettings();
  const key = isAiReady(useAiConfig());
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function now() {
    setBusy(true);
    try {
      const n = await generateDigest({ ai: Boolean(key) });
      toast.success(t("Weekly digest written"), { action: { label: t("Open"), onClick: () => router.push(`/notes/${n.id}`) } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("Every week, the first time you open Keel on or after the chosen day, a digest note is written for all active projects: health, what shipped, what is next, risks and asks.")}{" "}
        {key ? t("Your assistant writes it from the activity.") : t("Without an API key it is drafted from the facts alone; set up the assistant under AI assistant to have it written.")}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2">
          <Switch checked={s.enabled} onCheckedChange={setDigestEnabled} /> {t("Write a weekly digest")}
        </label>
        <Select value={String(s.weekday)} onValueChange={(v) => setDigestWeekday(Number(v))}>
          <SelectTrigger size="sm" className="w-auto" aria-label={t("Digest day")}>
            <span className="text-muted-foreground">{t("On")}</span> <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAYS.map((d, i) => (
              <SelectItem key={d} value={String(i + 1)}>
                {t(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={now} disabled={busy || s.running}>
          <CalendarClock /> {t("Write one now")}
        </Button>
        <span className="text-xs text-muted-foreground">{s.lastAt ? t("Last digest {when}", { when: ago(s.lastAt) }) : t("No digest yet")}</span>
      </div>
    </div>
  );
}
