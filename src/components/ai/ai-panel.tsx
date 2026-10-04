"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import {
  AlignLeft,
  ArrowUp,
  CalendarClock,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Search,
  Sparkles,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import { updateNote } from "@/lib/repo";
import { useUi, type AiRequest } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { useLang, useT } from "@/lib/i18n";
import { AiError, configLabel, streamTurn, useAiConfig } from "@/lib/ai/client";
import { executeToolCall } from "@/lib/ai/actions";
import { AI_TOOL_NAMES } from "@/lib/ai/tools";
import { SourceList, ToolCallCards, withCitations, type ToolCallState } from "@/components/ai/ai-tools";
import {
  CONTEXT_BUDGET,
  fitBudget,
  noteContext,
  projectContext,
  vaultRetrievalWithSources,
  type Source,
  workspaceOverview,
} from "@/lib/ai/context";
import { type AiChatMessage, type AiContentBlock, type AiErrorCode } from "@/lib/ai/models";
import { ACTION_LABELS, ACTION_PROMPTS, buildSystem, type AiAction } from "@/lib/ai/prompts";
import { MarkdownView } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyButton, TasksProposal, WeeklyPost, unfence } from "@/components/ai/ai-results";

// The assistant panel. Conversation state lives here, in memory only, so it
// survives closing the sheet and dies with the tab. Nothing is sent until the
// user presses send or picks an action, and the context that would go along
// is listed (and sized) above the transcript.

interface Attach {
  noteId?: string;
  projectId?: string;
}

interface ContextInfo {
  text: string;
  parts: { label: string; chars: number }[];
}

type MsgStatus = "streaming" | "done" | "stopped" | "error";

interface Msg {
  id: string;
  role: "user" | "assistant";
  /** What the transcript shows. */
  content: string;
  /** What actually went to the model (prompt plus vault excerpts); defaults to content. */
  sent?: string;
  action: AiAction;
  /** Snapshot of the attachments when the turn ran, so result actions target the right records. */
  noteId?: string;
  projectId?: string;
  status: MsgStatus;
  error?: { code: AiErrorCode; message: string };
  excerptChars?: number;
  /** Length of the wire history when this user turn started; retry truncates to it. */
  wireIndex?: number;
  /** Actions the model proposed in this turn. */
  toolCalls?: ToolCallState[];
  /** Numbered vault excerpts the answer may cite. */
  sources?: Source[];
}

interface PendingAction {
  seq: number;
  action: AiAction;
  ids: Attach;
}

const RESERVED_FOR_EXCERPTS = 6_000;
// English here; translated at render time with t().
const SUGGESTIONS = ["What is in progress right now?", "Which risks need attention?", "What did we decide recently?"];

async function buildContext(ids: Attach): Promise<ContextInfo> {
  const [overview, note, project] = await Promise.all([
    workspaceOverview(),
    ids.noteId ? noteContext(ids.noteId) : null,
    ids.projectId ? projectContext(ids.projectId) : null,
  ]);
  // Labels stay English; the panel translates them with t() when it lists them.
  const parts = [
    { label: "Workspace overview", text: overview },
    note ? { label: "Note", text: note } : null,
    project ? { label: "Project activity", text: project } : null,
  ].filter((p): p is { label: string; text: string } => p !== null);
  return {
    text: fitBudget(
      parts.map((p) => p.text),
      CONTEXT_BUDGET - RESERVED_FOR_EXCERPTS,
    ),
    parts: parts.map((p) => ({ label: p.label, chars: p.text.length })),
  };
}

