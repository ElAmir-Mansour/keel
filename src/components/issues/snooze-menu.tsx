"use client";
import { useMemo, useState } from "react";
import { addDays, addWeeks, set, startOfDay, startOfWeek } from "date-fns";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtShort, parseYMD, todayYMD, ymd } from "@/lib/dates";

// Snoozed issues come back at 09:00 local on the chosen day.
const WAKE_HOUR = 9;

function wakeAt(day: Date) {
  return set(startOfDay(day), { hours: WAKE_HOUR, minutes: 0, seconds: 0, milliseconds: 0 });
}

export function snoozePresets(now: Date) {
  return {
    tomorrow: wakeAt(addDays(now, 1)),
    nextWeek: wakeAt(startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 })),
  };
}

export function SnoozeMenu({
  open,
  onOpenChange,
  onPick,
  compact,
  className,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onPick: (until: Date) => void;
  compact?: boolean;
  className?: string;
}) {
  const [pickDate, setPickDate] = useState(false);
  const presets = useMemo(() => snoozePresets(parseYMD(todayYMD())), []);

  function choose(d: Date) {
    onPick(d);
    onOpenChange?.(false);
    setPickDate(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        onOpenChange?.(v);
        if (!v) setPickDate(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className={cn("text-muted-foreground", className)} aria-label="Snooze">
          <Clock />
          {compact ? null : <span className="max-md:hidden">Snooze</span>}
          <Kbd className="max-md:hidden">H</Kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 gap-0.5 p-1">
        <SnoozeOption autoFocus label="Tomorrow" hint={fmtShort(ymd(presets.tomorrow))} onClick={() => choose(presets.tomorrow)} />
        <SnoozeOption label="Next week" hint={fmtShort(ymd(presets.nextWeek))} onClick={() => choose(presets.nextWeek)} />
        {pickDate ? (
          <Input
            type="date"
            autoFocus
            min={todayYMD()}
            aria-label="Snooze until"
            className="mt-0.5 h-8 text-xs"
            onChange={(e) => e.target.value && choose(wakeAt(parseYMD(e.target.value)))}
          />
        ) : (
          <SnoozeOption label="Pick a date…" onClick={() => setPickDate(true)} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function SnoozeOption({ label, hint, onClick, autoFocus }: { label: string; hint?: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent"
    >
      {label}
      {hint ? <span className="ms-auto text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}
