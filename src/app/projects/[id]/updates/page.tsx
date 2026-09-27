"use client";
import { useParams } from "next/navigation";
import { ProjectUpdates } from "@/components/projects/updates";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ProjectUpdates id={id} />;
}
