import { describe, expect, it } from "vitest";
import { cycleWindow, planCycles } from "../cycles";
import type { Cycle } from "../types";

const cfg = { enabled: true, lengthWeeks: 2 as const };
const cycle = (n: number, start: string, end: string, status: Cycle["status"]): Cycle => ({ id: `c${n}`, projectId: "p", number: n, startDate: start, endDate: end, status, createdAt: "", updatedAt: "" });

describe("cycleWindow", () => {
  it("ends the day before the next cycle starts", () => {
    expect(cycleWindow("2026-09-28", 2)).toEqual({ startDate: "2026-09-28", endDate: "2026-10-11" });
  });
});

describe("planCycles", () => {
  it("starts an active cycle today plus one upcoming when none exist", () => {
    const plan = planCycles([], cfg, "2026-09-28");
    expect(plan.create).toEqual([
      { startDate: "2026-09-28", endDate: "2026-10-11", status: "active" },
      { startDate: "2026-10-12", endDate: "2026-10-25", status: "upcoming" },
    ]);
  });
  it("closes an ended cycle, rolls its work, activates the next and adds a new upcoming", () => {
    const c1 = cycle(1, "2026-09-14", "2026-09-27", "active");
    const c2 = cycle(2, "2026-09-28", "2026-10-11", "upcoming");
    const plan = planCycles([c1, c2], cfg, "2026-09-28");
    expect(plan.close).toEqual([c1]);
    expect(plan.rollFrom).toEqual([c1]);
    expect(plan.activate).toEqual([c2]);
    expect(plan.create).toEqual([{ startDate: "2026-10-12", endDate: "2026-10-25", status: "upcoming" }]);
  });
  it("skips whole missed cycles after a long absence", () => {
    const c1 = cycle(1, "2026-06-01", "2026-06-14", "active");
    const plan = planCycles([c1], cfg, "2026-09-28");
    expect(plan.close).toEqual([c1]);
    const active = plan.create.find((c) => c.status === "active")!;
    expect(active.startDate <= "2026-09-28" && active.endDate >= "2026-09-28").toBe(true);
    // Continuous numbering from the last known cycle: start is a multiple of 14 days after 2026-06-15.
    const gap = (Date.parse(active.startDate) - Date.parse("2026-06-15")) / 86400000;
    expect(gap % 14).toBe(0);
  });
  it("does nothing when cycles are disabled", () => {
    expect(planCycles([], { enabled: false, lengthWeeks: 1 }, "2026-09-28").create).toEqual([]);
  });
});
