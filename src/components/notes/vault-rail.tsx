"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Files, Folder, FolderOpen, Hash, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Note } from "@/lib/types";

export interface FolderNode {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
}

/** Folder tree from "A/B/C" paths. Counts include every note beneath a folder. */
export function buildFolderTree(notes: Note[]): FolderNode[] {
  const root: FolderNode = { name: "", path: "", count: 0, children: [] };
  for (const n of notes) {
    const parts = n.folder.split("/").map((s) => s.trim()).filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let child = cur.children.find((c) => c.path === path);
      if (!child) {
        child = { name: parts[i], path, count: 0, children: [] };
        cur.children.push(child);
      }
      child.count += 1;
      cur = child;
    }
  }
  const sortTree = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(root.children);
  return root.children;
}

export function inFolder(note: Note, folder: string) {
  return !folder || note.folder === folder || note.folder.startsWith(folder + "/");
}

function FolderTree({ nodes, depth, active, onSelect }: { nodes: FolderNode[]; depth: number; active: string; onSelect: (path: string) => void }) {
  return (
    <ul className="space-y-px">
      {nodes.map((n) => {
        const open = active === n.path || active.startsWith(n.path + "/");
        return (
          <li key={n.path}>
            <button
              type="button"
              onClick={() => onSelect(active === n.path ? "" : n.path)}
              aria-pressed={active === n.path}
              style={{ paddingInlineStart: `${0.5 + depth * 0.75}rem` }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pe-2 text-start text-sm hover:bg-muted",
                active === n.path ? "bg-accent font-medium" : "text-foreground/80",
              )}
            >
              {open ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate" dir="auto">
                {n.name}
              </span>
              <span className="ms-auto text-[11px] text-muted-foreground tabular">{n.count}</span>
            </button>
            {n.children.length ? <FolderTree nodes={n.children} depth={depth + 1} active={active} onSelect={onSelect} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Left rail of the vault: folders, pinned notes and a tag cloud. */
export function VaultRail({
  notes,
  folder,
  tag,
  onFolder,
  onTag,
  className,
}: {
  notes: Note[];
  folder: string;
  tag: string;
  onFolder: (path: string) => void;
  onTag: (tag: string) => void;
  className?: string;
}) {
  const tree = useMemo(() => buildFolderTree(notes), [notes]);
  const pinned = useMemo(() => notes.filter((n) => n.pinned).sort((a, b) => a.title.localeCompare(b.title)), [notes]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  return (
    <nav className={cn("space-y-5", className)} aria-label="Vault">
      <section>
        <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</h2>
        <button
          type="button"
          onClick={() => onFolder("")}
          aria-pressed={!folder}
          className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-start text-sm hover:bg-muted", !folder ? "bg-accent font-medium" : "text-foreground/80")}
        >
          <Files className="size-3.5 shrink-0 text-muted-foreground" />
          All notes
          <span className="ms-auto text-[11px] text-muted-foreground tabular">{notes.length}</span>
        </button>
        <FolderTree nodes={tree} depth={0} active={folder} onSelect={onFolder} />
      </section>

      {pinned.length ? (
        <section>
          <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pinned</h2>
          <ul className="space-y-px">
            {pinned.map((n) => (
              <li key={n.id}>
                <Link href={`/notes/${n.id}`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-muted">
                  <Pin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate" dir="auto">
                    {n.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tags.length ? (
        <section>
          <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tags</h2>
          <div className="flex flex-wrap gap-1 px-2">
            {tags.map(([t, count]) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(tag === t ? "" : t)}
                aria-pressed={tag === t}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs hover:bg-muted",
                  tag === t ? "border-foreground/40 bg-accent font-medium" : "border-transparent bg-secondary text-foreground/80",
                )}
                dir="auto"
              >
                <Hash className="size-3 text-muted-foreground" />
                {t}
                <span className="ms-0.5 text-[10px] text-muted-foreground tabular">{count}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </nav>
  );
}
