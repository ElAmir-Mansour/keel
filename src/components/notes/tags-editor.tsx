"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chip editor: type and press Enter (or comma) to add, × or Backspace to remove. */
export function TagsEditor({
  tags,
  onChange,
  placeholder = "Add tag",
  className,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const t = draft.trim().replace(/^#/, "").replace(/\s+/g, "-");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  }

  return (
    <div className={cn("flex min-h-7 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-0.5 focus-within:border-ring", className)}>
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary ps-2 pe-1 py-0.5 text-xs" dir="auto">
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        dir="auto"
        aria-label={placeholder}
        placeholder={tags.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        className="min-w-16 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
