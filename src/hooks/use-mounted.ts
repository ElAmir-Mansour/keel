"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True after hydration; false during SSR and the first client render. */
export function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
