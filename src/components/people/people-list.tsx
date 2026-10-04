"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, PersonAvatar } from "@/components/ui-bits";
import { useAllIssues } from "@/hooks/use-data";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { isOpen } from "@/lib/metrics";
import { useUi } from "@/lib/ui-store";
import { TeamPoints } from "@/components/points/team-points";

/** /team — everyone you assign work to or meet 1:1. */
export function PeopleList() {
  const { openQuickCreate } = useUi();
  const t = useT();
  const people = useLiveQuery(() => db.people.orderBy("name").toArray(), [], null);
  const issues = useAllIssues();
  const oneOnOnes = useLiveQuery(() => db.notes.where({ kind: "oneonone" }).toArray(), [], []);

  const stats = useMemo(() => {
    const m = new Map<string, { open: number; doing: number; last?: string }>();
    const get = (id: string) => m.get(id) ?? m.set(id, { open: 0, doing: 0 }).get(id)!;
    for (const i of issues) {
      if (!i.assigneeId || !isOpen(i)) continue;
      const s = get(i.assigneeId);
      if (i.status === "in_progress" || i.status === "in_review") s.doing += 1;
      else s.open += 1;
    }
    for (const n of oneOnOnes) {
      if (!n.personId) continue;
      const s = get(n.personId);
      if (!s.last || n.date > s.last) s.last = n.date;
    }
    return m;
  }, [issues, oneOnOnes]);

  const actions = (
    <Button size="sm" onClick={() => openQuickCreate("person")}>
      <Plus /> {t("New person")}
    </Button>
  );

  return (
    <>
      <PageHeader title={t("People")} description={t("Who is doing what, and when you last talked.")} actions={actions} />
      {people === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <EmptyState icon={<Users />} title={t("Nobody here yet")} description={t("Add the people you work with to assign issues, own risks and keep 1:1 notes per person.")}>
          <Button size="sm" onClick={() => openQuickCreate("person")}>
            <Plus /> {t("New person")}
          </Button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {people.map((p) => {
            const s = stats.get(p.id);
            return (
              <li key={p.id}>
                <Link href={`/team/${p.id}`} className="flex h-full gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50">
                  <PersonAvatar person={p} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" dir="auto">
                      {p.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" dir="auto">
                      {p.role || t("No role set")}
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{t("Open")}</dt>
                        <dd className="font-medium tabular">{s?.open ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("In progress")}</dt>
                        <dd className="font-medium tabular">{s?.doing ?? 0}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("Last 1:1")}</dt>
                        <dd className="font-medium tabular">{s?.last ? fmtDate(s.last, "d MMM") : "—"}</dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {people?.length ? <TeamPoints /> : null}
    </>
  );
}
