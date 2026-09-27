"use client";
import { Suspense } from "react";
import { IssueListView } from "@/components/issues/issue-list-view";

// Filters live in the URL, so the view reads search params and needs a
// Suspense boundary for the static shell.
export default function IssuesPage() {
  return (
    <Suspense>
      <IssueListView />
    </Suspense>
  );
}
