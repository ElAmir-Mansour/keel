"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  CalendarDays,
  CircleDot,
  Download,
  FileText,
  FolderKanban,
  GitBranch,
  Home,
  Inbox,
  LayoutGrid,
  Moon,
  Plus,
  Scale,
  Settings,
  Sparkles,
  Sun,
  Users,
  Waypoints,
} from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useActiveProjects, useAllDecisions, useAllIssues, useAllNotes, useProjects } from "@/hooks/use-data";
import { getOrCreateDailyNote } from "@/lib/repo";
import { searchAll } from "@/lib/search";
import { useUi } from "@/lib/ui-store";
import { exportAll, downloadJSON } from "@/lib/export";
import { todayYMD } from "@/lib/dates";
import { ProjectDot } from "@/components/ui-bits";
import { semanticReady, semanticSearch, type SemanticHit } from "@/lib/ai/semantic";

export const NAV = [
  { href: "/", label: "Home", icon: Home, key: "h" },
  { href: "/inbox", label: "Inbox", icon: Inbox, key: "i" },
  { href: "/projects", label: "Projects", icon: FolderKanban, key: "p" },
  { href: "/notes", label: "Notes", icon: FileText, key: "n" },
  { href: "/decisions", label: "Decisions", icon: Scale, key: "d" },
  { href: "/risks", label: "Risks", icon: AlertTriangle, key: "r" },
  { href: "/graph", label: "Graph", icon: Waypoints, key: "g" },
  { href: "/team", label: "People", icon: Users, key: "t" },
  { href: "/settings", label: "Settings", icon: Settings, key: "," },
];

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openQuickCreate, openAI } = useUi();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [q, setQ] = useState("");
  const projects = useProjects();
  const active = useActiveProjects();
  const issues = useAllIssues();
  const notes = useAllNotes();
  const decisions = useAllDecisions();

  function setOpen(v: boolean) {
    setPaletteOpen(v);
    if (!v) setQ("");
  }

  const hits = useMemo(() => searchAll(q, { notes, issues, decisions, projects }), [q, notes, issues, decisions, projects]);

  // Meaning-based matches, when the on-device index is on. Debounced so the
  // model is not asked on every keystroke.
  const [related, setRelated] = useState<SemanticHit[]>([]);
  useEffect(() => {
    if (!paletteOpen || q.trim().length < 3 || !semanticReady()) return;
    let alive = true;
    const t = setTimeout(() => {
      void semanticSearch(q, 5).then((r) => {
        if (alive) setRelated(r.filter((h) => !hits.some((x) => x.id === h.recordId)));
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, paletteOpen, hits]);
  const relatedHref = (h: SemanticHit) => {
    if (h.kind === "note") return `/notes/${h.recordId}`;
    if (h.kind === "decision") return `/decisions/${h.recordId}`;
    const i = issues.find((x) => x.id === h.recordId);
    return i ? `/projects/${i.projectId}/issues/${i.seq}` : "/inbox";
  };

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }
  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setOpen} title="Command palette" description="Search notes, issues and decisions, or run a command" className="sm:max-w-xl">
      <Command shouldFilter={!q.trim() || (hits.length === 0 && related.length === 0)} loop>
        <CommandInput placeholder="Search or type a command…" value={q} onValueChange={setQ} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>Nothing found.</CommandEmpty>
          {hits.length ? (
            <CommandGroup heading="Results">
              {hits.map((h) => (
                <CommandItem key={h.kind + h.id} value={`${h.kind}-${h.id}`} onSelect={() => go(h.href)}>
                  {h.kind === "note" ? <FileText /> : h.kind === "issue" ? <CircleDot /> : h.kind === "decision" ? <Scale /> : <FolderKanban />}
                  <span className="truncate">{h.title}</span>
                  <span className="ms-auto truncate text-xs text-muted-foreground">{h.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {q.trim().length >= 3 && related.length ? (
            <CommandGroup heading="Related by meaning">
              {related.map((h) => (
                <CommandItem key={"sem" + h.recordId} value={`sem-${h.recordId}`} onSelect={() => go(relatedHref(h))}>
                  {h.kind === "note" ? <FileText /> : h.kind === "issue" ? <CircleDot /> : <Scale />}
                  <span className="truncate">{h.title}</span>
                  <span className="ms-auto text-xs text-muted-foreground">{Math.round(h.score * 100)}%</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading="Create">
            <CommandItem onSelect={() => run(() => openQuickCreate("issue"))}>
              <Plus /> New issue <CommandShortcut>C</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => openQuickCreate("note"))}>
              <FileText /> New note <CommandShortcut>N</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(async () => {
                  const n = await getOrCreateDailyNote(todayYMD());
                  router.push(`/notes/${n.id}`);
                })
              }
            >
              <CalendarDays /> Open today&apos;s note <CommandShortcut>T</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => run(() => openQuickCreate("decision"))}>
              <Scale /> New decision
            </CommandItem>
            <CommandItem onSelect={() => run(() => openQuickCreate("risk"))}>
              <AlertTriangle /> New risk
            </CommandItem>
            <CommandItem onSelect={() => run(() => openQuickCreate("project"))}>
              <FolderKanban /> New project
            </CommandItem>
            <CommandItem onSelect={() => run(() => openAI({ action: "ask" }))}>
              <Sparkles /> Ask AI <CommandShortcut>A</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {NAV.map((n) => (
              <CommandItem key={n.href} onSelect={() => go(n.href)}>
                <n.icon /> {n.label}
                <CommandShortcut>G {n.key.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {active.length ? (
            <CommandGroup heading="Projects">
              {active.map((p) => (
                <CommandItem key={p.id} value={`project ${p.name} ${p.key}`} onSelect={() => go(`/projects/${p.id}`)}>
                  <ProjectDot project={p} className="ms-1 me-1" /> {p.name}
                  <span className="ms-auto font-mono text-xs text-muted-foreground">{p.key}</span>
                </CommandItem>
              ))}
              {active.map((p) => (
                <CommandItem key={p.id + "board"} value={`board ${p.name} ${p.key}`} onSelect={() => go(`/projects/${p.id}/board`)}>
                  <LayoutGrid /> {p.name} board
                </CommandItem>
              ))}
              {active.map((p) => (
                <CommandItem key={p.id + "roadmap"} value={`roadmap ${p.name} ${p.key}`} onSelect={() => go(`/projects/${p.id}/roadmap`)}>
                  <GitBranch /> {p.name} roadmap
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Workspace">
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Toggle theme
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(async () => {
                  const data = await exportAll();
                  downloadJSON(data, `keel-export-${todayYMD()}.json`);
                })
              }
            >
              <Download /> Export everything as JSON
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
