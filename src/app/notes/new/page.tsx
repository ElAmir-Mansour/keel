import { Suspense } from "react";
import { NewNote } from "@/components/notes/new-note";

export const metadata = { title: "New note" };

export default function NewNotePage() {
  return (
    <Suspense>
      <NewNote />
    </Suspense>
  );
}
