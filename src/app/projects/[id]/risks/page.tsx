import { Suspense } from "react";
import { ProjectRisks } from "@/components/risks/risks-page";

export default function ProjectRisksPage() {
  return (
    <Suspense>
      <ProjectRisks />
    </Suspense>
  );
}
