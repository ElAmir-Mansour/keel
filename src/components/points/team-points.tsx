"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "@/components/ui-bits";
import { usePointsData, usePointRules } from "@/hooks/use-points";
import { useT } from "@/lib/i18n";
import { elapsedFraction, periodKey, periodLabel, personPeriod, teamScore } from "@/lib/points";
import { savePointRules } from "@/lib/repo";
import { ESTIMATION_SCALES, type BonusTier, type EstimationScale } from "@/lib/types";
import { AttainmentBar, pct } from "./scorecard";

/**
 * The quarter at a glance for the People page. Alphabetical on purpose: the
 * research on leaderboards is clear that ranking people sets them against
 * each other, so the table never sorts by score.
 */
export function TeamPoints() {
  const t = useT();
  const data = usePointsData();
  const key = periodKey("quarter");
  const ctx = useMemo(() => ({ issues: data.issues, events: data.events }), [data.issues, data.events]);
  const team = useMemo(() => teamScore(data.people.map((p) => p.id), data.kpis, ctx, key), [data.people, data.kpis, ctx, key]);
  const rows = useMemo(
    () =>
      data.people
        .map((p) => ({ person: p, pp: personPeriod(p.id, key, { kpis: data.kpis, issues: data.issues, events: data.events, entries: data.entries, rules: data.rules }, team) }))
        .filter((r) => r.pp.total || r.pp.card.kpis.length)
        .sort((a, b) => a.person.name.localeCompare(b.person.name)),
    [data, key, team],
  );
  if (!data.rules.showOnPeoplePage || !rows.length) return null;
  const pending = rows.reduce((n, r) => n + (r.pp.pendingBonuses ? 1 : 0), 0);
  return (
    <section className="mt-6 space-y-2" aria-label={t("Points and KPIs")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t("Points and KPIs · {period}", { period: periodLabel(key) })}
          <span className="ms-2 text-xs font-normal">{t("so far, {p} of the quarter gone", { p: pct(elapsedFraction(key)) })}</span>
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("Team score {s}", { s: pct(team) })}
          {pending ? ` · ${t("{n} bonus drafts waiting", { n: pending })}` : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-start font-medium">{t("Person")}</th>
              <th className="px-3 py-1.5 text-end font-medium">{t("Points")}</th>
              <th className="w-48 px-3 py-1.5 text-start font-medium">{t("KPI score")}</th>
              <th className="px-3 py-1.5 text-end font-medium">{t("On pace for")}</th>
              <th className="px-3 py-1.5 text-start font-medium">{t("Bonus")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ person, pp }) => (
              <tr key={person.id}>
                <td className="px-3 py-1.5">
                  <Link href={`/team/${person.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <PersonAvatar person={person} size="xs" /> {person.name}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-end tabular-nums">{pp.total}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <AttainmentBar value={pp.card.score} tone={pp.card.projected} className="flex-1" />
                    <span className="w-10 text-end text-xs tabular-nums">{pct(pp.card.score)}</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-end text-xs tabular-nums">{pct(pp.card.projected ?? pp.card.score)}</td>
                <td className="px-3 py-1.5 text-xs">
                  {pp.tier ? t(pp.tier.label) : <span className="text-muted-foreground">—</span>}
                  {pp.pendingBonuses ? <span className="ms-1 text-muted-foreground">· {t("draft")}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("Listed by name, never ranked. Open a person for the issues and reasons behind every number.")}</p>
    </section>
  );
}

/** Settings → Points and bonuses. */
export function PointsSettings() {
  const t = useT();
  const rules = usePointRules();
  const [tiers, setTiers] = useState<BonusTier[] | null>(null);
  const draft = tiers ?? rules.tiers;

  async function save(patch: Parameters<typeof savePointRules>[0]) {
    await savePointRules(patch);
    toast.success(t("Saved"));
  }

  return (
    <div className="space-y-5 text-sm">
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("Estimation scale")}</Label>
        <Select value={rules.scale} onValueChange={(v) => void save({ scale: v as EstimationScale })}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ESTIMATION_SCALES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {t(s.label)} <span className="text-muted-foreground">· {s.points.map((p) => p.label).join(", ")}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("The quick picks on every issue. Points lock when work starts and are earned when the issue is done; reopening takes them back.")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="rules-threshold" className="text-xs text-muted-foreground">
            {t("Payout threshold (%)")}
          </Label>
          <Input id="rules-threshold" type="number" min={0} max={100} defaultValue={rules.thresholdPct} key={`th-${rules.thresholdPct}`} onBlur={(e) => void save({ thresholdPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="w-28" />
          <p className="text-xs text-muted-foreground">{t("Below this KPI score the bonus multiplier is zero; at it, half; at 100%, one; it rises to 1.5 at the cap.")}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rules-team" className="text-xs text-muted-foreground">
            {t("Team share of the payout (%)")}
          </Label>
          <Input id="rules-team" type="number" min={0} max={100} defaultValue={rules.teamSharePct} key={`ts-${rules.teamSharePct}`} onBlur={(e) => void save({ teamSharePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="w-28" />
          <p className="text-xs text-muted-foreground">{t("How much of the multiplier follows the team's score rather than the person's. A larger team share keeps people helping each other.")}</p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">{t("Bonus points tiers")}</Label>
        <ul className="grid gap-1.5">
          {draft.map((tier, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("From a score of")}</span>
              <Input type="number" min={0} value={tier.minScore} onChange={(e) => setTiers(draft.map((x, j) => (j === i ? { ...x, minScore: Number(e.target.value) } : x)))} className="h-8 w-20" aria-label={t("Minimum score")} />
              <span className="text-xs text-muted-foreground">{t("% add")}</span>
              <Input type="number" min={0} value={tier.bonusPct} onChange={(e) => setTiers(draft.map((x, j) => (j === i ? { ...x, bonusPct: Number(e.target.value) } : x)))} className="h-8 w-20" aria-label={t("Bonus percent")} />
              <span className="text-xs text-muted-foreground">{t("% of earned points, called")}</span>
              <Input value={tier.label} onChange={(e) => setTiers(draft.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-8 w-36" aria-label={t("Tier name")} dir="auto" />
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t("Remove tier")} onClick={() => setTiers(draft.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setTiers([...draft, { minScore: 150, bonusPct: 40, label: t("Exceptional") }])}>
            <Plus /> {t("Add tier")}
          </Button>
          {tiers ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void save({ tiers: draft.filter((x) => x.label.trim()).sort((a, b) => a.minScore - b.minScore) });
                setTiers(null);
              }}
            >
              {t("Save tiers")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("When a person's KPI score reaches a tier, their scorecard suggests that many extra points as a bonus draft. Nothing is awarded until you approve it.")}</p>
      </div>

      <label className="flex items-start gap-3">
        <Switch checked={rules.showOnPeoplePage} onCheckedChange={(v) => void save({ showOnPeoplePage: v })} className="mt-0.5" />
        <span>
          <span className="font-medium">{t("Show the team table on the People page")}</span>
          <span className="block text-xs text-muted-foreground">{t("Alphabetical, never ranked. Turn it off if you share your screen in team meetings.")}</span>
        </span>
      </label>

      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{t("Why it works this way")}</p>
        <p className="mt-1">
          {t("Points measure size, not worth. Tied to pay, they invite inflated estimates and a race for big tickets, so Keel locks estimates when work starts, takes points back when work is reopened, gives most of the payout to the team, scores quality and delivery KPIs next to points, and keeps every award a reviewed draft with a written reason.")}
        </p>
      </div>
    </div>
  );
}
