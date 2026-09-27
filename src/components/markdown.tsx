"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bold, Columns2, Eye, Italic, Link2, List, ListChecks, Pencil, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLinkIndex } from "@/hooks/use-data";
import { resolveLink, rewriteWikiLinks, suggestTargets } from "@/lib/wikilinks";
import { useUi } from "@/lib/ui-store";

// MarkdownView renders GFM plus [[wikilinks]]. MarkdownEditor is a plain
// textarea with a preview, a small toolbar, and Obsidian-style [[ completion.

export function MarkdownView({ body, className, onToggleTask }: { body: string; className?: string; onToggleTask?: (index: number, checked: boolean) => void }) {
  const idx = useLinkIndex();
  const source = useMemo(() => rewriteWikiLinks(body), [body]);
  // Line numbers of task items, so each rendered checkbox maps back to the
  // n-th task in the source without mutable render state.
  const taskLines = useMemo(() => {
    const out: { line: number; checked: boolean }[] = [];
    body.split("\n").forEach((line, i) => {
      const m = TASK_LINE_RE.exec(line);
      if (m) out.push({ line: i + 1, checked: m[1] !== " " });
    });
    return out;
  }, [body]);

  return (
    <div className={cn("md", className)} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (href?.startsWith("wiki:")) {
              const target = decodeURIComponent(href.slice(5));
              const r = resolveLink(target, idx);
              return (
                <Link
                  href={r.href}
                  className={cn("wiki", r.kind === "missing" && "wiki-missing", r.kind === "issue" && "wiki-issue")}
                  title={r.kind === "missing" ? `Create "${target}"` : r.kind === "issue" ? r.issue.title : r.kind === "decision" ? r.decision.title : r.label}
                >
                  {children}
                </Link>
              );
            }
            const external = href && /^https?:/i.test(href);
            return (
              <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined} {...rest}>
                {children}
              </a>
            );
          },
          li: ({ className: cls, children, node, ...rest }) => {
            const isTask = cls?.includes("task-list-item");
            if (isTask) {
              // The checked state comes from the source line, not the parsed
              // tree: in a loose list the checkbox sits inside a <p>, so the
              // first child is not the input.
              const line = node?.position?.start.line ?? -1;
              const i = taskLines.findIndex((t) => t.line === line);
              const checked = i >= 0 ? taskLines[i].checked : false;
              return (
                <li className={cn(cls, checked && "done")} {...rest}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!onToggleTask}
                    onChange={(e) => i >= 0 && onToggleTask?.(i, e.target.checked)}
                    aria-label="Task"
                  />
                  <span className="flex-1">{stripLeadingCheckbox(children)}</span>
                </li>
              );
            }
            return (
              <li className={cls} {...rest}>
                {children}
              </li>
            );
          },
          input: () => null,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

const TASK_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/;

function stripLeadingCheckbox(children: React.ReactNode) {
  // react-markdown places the checkbox <input> as the first child; we render
  // our own, so drop it and the following whitespace.
  if (Array.isArray(children)) return children.slice(1);
  return children;
}

/** Toggle the n-th task checkbox in a markdown body. */
export function toggleTaskInMarkdown(body: string, index: number, checked: boolean) {
  let i = -1;
  return body.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/gm, (m, prefix: string) => {
    i += 1;
    if (i !== index) return m;
    return `${prefix}[${checked ? "x" : " "}]`;
  });
}

