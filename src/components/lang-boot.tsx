"use client";
import { useEffect } from "react";
import { bootLang, primeLang, type Lang } from "@/lib/i18n";

/**
 * Renders first inside the providers: primes the language the server used so
 * hydration matches, then reconciles with localStorage after mount.
 */
export function LangBoot({ initial }: { initial: Lang }) {
  primeLang(initial);
  useEffect(() => {
    bootLang();
  }, []);
  return null;
}
