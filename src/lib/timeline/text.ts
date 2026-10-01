import { addYears, endOfMonth, endOfQuarter, endOfYear, format, isValid, parseISO, startOfQuarter } from "date-fns";
import type { TimelineEntry, TimelineEntryStatus } from "@/lib/types";

// A small text form for timelines, close to Markwhen so it reads like notes:
//
//   ## Design                         ← group (swimlane) for the lines below
//   2026-09-12: Kickoff               ← one dated event
//   2026-09 / 2026-10: Discovery      ← a range; months cover the whole month
//   Sep 20 – Oct 3: Wireframes #ux    ← casual dates, #tag is the group
//   2026-10-15: !Launch               ← "!" marks a milestone (diamond)
//   2026-11-02: Retro #done [[PLAT-12]]
//   > One line of notes for the entry above.
//
// Entries are the record of truth; this module only converts to and from the
// text, so a paste becomes entries and entries can be copied back out.

export interface ParsedLine {
  line: number;
  entry: Omit<TimelineEntry, "id"> & { id?: string };
}

export interface ParseError {
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  entries: ParsedLine[];
  errors: ParseError[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const DATE_RE = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{4}-\\d{2}|\\d{4}|(?:\\d{1,2}\\s+)?${MONTH_RE}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?|q[1-4](?:\\s+\\d{4})?|now|today)`;
const LINE_RE = new RegExp(`^(${DATE_RE})(?:\\s*(?:\\/|–|—|→|->|\\.\\.|\\bto\\b|-)\\s*(${DATE_RE}))?\\s*:?\\s*(.*)$`, "i");
const GROUP_RE = /^(?:#{1,3}\s+(.+)|group\s+(.+))$/i;
const END_GROUP_RE = /^(?:end\s*group|---+)$/i;
const TAG_RE = /(^|\s)#([^\s#\[\]]+)/g;
const LINK_RE = /\[\[([^\[\]]+?)\]\]/;

const STATUS_TAGS: Record<string, TimelineEntryStatus> = { done: "done", active: "active", planned: "planned", upcoming: "planned", next: "planned", ongoing: "active" };

interface Span {
  start: Date;
  end: Date;
  /** Whether the token named a single day; coarser tokens cover a period. */
  day: boolean;
}

function monthIndex(name: string) {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

/** Resolve one date token into a span. Month, quarter and year tokens cover their whole period. */
export function parseDateToken(raw: string, today: Date): Span | null {
  const token = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const year = today.getFullYear();
  if (token === "now" || token === "today") {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { start: d, end: d, day: true };
  }
  let m = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = parseISO(token);
    return isValid(d) ? { start: d, end: d, day: true } : null;
  }
  m = token.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return isValid(d) && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { start: d, end: endOfMonth(d), day: false } : null;
  }
  m = token.match(/^(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[1]), 0, 1);
    return { start: d, end: endOfYear(d), day: false };
  }
  m = token.match(/^q([1-4])(?: (\d{4}))?$/);
  if (m) {
    const d = startOfQuarter(new Date(m[2] ? Number(m[2]) : year, (Number(m[1]) - 1) * 3, 1));
    return { start: d, end: endOfQuarter(d), day: false };
  }
  // "12 sep", "sep 12", "sep 12 2026", "12 sep 2026", "sep", "sep 2026"
  m = token.match(new RegExp(`^(?:(\\d{1,2}) )?(${MONTH_RE})(?: (\\d{1,2})(?:st|nd|rd|th)?)?(?:,? (\\d{4}))?$`));
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi < 0) return null;
    const y = m[4] ? Number(m[4]) : year;
    const day = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : null;
    if (day !== null) {
      const d = new Date(y, mi, day);
      if (d.getMonth() !== mi) return null; // e.g. Feb 30
      return { start: d, end: d, day: true };
    }
    const d = new Date(y, mi, 1);
    return { start: d, end: endOfMonth(d), day: false };
  }
  return null;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Parse the text form. Lines that are not entries, groups or notes are reported, never thrown. */
export function parseTimelineText(text: string, today = new Date()): ParseResult {
  const entries: ParsedLine[] = [];
  const errors: ParseError[] = [];
  let group: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (END_GROUP_RE.test(line)) {
      group = undefined;
      continue;
    }
    const g = line.match(GROUP_RE);
    if (g) {
      group = (g[1] ?? g[2]).trim() || undefined;
      continue;
    }
    if (line.startsWith(">")) {
      const last = entries[entries.length - 1];
      const note = line.replace(/^>\s?/, "");
      if (!last) errors.push({ line: i + 1, text: raw, reason: "A note line must follow an entry." });
      else last.entry.note = last.entry.note ? `${last.entry.note}\n${note}` : note;
      continue;
    }
    const m = line.match(LINE_RE);
    if (!m) {
      errors.push({ line: i + 1, text: raw, reason: "Start with a date, like 2026-09-12 or Sep 12." });
      continue;
    }
    const a = parseDateToken(m[1], today);
    if (!a) {
      errors.push({ line: i + 1, text: raw, reason: `Unreadable date "${m[1]}".` });
      continue;
    }
    let b: Span | null = null;
    if (m[2]) {
      b = parseDateToken(m[2], today);
      if (!b) {
        errors.push({ line: i + 1, text: raw, reason: `Unreadable end date "${m[2]}".` });
        continue;
      }
      // "Nov – Feb" without years means the end is next year.
      if (b.end < a.start && !/\d{4}/.test(m[2])) b = { start: addYears(b.start, 1), end: addYears(b.end, 1), day: b.day };
    }
    let rest = m[3].trim();
    const entry: ParsedLine["entry"] = { title: "", start: ymd(a.start) };
    if (b) entry.end = ymd(b.end);
    else if (!a.day) entry.end = ymd(a.end);

    if (/^(!|◆|★)\s*/.test(rest)) {
      entry.kind = "milestone";
      rest = rest.replace(/^(!|◆|★)\s*/, "");
    }
    const box = rest.match(/^\[([ xX~>])\]\s*/);
    if (box) {
      entry.status = box[1] === " " ? "planned" : box[1].toLowerCase() === "x" ? "done" : "active";
      rest = rest.slice(box[0].length);
    }
    const link = rest.match(LINK_RE);
    if (link) {
      entry.link = link[1].trim();
      rest = rest.replace(LINK_RE, " ");
    }
    const tags: string[] = [];
    rest = rest.replace(TAG_RE, (_m, sp: string, tag: string) => {
      tags.push(tag);
      return sp ? " " : "";
    });
    for (const tag of tags) {
      const low = tag.toLowerCase();
      if (low === "milestone") entry.kind = "milestone";
      else if (STATUS_TAGS[low]) entry.status = STATUS_TAGS[low];
      else if (!entry.group) entry.group = tag.replace(/[-_]+/g, " ");
    }
    if (!entry.group && group) entry.group = group;
    entry.title = rest.replace(/\s{2,}/g, " ").trim();
    if (!entry.title) entry.title = entry.link ?? "Untitled";
    entries.push({ line: i + 1, entry });
  }
  return { entries, errors };
}

/** The text form of a set of entries, grouped, in date order. Round-trips through parseTimelineText. */
export function timelineToText(entries: TimelineEntry[]): string {
  const sorted = [...entries].sort((x, y) => x.start.localeCompare(y.start) || x.title.localeCompare(y.title));
  // null stands for "no group": JS sorts undefined to the end without asking.
  const groups: (string | null)[] = [];
  for (const e of sorted) if (!groups.includes(e.group ?? null)) groups.push(e.group ?? null);
  // Ungrouped entries first so they never inherit a heading.
  groups.sort((x, y) => (x === null ? -1 : y === null ? 1 : 0));
  const out: string[] = [];
  for (const g of groups) {
    if (g) {
      if (out.length) out.push("");
      out.push(`## ${g}`);
    }
    for (const e of sorted.filter((x) => (x.group ?? null) === g)) {
      let line = e.end ? `${e.start} / ${e.end}: ` : `${e.start}: `;
      if (e.kind === "milestone") line += "!";
      line += e.title;
      if (e.status) line += ` #${e.status}`;
      if (e.link) line += ` [[${e.link}]]`;
      out.push(line);
      if (e.note) for (const n of e.note.split(/\r?\n/)) out.push(`> ${n}`);
    }
  }
  return out.join("\n");
}

/** One line in the text form, for the quick-add box. */
export function parseEntryLine(line: string, today = new Date()) {
  const r = parseTimelineText(line, today);
  return r.entries[0]?.entry ?? null;
}