type Mode = "edit" | "preview" | "split";

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write in markdown. Type [[ to link a note, issue or decision.",
  className,
  minRows = 14,
  autoFocus,
  mode: modeProp,
  onModeChange,
  aiContext,
  onToggleTask,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  autoFocus?: boolean;
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  /** When set, the toolbar shows an "Ask AI" button with this note attached. */
  aiContext?: { noteId?: string; projectId?: string };
  /** Makes task checkboxes in the preview toggleable. */
  onToggleTask?: (index: number, checked: boolean) => void;
}) {
  const [modeState, setModeState] = useState<Mode>("edit");
  const mode = modeProp ?? modeState;
  const setMode = (m: Mode) => {
    setModeState(m);
    onModeChange?.(m);
  };
  const ref = useRef<HTMLTextAreaElement>(null);
  const idx = useLinkIndex();
  const { openAI } = useUi();
  const [suggest, setSuggest] = useState<{ query: string; start: number; items: { label: string; hint: string }[]; active: number } | null>(null);

  // Autosize.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 26)}px`;
  }, [value, minRows, mode]);

  function wrap(before: string, after = before) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || "text";
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  }

  function prefixLines(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const lineEnd = value.indexOf("\n", e);
    const end = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, end);
    const next = value.slice(0, lineStart) + block.split("\n").map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l)).join("\n") + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => el.focus());
  }

  function updateSuggest(el: HTMLTextAreaElement, nextValue: string) {
    const caret = el.selectionStart;
    const before = nextValue.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open === -1) return setSuggest(null);
    const after = before.slice(open + 2);
    if (after.includes("]]") || after.includes("\n")) return setSuggest(null);
    const items = suggestTargets(after, idx);
    setSuggest({ query: after, start: open, items, active: 0 });
  }

  function applySuggestion(label: string) {
    const el = ref.current;
    if (!el || !suggest) return;
    const caret = el.selectionStart;
    const next = value.slice(0, suggest.start) + `[[${label}]]` + value.slice(caret);
    onChange(next);
    setSuggest(null);
    const pos = suggest.start + label.length + 4;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest && suggest.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggest({ ...suggest, active: (suggest.active + 1) % suggest.items.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggest({ ...suggest, active: (suggest.active - 1 + suggest.items.length) % suggest.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggest.items[suggest.active].label);
        return;
      }
      if (e.key === "Escape") {
        setSuggest(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "b") {
      e.preventDefault();
      wrap("**");
    } else if (mod && e.key === "i") {
      e.preventDefault();
      wrap("_");
    } else if (mod && e.key === "k") {
      // leave ⌘K to the command palette
    } else if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      onChange(value.slice(0, s) + "  " + value.slice(el.selectionEnd));
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    } else if (e.key === "Enter" && !e.shiftKey) {
      // Continue lists.
      const el = e.currentTarget;
      const s = el.selectionStart;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[4].trim()) {
          onChange(value.slice(0, lineStart) + value.slice(s));
          requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
          return;
        }
        const bullet = /\d/.test(m[2]) ? `${parseInt(m[2]) + 1}.` : m[2];
        const insert = `\n${m[1]}${bullet} ${m[3] ? "[ ] " : ""}`;
        onChange(value.slice(0, s) + insert + value.slice(el.selectionEnd));
        requestAnimationFrame(() => el.setSelectionRange(s + insert.length, s + insert.length));
      }
    }
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
      <ToolBtn label="Bold (⌘B)" onClick={() => wrap("**")}><Bold /></ToolBtn>
      <ToolBtn label="Italic (⌘I)" onClick={() => wrap("_")}><Italic /></ToolBtn>
      <ToolBtn label="Bullet list" onClick={() => prefixLines("- ")}><List /></ToolBtn>
      <ToolBtn label="Task list" onClick={() => prefixLines("- [ ] ")}><ListChecks /></ToolBtn>
      <ToolBtn label="Wikilink" onClick={() => wrap("[[", "]]")}><Link2 /></ToolBtn>
      <span className="mx-1 h-4 w-px bg-border" />
      {aiContext ? (
        <ToolBtn label="Ask AI about this" onClick={() => openAI({ ...aiContext, action: "ask" })}>
          <Sparkles />
        </ToolBtn>
      ) : null}
      <div className="ms-auto flex items-center gap-0.5">
        <ToolBtn label="Edit" active={mode === "edit"} onClick={() => setMode("edit")}><Pencil /></ToolBtn>
        <ToolBtn label="Split" active={mode === "split"} onClick={() => setMode("split")}><Columns2 /></ToolBtn>
        <ToolBtn label="Preview" active={mode === "preview"} onClick={() => setMode("preview")}><Eye /></ToolBtn>
      </div>
    </div>
  );

  const editor = (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        dir="auto"
        spellCheck
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          updateSuggest(e.target, e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setSuggest(null), 150)}
        className="editor-textarea w-full bg-transparent px-4 py-3 outline-none placeholder:text-muted-foreground/70"
        rows={minRows}
      />
      {suggest && suggest.items.length ? (
        <div className="absolute start-4 bottom-2 z-20 w-80 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">Link to… ↑↓ then Enter</div>
          <ul className="max-h-56 overflow-auto py-1">
            {suggest.items.map((it, i) => (
              <li key={it.label + i}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(it.label);
                  }}
                  className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-start text-sm", i === suggest.active && "bg-accent")}
                >
                  <span className="truncate">{it.label}</span>
                  <span className="ms-auto truncate text-xs text-muted-foreground">{it.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  const preview = (
    <div className="px-4 py-3">
      {value.trim() ? <MarkdownView body={value} onToggleTask={onToggleTask} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
    </div>
  );

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      {toolbar}
      {mode === "edit" ? editor : mode === "preview" ? preview : (
        <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x">
          {editor}
          {preview}
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export type MarkdownEditorProps = ComponentProps<typeof MarkdownEditor>;
