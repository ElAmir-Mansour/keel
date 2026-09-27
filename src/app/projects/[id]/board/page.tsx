"use client";
import { Suspense } from "react";
import { BoardView } from "@/components/issues/board-view";

export default function BoardPage() {
  return (
    <Suspense>
      <BoardView />
    </Suspense>
  );
}