function fmtChars(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function AiPanel() {
  const t = useT();
  const lang = useLang();
  const { ai, closeAI } = useUi();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [attach, setAttach] = useState<Attach>({});
  const [searchVault, setSearchVault] = useState(true);
  const [draft, setDraft] = useState("");
  const [ctx, setCtx] = useState<ContextInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [seenRequest, setSeenRequest] = useState<AiRequest | null | undefined>(undefined);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // The exact conversation sent to the model (tool blocks included); the
  // transcript above is what people read.
  const wireRef = useRef<AiChatMessage[]>([]);
  const callsRef = useRef<Map<string, ToolCallState[]>>(new Map());
  const waitersRef = useRef<Map<string, (blocks: AiContentBlock[]) => void>>(new Map());
  const messagesRef = useRef(messages);
  const searchRef = useRef(searchVault);
  useEffect(() => {
    messagesRef.current = messages;
    searchRef.current = searchVault;
  });

  // Apply a new request while rendering (React's "adjust state from props"
  // pattern): attachments named by the request replace the current ones, a
  // prompt prefills the composer, and a named action is queued for the effect.
  if (ai.open && ai.request !== seenRequest) {
    setSeenRequest(ai.request);
    const req = ai.request;
    if (req) {
      const ids = req.noteId || req.projectId ? { noteId: req.noteId, projectId: req.projectId } : attach;
      if (ids !== attach) setAttach(ids);
      if (req.prompt) setDraft(req.prompt);
      if (req.action && req.action !== "ask") setPending({ seq: (pending?.seq ?? 0) + 1, action: req.action, ids });
    }
  }

  const patch = useCallback((id: string, p: Partial<Msg>) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m))), []);

  /** Settle one proposed action; when the turn's last one settles, the model gets the results. */
  const decide = useCallback(
    async (asstId: string, callId: string, choice: "apply" | "skip") => {
      const calls = callsRef.current.get(asstId);
      const call = calls?.find((c) => c.id === callId);
      if (!calls || !call || call.status !== "pending") return;
      const msg = messagesRef.current.find((m) => m.id === asstId);
      const mirror = () => patch(asstId, { toolCalls: calls.map((c) => ({ ...c })) });
      if (choice === "skip") {
        call.status = "skipped";
        // Goes back to the model as a tool result, so it stays English; the card translates it.
        call.result = "Skipped by the user.";
      } else {
        call.status = "running";
        mirror();
        try {
          call.result = await executeToolCall(call, { projectId: msg?.projectId });
          call.status = "applied";
          toast.success(call.result);
        } catch (err) {
          call.status = "failed";
          call.result = err instanceof Error ? err.message : String(err);
        }
      }
      mirror();
      if (calls.every((c) => c.status !== "pending" && c.status !== "running")) {
        const blocks: AiContentBlock[] = calls.map((c) => ({
          type: "tool_result",
          tool_use_id: c.id,
          content: c.result ?? "",
          ...(c.status === "failed" || c.status === "skipped" ? { is_error: true } : {}),
        }));
        waitersRef.current.get(asstId)?.(blocks);
      }
    },
    [patch],
  );

  const decideAll = useCallback(
    async (asstId: string, choice: "apply" | "skip") => {
      const calls = callsRef.current.get(asstId) ?? [];
      for (const c of calls) if (c.status === "pending") await decide(asstId, c.id, choice);
    },
    [decide],
  );

  const run = useCallback(async (action: AiAction, prompt: string, ids: Attach) => {
    if (abortRef.current) return;
    if (action !== "ask" && action !== "weekly" && !ids.noteId) {
      toast.error(t("Attach a note first"));
      return;
    }
    if (action === "weekly" && !ids.projectId) {
      toast.error(t("Attach a project first"));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    const userId = nanoid(8);
    const wireStart = wireRef.current.length;
    setMessages((prev) => [...prev, { id: userId, role: "user", content: action === "ask" ? prompt : ACTION_LABELS[action], action, status: "done", wireIndex: wireStart }]);

    let asstId = "";
    try {
      const c = await buildContext(ids);
      setCtx(c);
      let sent = action === "ask" ? prompt : ACTION_PROMPTS[action];
      let sources: Source[] = [];
      if (action === "ask" && searchRef.current) {
        const r = await vaultRetrievalWithSources(prompt);
        if (r) {
          sent = `${r.text}\n\n---\n\nQuestion: ${prompt}`;
          sources = r.sources;
          patch(userId, { excerptChars: r.text.length });
        }
      }
      patch(userId, { sent });
      wireRef.current.push({ role: "user", content: sent });
      if (controller.signal.aborted) throw new AiError("aborted", t("Stopped."));
      const tools = action === "ask" ? AI_TOOL_NAMES : undefined;

      // Up to five model turns: a turn that proposes actions waits for the
      // person's decisions, sends the results back, and continues.
      for (let iter = 0; iter < 5; iter += 1) {
        asstId = nanoid(8);
        setMessages((prev) => [...prev, { id: asstId, role: "assistant", content: "", action, noteId: ids.noteId, projectId: ids.projectId, status: "streaming", sources }]);
        // Deltas are batched per tick so react-markdown is not re-parsed per token.
        let buffer = "";
        let timer: number | null = null;
        const target = asstId;
        const flush = () => {
          timer = null;
          if (!buffer) return;
          const chunk = buffer;
          buffer = "";
          setMessages((prev) => prev.map((m) => (m.id === target ? { ...m, content: m.content + chunk } : m)));
        };
        const flushNow = () => {
          if (timer !== null) window.clearTimeout(timer);
          flush();
        };
        let turn;
        try {
          turn = await streamTurn(
            { system: buildSystem(c.text), messages: wireRef.current, json: action === "tasks", tools, signal: controller.signal },
            {
              onText: (t) => {
                buffer += t;
                if (timer === null) timer = window.setTimeout(flush, 40);
              },
            },
          );
        } finally {
          flushNow();
        }
        wireRef.current.push({ role: "assistant", content: turn.blocks.length ? turn.blocks : turn.text || "(no answer)" });
        if (turn.stopReason === "tool_use" && turn.toolCalls.length) {
          const calls: ToolCallState[] = turn.toolCalls.map((tc) => ({ ...tc, status: "pending" }));
          callsRef.current.set(asstId, calls);
          patch(asstId, { status: "done", toolCalls: calls.map((x) => ({ ...x })) });
          const results = await new Promise<AiContentBlock[]>((resolve, reject) => {
            waitersRef.current.set(asstId, resolve);
            controller.signal.addEventListener("abort", () => reject(new AiError("aborted", t("Stopped."))), { once: true });
          });
          waitersRef.current.delete(asstId);
          wireRef.current.push({ role: "user", content: results });
          continue;
        }
        patch(asstId, { status: "done" });
        break;
      }
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("server_error", t("Something went wrong."));
      if (asstId) {
        if (e.code === "aborted") patch(asstId, { status: "stopped" });
        else patch(asstId, { status: "error", error: { code: e.code, message: e.message } });
      } else {
        setMessages((prev) => [...prev, { id: nanoid(8), role: "assistant", content: "", action, status: "error", error: { code: e.code, message: e.message } }]);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [patch, t]);

  // Kick off a queued action once the request has been applied. Deferred a
  // tick so the effect starts a job rather than re-rendering synchronously,
  // and so StrictMode's double invoke cannot start it twice.
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => void run(pending.action, "", pending.ids), 0);
    return () => window.clearTimeout(t);
  }, [pending, run]);

  useEffect(() => {
    if (!ai.open) return;
    let alive = true;
    void buildContext(attach).then((c) => {
      if (alive) setCtx(c);
    });
    return () => {
      alive = false;
    };
  }, [ai.open, attach]);

  const stop = () => abortRef.current?.abort();

  function newChat() {
    stop();
    wireRef.current = [];
    callsRef.current.clear();
    setMessages([]);
  }

  function retry(asstId: string) {
    const list = messagesRef.current;
    const i = list.findIndex((m) => m.id === asstId);
    let u = i - 1;
    while (u >= 0 && list[u].role !== "user") u -= 1;
    const user = u >= 0 ? list[u] : undefined;
    const asst = list[i];
    if (!user) return;
    wireRef.current = wireRef.current.slice(0, user.wireIndex ?? 0);
    setMessages(list.slice(0, u));
    void run(user.action, user.content, { noteId: asst.noteId, projectId: asst.projectId });
  }

  return (
    <Sheet
      open={ai.open}
      onOpenChange={(open) => {
        if (!open) closeAI();
      }}
    >
      <SheetContent side={lang === "ar" ? "left" : "right"} className="w-full gap-0 p-0 data-[side=left]:sm:max-w-xl data-[side=right]:sm:max-w-xl">
        {ai.open ? (
          <PanelBody
            messages={messages}
            attach={attach}
            setAttach={setAttach}
            searchVault={searchVault}
            setSearchVault={setSearchVault}
            draft={draft}
            setDraft={setDraft}
            ctx={ctx}
            busy={busy}
            run={run}
            stop={stop}
            retry={retry}
            newChat={newChat}
            decide={decide}
            decideAll={decideAll}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ----- body (mounted only while open) -------------------------------------------

interface PanelBodyProps {
  messages: Msg[];
  attach: Attach;
  setAttach: (a: Attach) => void;
  searchVault: boolean;
  setSearchVault: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  ctx: ContextInfo | null;
  busy: boolean;
  run: (action: AiAction, prompt: string, ids: Attach) => Promise<void>;
  stop: () => void;
  retry: (asstId: string) => void;
  newChat: () => void;
  decide: (asstId: string, callId: string, choice: "apply" | "skip") => Promise<void>;
  decideAll: (asstId: string, choice: "apply" | "skip") => Promise<void>;
}

function PanelBody(p: PanelBodyProps) {
  const { messages, attach, setAttach, searchVault, setSearchVault, draft, setDraft, ctx, busy, run, stop, retry, newChat, decide, decideAll } = p;
  const t = useT();
  const aiConfig = useAiConfig();
  const note = useLiveQuery(() => (attach.noteId ? db.notes.get(attach.noteId) : undefined), [attach.noteId]);
  const project = useLiveQuery(() => (attach.projectId ? db.projects.get(attach.projectId) : undefined), [attach.projectId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Follow the stream unless the user scrolled up to read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    stickRef.current = true;
    void run("ask", text, attach);
  }

  function runAction(action: AiAction) {
    stickRef.current = true;
    void run(action, "", attach);
  }

  const totalChars = (ctx?.parts.reduce((n, x) => n + x.chars, 0) ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="gap-2 border-b pe-12">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <SheetTitle>{t("Assistant")}</SheetTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="font-normal">
                {configLabel(aiConfig)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{t("Change the model in Settings")}</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="xs" className="ms-auto" onClick={newChat} disabled={!messages.length}>
            <MessageSquarePlus /> {t("New chat")}
          </Button>
        </div>
        <SheetDescription className="sr-only">
          {t("Reads your vault and answers from it. Only the context listed here is sent, and only when you press send.")}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{t("Context:")}</span>
          {note ? (
            <ContextChip icon={<FileText />} label={note.title} onRemove={() => setAttach({ ...attach, noteId: undefined })} />
          ) : null}
          {project ? (
            <ContextChip
              icon={<FolderKanban />}
              label={project.name}
              onRemove={() => setAttach({ ...attach, projectId: undefined })}
            />
          ) : null}
          {searchVault ? <ContextChip icon={<Search />} label={t("vault search")} onRemove={() => setSearchVault(false)} /> : null}
          {!note && !project && !searchVault ? <span className="text-muted-foreground">{t("workspace overview only")}</span> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ms-auto tabular-nums text-muted-foreground">{t("{n} chars", { n: fmtChars(totalChars) })}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              <p className="mb-1 font-medium">{t("Sent with your next message")}</p>
              <ul className="space-y-0.5">
                {ctx?.parts.map((x) => (
                  <li key={x.label} className="flex justify-between gap-3">
                    <span>{t(x.label)}</span>
                    <span className="tabular-nums">{fmtChars(x.chars)}</span>
                  </li>
                ))}
                {searchVault ? (
                  <li className="flex justify-between gap-3">
                    <span>{t("Vault excerpts")}</span>
                    <span>{t("up to {n}", { n: fmtChars(RESERVED_FOR_EXCERPTS) })}</span>
                  </li>
                ) : null}
              </ul>
            </TooltipContent>
          </Tooltip>
        </div>
      </SheetHeader>

      <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
        {note ? (
          <>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => runAction("summarize")}>
              <AlignLeft /> {t("Summarize")}
            </Button>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => runAction("improve")}>
              <PenLine /> {t("Improve writing")}
            </Button>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => runAction("tasks")}>
              <ListChecks /> {t("Extract tasks")}
            </Button>
          </>
        ) : null}
        {project ? (
          <Button variant="outline" size="xs" disabled={busy} onClick={() => runAction("weekly")}>
            <CalendarClock /> {t("Draft weekly update")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={() => {
            if (draft.trim()) submit();
            else textareaRef.current?.focus();
          }}
        >
          <MessageSquare /> {t("Ask")}
        </Button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length ? (
          <div className="space-y-4">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.id} m={m} />
              ) : (
                <AssistantMessage key={m.id} m={m} onRetry={() => retry(m.id)} onDecide={(id, choice) => void decide(m.id, id, choice)} onDecideAll={(choice) => void decideAll(m.id, choice)} />
              ),
            )}
          </div>
        ) : (
          <div className="space-y-3 py-6 text-sm text-muted-foreground">
            <p>{t("Ask about anything in your vault — notes, issues, decisions, risks. Attach a note or a project from its page for the one-click actions.")}</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setDraft(t(s));
                    textareaRef.current?.focus();
                  }}
                >
                  {t(s)}
                </Button>
              ))}
            </div>
            <p className="text-xs">{aiConfig.def.local ? t("Nothing is sent until you press send. The model runs on your own machine, so nothing leaves it.") : t("Nothing is sent until you press send. Only the context listed above goes to {provider}.", { provider: aiConfig.def.label.replace(/ \(.*\)$/, "") })}</p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          dir="auto"
          rows={1}
          autoFocus
          placeholder={t("Ask about your vault… Enter to send, Shift+Enter for a new line")}
          className="max-h-40 min-h-10 resize-none text-sm"
        />
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Switch size="sm" checked={searchVault} onCheckedChange={setSearchVault} />
            {t("Search vault")}
          </label>
          <div className="ms-auto flex items-center gap-2">
            {busy ? (
              <Button size="sm" variant="outline" onClick={stop}>
                <Square /> {t("Stop")}
              </Button>
            ) : (
              <Button size="sm" disabled={!draft.trim()} onClick={submit}>
                <ArrowUp /> {t("Send")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContextChip({ icon, label, onRemove }: { icon: React.ReactNode; label: string; onRemove: () => void }) {
  const t = useT();
  return (
    <Badge variant="secondary" className="max-w-56 gap-1 pe-1 font-normal">
      {icon}
      <span className="truncate" dir="auto">
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("Remove {label}", { label })}
        className="ms-0.5 rounded-full p-0.5 hover:bg-foreground/10"
      >
        <X className="size-3" />
      </button>
    </Badge>
  );
}

function UserMessage({ m }: { m: Msg }) {
  const t = useT();
  // A one-click action stores its English label (ACTION_LABELS) as the content; translate that, never a typed question.
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground" dir="auto">
        {m.action === "ask" ? m.content : t(m.content)}
      </div>
      {m.excerptChars ? (
        <span className="text-[11px] text-muted-foreground">{t("+ {n} chars of vault excerpts", { n: fmtChars(m.excerptChars) })}</span>
      ) : null}
    </div>
  );
}

function AssistantMessage({ m, onRetry, onDecide, onDecideAll }: { m: Msg; onRetry: () => void; onDecide: (callId: string, choice: "apply" | "skip") => void; onDecideAll: (choice: "apply" | "skip") => void }) {
  const t = useT();
  const streaming = m.status === "streaming";
  let body: React.ReactNode = null;
  if (m.action === "tasks") {
    body = streaming ? (
      <Thinking label={t("Extracting tasks…")} />
    ) : m.content ? (
      <TasksProposal raw={m.content} noteId={m.noteId} projectId={m.projectId} />
    ) : null;
  } else if (m.content) {
    body = <MarkdownView body={m.sources?.length && !streaming ? withCitations(m.content, m.sources) : m.content} className="text-sm" />;
  } else if (streaming) {
    body = <Thinking label={t("Thinking…")} />;
  } else if (m.toolCalls?.length) {
    body = null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Sparkles className="size-3" /> {t("Assistant")}
        {m.status === "stopped" ? <span>· {t("stopped")}</span> : null}
      </div>
      {body}
      {streaming && m.content && m.action !== "tasks" ? (
        <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-middle" aria-hidden />
      ) : null}
      {m.toolCalls?.length ? <ToolCallCards calls={m.toolCalls} onDecide={onDecide} onDecideAll={onDecideAll} disabled={m.status === "stopped"} /> : null}
      {m.status === "done" && m.content && m.sources?.length ? <SourceList sources={m.sources} /> : null}
      {m.error ? <ErrorNote error={m.error} onRetry={onRetry} /> : null}
      {m.status === "done" && m.content && !m.toolCalls?.length ? <ResultActions m={m} /> : null}
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> {label}
    </span>
  );
}

function ErrorNote({ error, onRetry }: { error: NonNullable<Msg["error"]>; onRetry: () => void }) {
  const t = useT();
  const { closeAI } = useUi();
  const needsKey = error.code === "no_api_key" || error.code === "bad_key";
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <p>{error.message}</p>
      <div className="mt-1.5 flex gap-2">
        {needsKey ? (
          <Button asChild size="xs" variant="outline">
            <Link href="/settings" onClick={closeAI}>
              {t("Open Settings")}
            </Link>
          </Button>
        ) : (
          <Button size="xs" variant="outline" onClick={onRetry}>
            {t("Retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

function ResultActions({ m }: { m: Msg }) {
  const t = useT();
  const router = useRouter();
  const note = useLiveQuery(() => (m.noteId ? db.notes.get(m.noteId) : undefined), [m.noteId]);
  const text = unfence(m.content);

  async function replaceBody() {
    if (!note) return;
    const previous = note.body;
    await updateNote(note.id, { body: text });
    toast.success(t("Note body replaced"), {
      action: { label: t("Undo"), onClick: () => void updateNote(note.id, { body: previous }) },
    });
  }

  async function insertAtTop() {
    if (!note) return;
    const previous = note.body;
    await updateNote(note.id, { body: `${text}\n\n${previous}`.trim() });
    toast.success(t("Summary inserted at the top of the note"), {
      action: { label: t("Open note"), onClick: () => router.push(`/notes/${note.id}`) },
    });
  }

  switch (m.action) {
    case "improve":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" disabled={!note} onClick={replaceBody}>
            <SquarePen /> {t("Replace note body")}
          </Button>
          <CopyButton text={text} />
        </div>
      );
    case "summarize":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" disabled={!note} onClick={insertAtTop}>
            <AlignLeft /> {t("Insert at top of note")}
          </Button>
          <CopyButton text={text} />
        </div>
      );
    case "weekly":
      return <WeeklyPost markdown={m.content} projectId={m.projectId} />;
    case "tasks":
      return null;
    default:
      return (
        <div className={cn("flex flex-wrap items-center gap-2")}>
          <CopyButton text={text} />
        </div>
      );
  }
}
