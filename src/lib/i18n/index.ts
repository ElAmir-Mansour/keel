"use client";
import { useSyncExternalStore } from "react";
import { ar } from "./ar";

// Gettext-style localisation: the English string is the key, so the code
// stays readable and a missing translation degrades to English rather than
// to a key. Arabic strings live in src/lib/i18n/ar/*.ts by area.

export type Lang = "en" | "ar";
const KEY = "keel.lang";

let lang: Lang = "en";
/** What the server rendered with; the hydration snapshot must match it. */
let serverLang: Lang = "en";
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

/**
 * Called during the first client render with the language the server used
 * (from the cookie), before any translated text renders, so server HTML and
 * hydration agree. Idempotent.
 */
export function primeLang(initial: Lang) {
  serverLang = initial;
  lang = initial;
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(KEY, next);
    document.cookie = `${KEY}=${next}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* private mode */
  }
  applyToDocument();
  for (const l of listeners) l();
}

export function applyToDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function bootLang() {
  // The cookie is the source of truth once set; localStorage covers a browser
  // that lost the cookie but kept storage.
  const stored = read();
  if (stored !== lang) {
    setLang(stored);
    return;
  }
  applyToDocument();
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lang,
    () => serverLang,
  );
}

export const isRTL = () => lang === "ar";

/** Translate, with {name} placeholders. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const base = lang === "ar" ? (ar[text] ?? text) : text;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Hook form: re-renders when the language changes. */
export function useT() {
  useLang();
  return t;
}

/** Locale-aware number formatting (Arabic keeps Western digits for issue keys). */
export function fmtNumber(n: number) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en").format(n);
}
