"use client";
import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { Camera, Check, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { deleteReview, recordReview, updateTimeline } from "@/lib/repo";
import { autoHeadline, dueOf, execEntries, ragOf, slipDays, snapshotItems } from "@/lib/timeline/management";
import { CONFIDENCES, RAGS, type Confidence, type Rag, type Timeline, type TimelineAsk, type TimelineEntry } from "@/lib/types";
import { TextCell } from "./timeline-editor";

// Everything the slide needs that the engineering entries do not carry: which
// entries managers see, their baseline, owner, confidence and status reason;
// the headline, dates and owner of the review; the decisions leadership owes;
// and recorded reviews to diff against.

export function ManagementPanel({ timeline, today }: { timeline: Timeline; today: string }) {
  const t = useT();
  const exec = useMemo(() => execEntries(timeline), [timeline]);
  const others = useMemo(() => timeline.entries.filter((e) => !e.exec).sort((a, b) => a.start.localeCompare(b.start)), [timeline.entries]);
  const asOf = timeline.asOf || today;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickOpen, setPickOpen] = useState(false);

  async function patchEntry(id: string, p: Partial<TimelineEntry>) {
    await updateTimeline(timeline.id, { entries: timeline.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  }
  async function addPicked() {
    await updateTimeline(timeline.id, { entries: timeline.entries.map((e) => (picked.has(e.id) ? { ...e, exec: true } : e)) });
    toast.success(t("{n} items added to the management view", { n: picked.size }));
    setPicked(new Set());
    setPickOpen(false);
  }
  async function patchAsk(id: string, p: Partial<TimelineAsk>) {
    await updateTimeline(timeline.id, { asks: (timeline.asks ?? []).map((a) => (a.id === id ? { ...a, ...p } : a)) });
  }
  async function addAsk() {
    await updateTimeline(timeline.id, { asks: [...(timeline.asks ?? []), { id: nanoid(12), decision: "" }] });
  }
  async function removeAsk(id: string) {
    await updateTimeline(timeline.id, { asks: (timeline.asks ?? []).filter((a) => a.id !== id) });
  }
  async function record() {
    const snap = await recordReview(timeline.id, asOf, snapshotItems(exec, today));
    toast.success(t("Review recorded as of {date}", { date: fmtDate(snap.at) }));
  }

  const headlinePlaceholder = autoHeadline(exec, timeline.asks ?? [], today, t);

  return (
    <div className="grid gap-5">
      {/* Review header */}
      <div className="grid gap-3 rounded-lg border bg-card p-3">
        <div className="grid gap-1.5">
          <span className="text-xs text-muted-foreground">{t("Headline (the slide's action title)")}</span>
          <HeadlineInput value={timeline.headline ?? ""} placeholder={headlinePlaceholder} onSave={(v) => updateTimeline(timeline.id, { headline: v.trim() || undefined })} />
        </div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("Owner")}</Label>
            <OwnerInput value={timeline.owner ?? ""} onSave={(v) => updateTimeline(timeline.id, { owner: v.trim() || undefined })} placeholder={t("Name or role")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`asof-${timeline.id}`} className="text-xs text-muted-foreground">
              {t("As of")}
            </Label>
            <Input id={`asof-${timeline.id}`} type="date" value={timeline.asOf ?? ""} placeholder={today} onChange={(e) => void updateTimeline(timeline.id, { asOf: e.target.value || undefined })} className="h-8 w-auto text-xs" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`next-${timeline.id}`} className="text-xs text-muted-foreground">
              {t("Next review")}
            </Label>
            <Input id={`next-${timeline.id}`} type="date" value={timeline.nextReview ?? ""} onChange={(e) => void updateTimeline(timeline.id, { nextReview: e.target.value || undefined })} className="h-8 w-auto text-xs" />
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-xs">
            <Switch checked={Boolean(timeline.mirror)} onCheckedChange={(v) => void updateTimeline(timeline.id, { mirror: v || undefined })} aria-label={t("Mirror time axis for Arabic")} />
            {t("Mirror for Arabic")}
          </label>
          <Button size="sm" variant="outline" className="ms-auto" onClick={() => void record()} disabled={!exec.length}>
            <Camera /> {t("Record review as of {date}", { date: fmtDate(asOf, "d MMM") })}
          </Button>
        </div>
        {timeline.snapshots?.length ? (
          <ul className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            {[...timeline.snapshots]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
                  {t("Review {date} · {n} items", { date: fmtDate(s.at, "d MMM"), n: s.items.length })}
                  <button type="button" aria-label={t("Delete review")} className="rounded-full hover:text-destructive" onClick={() => void deleteReview(timeline.id, s.id)}>
                    <X className="size-3" />
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>

      {/* Executive items */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("Executive items")}{exec.length ? ` · ${exec.length}` : ""}</h3>
          <Popover open={pickOpen} onOpenChange={setPickOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" disabled={!others.length}>
                <Plus /> {t("Add items")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <p className="px-1 pb-2 text-xs text-muted-foreground">{t("Pick the few milestones managers steer by; five to nine is right.")}</p>
              <ul className="max-h-64 overflow-auto">
                {others.map((e) => (
                  <li key={e.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={picked.has(e.id)}
                        onCheckedChange={(v) =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(e.id);
                            else next.delete(e.id);
                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <span className="grid min-w-0">
                        <span className="truncate" dir="auto">
                          {e.title}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtDate(e.start, "d MMM")}
                          {e.end ? ` → ${fmtDate(e.end, "d MMM")}` : ""}
                          {e.group ? ` · ${e.group}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={() => void addPicked()} disabled={!picked.size}>
                  <Check /> {t("Add {n} items", { n: picked.size })}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {exec.length ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="hidden grid-cols-[minmax(10rem,2fr)_6rem_7.5rem_minmax(5rem,1fr)_auto_auto_minmax(8rem,2fr)_auto] gap-x-2 border-b bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground md:grid">
              <span>{t("Item")}</span>
              <span>{t("Due")}</span>
              <span>{t("Baseline")}</span>
              <span>{t("Owner")}</span>
              <span>{t("Confidence")}</span>
              <span>{t("Status")}</span>
              <span>{t("Why")}</span>
              <span />
            </div>
            {exec.map((e) => {
              const rag = ragOf(e, today);
              const slip = slipDays(e);
              return (
                <div key={e.id} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 last:border-b-0 md:grid-cols-[minmax(10rem,2fr)_6rem_7.5rem_minmax(5rem,1fr)_auto_auto_minmax(8rem,2fr)_auto]">
                  <div className="min-w-0 text-sm">
                    <span className="block truncate font-medium" dir="auto">
                      {e.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{e.group ?? t("General")}</span>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label={t("Remove from management view")} className="text-muted-foreground hover:text-destructive md:hidden" onClick={() => void patchEntry(e.id, { exec: undefined })}>
                    <Trash2 />
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground max-md:col-span-2">
                    {fmtDate(dueOf(e), "d MMM")}
                    {slip ? <span className={slip > 0 ? "ms-1 font-semibold text-[var(--viz-critical)]" : "ms-1 font-semibold text-[var(--viz-good-text)]"}>{slip > 0 ? `+${slip}d` : `−${Math.abs(slip)}d`}</span> : null}
                  </span>
                  <Input type="date" value={e.baseline ?? ""} onChange={(ev) => void patchEntry(e.id, { baseline: ev.target.value || undefined })} aria-label={t("Baseline")} className="h-7 w-[7.5rem] px-1.5 text-xs max-md:col-span-2" />
                  <div className="max-md:col-span-2">
                    <TextCell value={e.owner ?? ""} onSave={(v) => patchEntry(e.id, { owner: v.trim() || undefined })} placeholder={t("Owner")} />
                  </div>
                  <Select value={e.confidence ?? "__none"} onValueChange={(v) => void patchEntry(e.id, { confidence: v === "__none" ? undefined : (v as Confidence) })}>
                    <SelectTrigger size="sm" className="h-7 w-auto border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border dark:bg-transparent" aria-label={t("Confidence")}>
                      <SelectValue placeholder={t("Confidence")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t("Unset")}</SelectItem>
                      {CONFIDENCES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {t(c.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={e.rag ?? "__auto"} onValueChange={(v) => void patchEntry(e.id, { rag: v === "__auto" ? undefined : (v as Rag) })}>
                    <SelectTrigger size="sm" className="h-7 w-auto border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border dark:bg-transparent" aria-label={t("Status")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto">{t("Computed: {rag}", { rag: t(RAGS.find((r) => r.value === rag)?.label ?? rag) })}</SelectItem>
                      {RAGS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {t(r.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="max-md:col-span-2">
                    <TextCell value={e.why ?? ""} onSave={(v) => patchEntry(e.id, { why: v.trim() || undefined })} placeholder={t("Why, in a few words")} />
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label={t("Remove from management view")} className="hidden text-muted-foreground hover:text-destructive md:inline-flex" onClick={() => void patchEntry(e.id, { exec: undefined })}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("No items on the management view yet. Add the five to nine milestones managers steer by.")}</p>
        )}
      </div>

      {/* Decisions needed */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("Decisions needed")}</h3>
          <Button size="sm" variant="outline" onClick={() => void addAsk()}>
            <Plus /> {t("Add decision")}
          </Button>
        </div>
        {timeline.asks?.length ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            {timeline.asks.map((a) => (
              <div key={a.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 border-b px-2 py-1.5 last:border-b-0 md:grid-cols-[auto_minmax(12rem,3fr)_minmax(6rem,1fr)_7.5rem_auto]">
                <Checkbox checked={Boolean(a.done)} onCheckedChange={(v) => void patchAsk(a.id, { done: Boolean(v) })} aria-label={t("Decided")} />
                <TextCell value={a.decision} onSave={(v) => patchAsk(a.id, { decision: v.trim() })} placeholder={t("What leadership must decide, and the recommendation")} className={a.done ? "line-through text-muted-foreground" : ""} />
                <Button variant="ghost" size="icon-xs" aria-label={t("Delete decision")} className="text-muted-foreground hover:text-destructive md:order-last" onClick={() => void removeAsk(a.id)}>
                  <Trash2 />
                </Button>
                <div className="col-span-3 md:col-span-1">
                  <TextCell value={a.owner ?? ""} onSave={(v) => patchAsk(a.id, { owner: v.trim() || undefined })} placeholder={t("Owner")} />
                </div>
                <Input type="date" value={a.neededBy ?? ""} onChange={(ev) => void patchAsk(a.id, { neededBy: ev.target.value || undefined })} aria-label={t("Needed by")} className="col-span-3 h-7 w-[7.5rem] px-1.5 text-xs md:col-span-1" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("Status without asks is noise: list what you need from leadership, who owns it and by when.")}</p>
        )}
      </div>
    </div>
  );
}

function HeadlineInput({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void | Promise<void> }) {
  return <TextCell value={value} onSave={onSave} placeholder={placeholder} className="h-8 border-border px-2 text-sm font-medium" />;
}

function OwnerInput({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void | Promise<void> }) {
  return <TextCell value={value} onSave={onSave} placeholder={placeholder} className="h-8 w-40 border-border px-2 text-xs" />;
}
