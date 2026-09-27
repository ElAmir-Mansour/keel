import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isValid,
  parseISO,
  startOfDay,
} from "date-fns";

export function nowISO() {
  return new Date().toISOString();
}

export function todayYMD(d: Date = new Date()) {
  return format(d, "yyyy-MM-dd");
}

export function ymd(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function parseYMD(s: string) {
  return startOfDay(parseISO(s));
}

export function fmtDate(s?: string | null, pattern = "d MMM yyyy") {
  if (!s) return "";
  const d = parseISO(s);
  return isValid(d) ? format(d, pattern) : s;
}

export function fmtShort(s?: string | null) {
  return fmtDate(s, "d MMM");
}

export function ago(s?: string | null) {
  if (!s) return "";
  const d = parseISO(s);
  return isValid(d) ? formatDistanceToNowStrict(d, { addSuffix: true }) : "";
}

export function daysUntil(s?: string | null) {
  if (!s) return null;
  return differenceInCalendarDays(parseISO(s), startOfDay(new Date()));
}

export function isOverdue(s?: string | null) {
  const n = daysUntil(s);
  return n !== null && n < 0;
}

export function eachDay(from: Date, to: Date) {
  const out: Date[] = [];
  let d = startOfDay(from);
  const end = startOfDay(to);
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
