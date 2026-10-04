"use client";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { t } from "@/lib/i18n";
import { kpiLinksFor } from "@/hooks/use-points";

/**
 * After an issue is assigned or created for someone, say which of their KPIs
 * it now counts toward, so the connection is visible at the moment it is made.
 */
export async function announceKpis(issueId: string) {
  const issue = await db.issues.get(issueId);
  if (!issue?.assigneeId) return;
  const [kpis, person] = await Promise.all([db.kpis.where({ personId: issue.assigneeId }).toArray(), db.people.get(issue.assigneeId)]);
  if (!person || !kpis.length) return;
  const { counted } = kpiLinksFor(issue, kpis);
  if (!counted.length) return;
  const pts = issue.lockedPoints ?? issue.estimate;
  toast(t("Counts toward {name}'s KPIs", { name: person.name }), {
    description: `${counted.map((c) => c.kpi.name).join(" · ")}${pts ? ` · ${t("{n} pts when done", { n: pts })}` : ""}`,
  });
}
