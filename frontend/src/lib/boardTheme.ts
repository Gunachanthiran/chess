import { useCallback, useSyncExternalStore } from 'react';

/** Selectable board colour schemes. */
export type BoardTheme = 'classic' | 'green' | 'blue' | 'purple';

export type BoardThemeColors = {
  /** Human-readable name, used for the picker's labels and tooltips. */
  label: string;
  light: string;
  dark: string;
};

export const BOARD_THEMES: Record<BoardTheme, BoardThemeColors> = {
  classic: { label: 'Classic', light: '#f0d9b5', dark: '#b58863' },
  green: { label: 'Green', light: '#ebecd0', dark: '#739552' },
  blue: { label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  purple: { label: 'Purple', light: '#e8d9f0', dark: '#9b72b0' },
};

/** Display order for the picker — `Object.keys` order is not a contract. */
export const BOARD_THEME_ORDER: BoardTheme[] = ['classic', 'green', 'blue', 'purple'];

const THEME_STORAGE_KEY = 'chessscope.board.theme';

/** Today's colours, so an existing user sees no change until they pick one. */
const DEFAULT_THEME: BoardTheme = 'green';

function isBoardTheme(value: string | null): value is BoardTheme {
  return value !== null && Object.prototype.hasOwnProperty.call(BOARD_THEMES, value);
}

/** Reads the persisted board theme. Falls back to the default when unset or junk. */
function readTheme(): BoardTheme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isBoardTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Private mode / storage disabled — fall back to the default.
    return DEFAULT_THEME;
  }
}

function writeTheme(theme: BoardTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

/*
 * The theme is a single *site-wide* preference, and its two consumers are not
 * in a parent/child relationship: `ChessBoard` reads it, while the picker in
 * each page's controls row writes it. Two independent `useState`s seeded from
 * localStorage — the shape `useSoundEffects` uses, where one component owns
 * both the toggle and the value — would leave the board still painted in the
 * old colours until something else re-rendered it.
 *
 * So the value lives in this tiny module-level store instead, and every
 * consumer subscribes to it via `useSyncExternalStore`. That keeps the
 * localStorage read/write helpers above identical in shape to
 * `useSoundEffects`'s while making a write from any component repaint every
 * board on the page — with no provider to thread through `App.tsx`.
 */

let currentTheme: BoardTheme | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): BoardTheme {
  // Lazy so the first localStorage touch happens during render, not at import.
  if (currentTheme === null) currentTheme = readTheme();
  return currentTheme;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Keeps a second tab in step: `storage` fires in every *other* document that
  // shares the origin, so a change made in one window repaints the boards in
  // the rest without a reload.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = readTheme();
    if (next === currentTheme) return;
    currentTheme = next;
    emit();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export type BoardThemeHook = {
  theme: BoardTheme;
  /** Colours for the active theme, ready to hand to the board. */
  colors: BoardThemeColors;
  setTheme: (theme: BoardTheme) => void;
};

/**
 * Owns the site-wide board-colour preference. Every board and every picker
 * reads the same value, so choosing a theme on the analysis page is already
 * applied when the play-bot page mounts, and vice versa.
 */
export function useBoardTheme(): BoardThemeHook {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setTheme = useCallback((next: BoardTheme) => {
    if (next === currentTheme) return;
    currentTheme = next;
    writeTheme(next);
    emit();
  }, []);

  return { theme, colors: BOARD_THEMES[theme], setTheme };
}
