import { Suspense } from "react";
import { DecisionLog } from "@/components/decisions/decision-log";

export const metadata = { title: "Decisions" };

export default function DecisionsPage() {
  return (
    <Suspense>
      <DecisionLog />
    </Suspense>
  );
}
