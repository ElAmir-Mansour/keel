import { Suspense } from "react";
import { NotesBrowser } from "@/components/notes/notes-browser";

export const metadata = { title: "Notes" };

export default function NotesPage() {
  return (
    <Suspense>
      <NotesBrowser />
    </Suspense>
  );
}
