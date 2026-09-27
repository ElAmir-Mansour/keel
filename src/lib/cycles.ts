import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { db } from "./db";
import { nowISO, todayYMD, ymd } from "./dates";
import { createCycle, updateCycle } from "./repo";
import type { Cycle, CycleConfig, Issue, Project } from "./types";

// Fixed-length cycles. The rules are deliberately few: a cycle ends on its
// end date, unfinished work rolls into the next one, and there is always one
// active and one upcoming cycle while cycles are enabled. Pure helpers are
// exported for tests; `ensureCycles` applies them to the database.

export const DEFAULT_CYCLE_CONFIG: CycleConfig = { enabled: false, lengthWeeks: 2 };

export function cycleWindow(start: string, lengthWeeks: number) {
  return { startDate: start, endDate: ymd(addDays(parseISO(start), lengthWeeks * 7 - 1)) };
}

export function nextStart(prev: Cycle) {
  return ymd(addDays(parseISO(prev.endDate), 1));
}

export function daysLeft(c: Cycle, today = todayYMD()) {
  return differenceInCalendarDays(parseISO(c.endDate), parseISO(today));
}

export function cycleLabel(c: Cycle) {
  return `Cycle ${c.number}`;
}

export function isUnfinished(i: Issue) {
  return i.status !== "done" && i.status !== "cancelled";
}

/** Which cycles should exist today given the list so far. Returns the plan, no I/O. */
export function planCycles(existing: Cycle[], config: CycleConfig, today: string) {
  const plan: { close: Cycle[]; activate: Cycle[]; create: { startDate: string; endDate: string; status: "active" | "upcoming" }[]; rollFrom: Cycle[] } = { close: [], activate: [], create: [], rollFrom: [] };
  if (!config.enabled) return plan;
  const sorted = [...existing].sort((a, b) => a.number - b.number);
  // 1. Anything past its end date is closed and its work rolls forward.
  for (const c of sorted) {
    if (c.status !== "done" && c.endDate < today) {
      plan.close.push(c);
      plan.rollFrom.push(c);
    }
  }
  const live = sorted.filter((c) => !plan.close.includes(c) && c.status !== "done");
  // 2. The cycle covering today is active.
  let active = live.find((c) => c.startDate <= today && c.endDate >= today);
  if (active && active.status !== "active") plan.activate.push(active);
  // 3. No cycle covers today: continue from the last one, or start today.
  if (!active) {
    const last = sorted[sorted.length - 1];
    let start = last ? nextStart(last) : today;
    // Skip whole missed cycles so the rhythm stays continuous without
    // materialising empty cycles for weeks nobody used Keel.
    while (cycleWindow(start, config.lengthWeeks).endDate < today) start = ymd(addDays(parseISO(cycleWindow(start, config.lengthWeeks).endDate), 1));
    const w = cycleWindow(start, config.lengthWeeks);
    plan.create.push({ ...w, status: "active" });
    active = { id: "", projectId: "", number: 0, status: "active", createdAt: "", updatedAt: "", ...w };
  }
  // 4. Exactly one upcoming cycle after the active one.
  const upcoming = live.find((c) => c.startDate > active!.endDate);
  if (!upcoming) plan.create.push({ ...cycleWindow(nextStart(active), config.lengthWeeks), status: "upcoming" });
  return plan;
}

/** Apply the plan for one project: close, roll over, create. Returns how many issues moved. */
export async function ensureCycles(project: Project, today = todayYMD()): Promise<number> {
  const config = project.cycleConfig ?? DEFAULT_CYCLE_CONFIG;
  if (!config.enabled) return 0;
  const existing = await db.cycles.where({ projectId: project.id }).toArray();
  const plan = planCycles(existing, config, today);
  let moved = 0;
  for (const c of plan.close) await updateCycle(c.id, { status: "done" });
  for (const c of plan.activate) await updateCycle(c.id, { status: "active" });
  const created: Cycle[] = [];
  for (const c of plan.create) created.push(await createCycle({ projectId: project.id, ...c }));
  const all = [...existing.filter((c) => !plan.close.includes(c)), ...created].map((c) => (plan.activate.includes(c) ? { ...c, status: "active" as const } : c));
  const active = all.find((c) => c.status === "active") ?? created.find((c) => c.status === "active");
  if (active) {
    for (const from of plan.rollFrom) {
      const unfinished = (await db.issues.where({ cycleId: from.id }).toArray()).filter(isUnfinished);
      for (const i of unfinished) {
        await db.issues.update(i.id, { cycleId: active.id, updatedAt: nowISO() });
        moved += 1;
      }
    }
  }
  return moved;
}

/** Run roll-over for every project with cycles on. */
export async function rolloverAll(today = todayYMD()) {
  const projects = await db.projects.toArray();
  let moved = 0;
  for (const p of projects) if (p.cycleConfig?.enabled) moved += await ensureCycles(p, today);
  return moved;
}
