"use client";
import { useT } from "@/lib/i18n";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Moon, Plus, Search, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveProjects } from "@/hooks/use-data";
import { useMounted } from "@/hooks/use-mounted";
import { getOrCreateDailyNote } from "@/lib/repo";
import { todayYMD } from "@/lib/dates";
import { useUi } from "@/lib/ui-store";
import { CommandPalette, NAV } from "@/components/command-palette";
import { QuickCreate } from "@/components/quick-create";
import { AiPanel } from "@/components/ai/ai-panel";
import { ProjectDot } from "@/components/ui-bits";

function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setPaletteOpen, openQuickCreate, openAI } = useUi();
  const projects = useActiveProjects();
  const mounted = useMounted();
  const t = useT();

  // Global keys: ⌘K palette; single keys when not typing; "g" then a letter to navigate.
  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (pendingG) {
        pendingG = false;
        clearTimeout(timer);
        const target = NAV.find((n) => n.key === k);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (k === "g") {
        pendingG = true;
        timer = setTimeout(() => (pendingG = false), 1200);
        return;
      }
      if (k === "c") {
        e.preventDefault();
        openQuickCreate("issue");
      } else if (k === "n") {
        e.preventDefault();
        openQuickCreate("note");
      } else if (k === "t") {
        e.preventDefault();
        void getOrCreateDailyNote(todayYMD()).then((n) => router.push(`/notes/${n.id}`));
      } else if (k === "a") {
        e.preventDefault();
        openAI({ action: "ask" });
      } else if (k === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setPaletteOpen, openQuickCreate, openAI]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="Keel">
                <Link href="/">
                  <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <KeelMark />
                  </span>
                  <span className="grid leading-tight">
                    <span className="font-semibold">Keel</span>
                    <span className="text-xs text-muted-foreground">{t("Tech lead workspace")}</span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.filter((n) => n.href !== "/settings" && n.href !== "/projects").map((n) => (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton asChild isActive={isActive(n.href)} tooltip={t(n.label)}>
                      <Link href={n.href}>
                        <n.icon />
                        <span>{t(n.label)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t("Projects")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/projects"} tooltip={t("All projects")}>
                    <Link href="/projects">
                      {(() => {
                        const Icon = NAV.find((n) => n.href === "/projects")!.icon;
                        return <Icon />;
                      })()}
                      <span>{t("All projects")}</span>
                    </Link>
                  </SidebarMenuButton>
                  {mounted && projects.length ? (
                    <SidebarMenuSub>
                      {projects.slice(0, 8).map((p) => (
                        <SidebarMenuSubItem key={p.id}>
                          <SidebarMenuSubButton asChild isActive={pathname.startsWith(`/projects/${p.id}`)}>
                            <Link href={`/projects/${p.id}`}>
                              <ProjectDot project={p} />
                              <span className="truncate">{p.name}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isActive("/settings")} tooltip={t("Settings")}>
                <Link href="/settings">
                  {(() => {
                    const Icon = NAV.find((n) => n.href === "/settings")!.icon;
                    return <Icon />;
                  })()}
                  <span>{t("Settings")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ms-1" />
          <Button variant="outline" size="sm" className="h-8 w-56 justify-start gap-2 text-muted-foreground max-md:w-auto" onClick={() => setPaletteOpen(true)}>
            <Search className="size-3.5" />
            <span className="max-md:hidden">{t("Search or jump to…")}</span>
            <Kbd className="ms-auto max-md:hidden">⌘K</Kbd>
          </Button>
          <div className="ms-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 gap-1">
                  <Plus className="size-4" />
                  <span className="max-sm:hidden">{t("New")}</span>
                  <ChevronDown className="size-3 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => openQuickCreate("issue")}>{t("Issue")} <Kbd className="ms-auto">C</Kbd></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openQuickCreate("note")}>{t("Note")} <Kbd className="ms-auto">N</Kbd></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void getOrCreateDailyNote(todayYMD()).then((n) => router.push(`/notes/${n.id}`))}>{t("Today's note")} <Kbd className="ms-auto">T</Kbd></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => openQuickCreate("decision")}>{t("Decision")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openQuickCreate("risk")}>{t("Risk")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openQuickCreate("timeline")}>{t("Timeline")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openQuickCreate("project")}>{t("Project")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openQuickCreate("person")}>{t("Person")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => openAI({ action: "ask" })} aria-label={t("Ask AI")}>
                  <Sparkles className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("Ask AI")} <Kbd className="ms-1">A</Kbd></TooltipContent>
            </Tooltip>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-5 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </SidebarInset>
      <CommandPalette />
      <QuickCreate />
      <AiPanel />
    </SidebarProvider>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const t = useT();
  return (
    <Button variant="ghost" size="icon-sm" aria-label={t("Toggle theme")} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      {mounted && resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function KeelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6c4 0 6 3 8 3s4-3 8-3" />
      <path d="M12 9v9" />
      <path d="M7 18h10" />
    </svg>
  );
}
