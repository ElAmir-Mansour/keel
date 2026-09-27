"use client";
import { Suspense } from "react";
import { Dashboard, DashboardSkeleton } from "@/components/dashboard/dashboard";

// useSearchParams needs a Suspense boundary above it for static prerender.
export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
