"use client";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui-store";
import { RiskRegister } from "./risk-register";

/** /risks — every project's RAID items in one register. */
export function RisksPage() {
  const { openQuickCreate } = useUi();
  const t = useT();
  return (
    <>
      <PageHeader
        title={t("Risks")}
        description={t("RAID register across projects: risks, assumptions, issues and dependencies, sorted by likelihood × impact.")}
        actions={
          <Button size="sm" onClick={() => openQuickCreate("risk")}>
            <Plus /> {t("New risk")}
          </Button>
        }
      />
      <RiskRegister />
    </>
  );
}

/** /projects/[id]/risks — the same register scoped to one project; the layout draws the project header. */
export function ProjectRisks() {
  const { id } = useParams<{ id: string }>();
  return <RiskRegister projectId={id} />;
}
