import { useCallback, useSyncExternalStore } from 'react';

/** Site-wide colour scheme. `light` is the white-and-gold theme. */
export type ColorScheme = 'dark' | 'light';

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  dark: 'Dark',
  light: 'Light & Gold',
};

const STORAGE_KEY = 'chessscope.color-scheme';
const DEFAULT_SCHEME: ColorScheme = 'dark';

function isColorScheme(value: string | null): value is ColorScheme {
  return value === 'dark' || value === 'light';
}

function readScheme(): ColorScheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isColorScheme(stored) ? stored : DEFAULT_SCHEME;
  } catch {
    // Private mode / storage disabled — fall back to the default.
    return DEFAULT_SCHEME;
  }
}

function writeScheme(scheme: ColorScheme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

/** Applies `[data-theme]` to `<html>`, which every CSS override in
 * `index.css` keys off. Kept as a plain DOM write rather than something React
 * renders, since it must affect the document root — the one element outside
 * the app's own render tree. */
function applyToDocument(scheme: ColorScheme): void {
  document.documentElement.setAttribute('data-theme', scheme);
}

/*
 * Same shape as `boardTheme.ts`'s store: a module-level value plus
 * `useSyncExternalStore`, so every consumer (the toggle in `App.tsx`'s
 * header, and any future page that wants to know the current scheme) reads
 * the same value with no provider to thread through, and a write from one
 * component repaints everywhere immediately.
 */

let currentScheme: ColorScheme | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ColorScheme {
  if (currentScheme === null) {
    currentScheme = readScheme();
    applyToDocument(currentScheme); // First read also has to paint the document.
  }
  return currentScheme;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Keeps a second tab in step, exactly like `boardTheme.ts`.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const next = readScheme();
    if (next === currentScheme) return;
    currentScheme = next;
    applyToDocument(next);
    emit();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export type ColorSchemeHook = {
  scheme: ColorScheme;
  setScheme: (scheme: ColorScheme) => void;
  toggleScheme: () => void;
};

/** Owns the site-wide light/dark preference — see `boardTheme.ts`, this is
 * the identical pattern one level up (the whole app's palette, not just the
 * board's square colours). */
export function useColorScheme(): ColorSchemeHook {
  const scheme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setScheme = useCallback((next: ColorScheme) => {
    if (next === currentScheme) return;
    currentScheme = next;
    applyToDocument(next);
    writeScheme(next);
    emit();
  }, []);

  const toggleScheme = useCallback(() => {
    setScheme(currentScheme === 'light' ? 'dark' : 'light');
  }, [setScheme]);

  return { scheme, setScheme, toggleScheme };
}
