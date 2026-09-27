// A small YAML front-matter reader: scalars, inline lists [a, b] and block
// lists "- item". Enough for Obsidian properties; anything stranger is kept
// as a string.

export interface FrontMatter {
  data: Record<string, string | string[]>;
  body: string;
}

export function parseFrontMatter(text: string): FrontMatter {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string | string[]> = {};
  const lines = m[1].split(/\r?\n/);
  let key: string | null = null;
  for (const line of lines) {
    const list = line.match(/^\s*-\s+(.*)$/);
    if (list && key) {
      const cur = data[key];
      data[key] = Array.isArray(cur) ? [...cur, unquote(list[1])] : cur ? [String(cur), unquote(list[1])] : [unquote(list[1])];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const val = kv[2].trim();
    if (!val) {
      data[key] = [];
      continue;
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else {
      data[key] = unquote(val);
    }
  }
  return { data, body: src.slice(m[0].length) };
}

function unquote(v: string) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => x.replace(/^#/, "").trim()).filter(Boolean);
  return v
    .split(/[,\s]+/)
    .map((x) => x.replace(/^#/, "").trim())
    .filter(Boolean);
}
