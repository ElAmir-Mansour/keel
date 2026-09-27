"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Filter state kept in the URL so a filtered view is linkable and survives a
 * reload. Writes go through history.replaceState, which Next's router picks
 * up without a navigation, so typing in a search box stays cheap.
 *
 * `keys` must be a module-level constant: it is a dependency of the memo.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const sp = useSearchParams();
  const pathname = usePathname();

  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) out[k] = sp.get(k) ?? "";
    return out;
  }, [sp, keys]);

  const set = useCallback(
    (patch: Partial<Record<K, string>>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, String(v));
        else next.delete(k);
      }
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  return [values, set] as const;
}
