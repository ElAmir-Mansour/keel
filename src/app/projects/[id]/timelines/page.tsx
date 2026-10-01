"use client";
import { Suspense } from "react";
import { ProjectTimelines } from "@/components/timelines/timelines-list";

export default function ProjectTimelinesPage() {
  return (
    <Suspense>
      <ProjectTimelines />
    </Suspense>
  );
}
