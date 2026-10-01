import { Suspense } from "react";
import { TimelinesList } from "@/components/timelines/timelines-list";

export const metadata = { title: "Timelines" };

export default function TimelinesPage() {
  return (
    <Suspense>
      <TimelinesList />
    </Suspense>
  );
}
