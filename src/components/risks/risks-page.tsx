"use client";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { useUi } from "@/lib/ui-store";
import { RiskRegister } from "./risk-register";

/** /risks — every project's RAID items in one register. */
export function RisksPage() {
  const { openQuickCreate } = useUi();
  return (
    <>
      <PageHeader
        title="Risks"
        description="RAID register across projects: risks, assumptions, issues and dependencies, sorted by likelihood × impact."
        actions={
          <Button size="sm" onClick={() => openQuickCreate("risk")}>
            <Plus /> New risk
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
