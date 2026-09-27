"use client";
import { useParams } from "next/navigation";
import { CyclesView } from "@/components/projects/cycles-view";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CyclesView projectId={id} />;
}
