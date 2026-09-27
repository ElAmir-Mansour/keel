// RFC 4180 parser: quoted fields, doubled quotes, embedded newlines, CRLF.

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Rows as objects keyed by a normalised header (lower case, spaces collapsed). */
export function csvRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCSV(text);
  if (!head) return { headers: [], rows: [] };
  const headers = head.map(normHeader);
  const rows = body.map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? "").trim();
    });
    return o;
  });
  return { headers, rows };
}

export function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** First present, non-empty value among alternative column names. */
export function pick(row: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = row[normHeader(n)];
    if (v) return v;
  }
  return "";
}
