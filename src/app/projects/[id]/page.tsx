"use client";
import { useParams } from "next/navigation";
import { ProjectOverview } from "@/components/projects/project-overview";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ProjectOverview id={id} />;
}
