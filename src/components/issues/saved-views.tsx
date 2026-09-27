"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Bookmark, BookmarkPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { deleteView, saveView } from "@/lib/repo";
import type { SavedView } from "@/lib/types";

const FILTER_KEYS = ["q", "status", "priority", "assignee", "milestone", "cycle", "group", "done"];

function currentParams(sp: URLSearchParams) {
  const next = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) next.set(k, v);
  }
  return next.toString();
}

/** Save the current filter set under a name; reopen it from the same menu. */
export function SavedViews({ projectId }: { projectId: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const views = useLiveQuery(() => db.views.where({ projectId }).sortBy("name"), [projectId], [] as SavedView[]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const params = currentParams(new URLSearchParams(sp.toString()));
  const current = views.find((v) => v.params === params);

  async function save() {
    if (!name.trim()) return;
    await saveView({ projectId, name, params });
    toast.success(`Saved view “${name.trim()}”`);
    setNaming(false);
    setName("");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={current ? "secondary" : "ghost"} size="sm" className="h-7 text-xs font-normal">
            <Bookmark className="size-3.5" />
            {current ? current.name : "Views"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {views.length ? (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Saved views</DropdownMenuLabel>
              {views.map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => router.replace(v.params ? `${pathname}?${v.params}` : pathname, { scroll: false })} className="group">
                  {v.id === current?.id ? <Check className="size-3.5" /> : <Bookmark className="size-3.5 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete view ${v.name}`}
                    className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 group-focus:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void deleteView(v.id);
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => setNaming(true)} disabled={!params}>
            <BookmarkPlus className="size-3.5" /> {params ? "Save current view…" : "Set a filter to save a view"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>The current filters and grouping, under a name you will find in the Views menu.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My open work"
            dir="auto"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!name.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
