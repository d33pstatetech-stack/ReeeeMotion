import { useCallback, useEffect, useState } from "react";

export const RECENT_PROJECTS_KEY = "remotion-editor-recent-projects";
export const MAX_RECENT = 5;

/**
 * Pure helpers exported so the toolbar's behavior can be unit-tested without
 * booting React. The hook below just wires these into a useState/useEffect.
 */

/** Read the persisted list, ignoring garbage and trimming entries. */
export function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Persist a list (silently swallowing quota / disabled-storage errors). */
export function writeRecents(next: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(next.slice(0, MAX_RECENT)),
    );
  } catch {
    /* quota / disabled localStorage */
  }
}

/** Pure mutation: trim, dedupe, move-to-front, cap to MAX_RECENT. */
export function pushRecent(list: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return list;
  return [trimmed, ...list.filter((n) => n !== trimmed)].slice(0, MAX_RECENT);
}

/** Pure mutation: remove a single entry by exact name. */
export function removeRecent(list: string[], name: string): string[] {
  return list.filter((n) => n !== name);
}

/**
 * Tracks the user's last few project names so the toolbar can offer a quick
 * dropdown of recent titles on the same machine. Persisted to localStorage.
 */
export function useRecentProjects(): {
  recents: string[];
  push: (name: string) => void;
  remove: (name: string) => void;
  clear: () => void;
} {
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  useEffect(() => {
    writeRecents(recents);
  }, [recents]);

  // If another tab edits the same key, reflect it here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECENT_PROJECTS_KEY) setRecents(readRecents());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const push = useCallback((name: string) => {
    setRecents((prev) => pushRecent(prev, name));
  }, []);

  const remove = useCallback((name: string) => {
    setRecents((prev) => removeRecent(prev, name));
  }, []);

  const clear = useCallback(() => setRecents([]), []);

  return { recents, push, remove, clear };
}
