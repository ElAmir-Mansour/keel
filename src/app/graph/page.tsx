import { Suspense } from "react";
import { WorkspaceGraph } from "@/components/graph/workspace-graph";

export const metadata = { title: "Graph" };

export default function GraphPage() {
  return (
    <Suspense>
      <WorkspaceGraph />
    </Suspense>
  );
}
