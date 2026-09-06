import { useCallback, useSyncExternalStore } from 'react';
import type { PieceRenderObject } from 'react-chessboard';
import { LINE_ART_PIECES } from './pieceSets/lineArt';
import { ROMAN_LUXURY_PIECES } from './pieceSets/romanLuxury';
import { THREE_D_PIECES } from './pieceSets/three3d';
import { useWebglSupported } from './pieceSets/three3d/webglSupport';

/** Selectable piece art styles. */
export type PieceSet = 'classic' | 'line' | 'romanLuxury' | 'three3d';

export type PieceSetInfo = {
  label: string;
  /** `undefined` means "use react-chessboard's own built-in set" — passing
   * that straight through as `options.pieces` falls back to its default. */
  pieces: PieceRenderObject | undefined;
};

export const PIECE_SETS: Record<PieceSet, PieceSetInfo> = {
  classic: { label: 'Classic', pieces: undefined },
  // Internal key stays `line` (existing `localStorage` values already use
  // it, and it's what `lineArt.tsx`'s own file/export names refer to) — only
  // the label changed, to match what the set actually looks like now.
  line: { label: 'Roman', pieces: LINE_ART_PIECES },
  romanLuxury: { label: 'Roman (Photo)', pieces: ROMAN_LUXURY_PIECES },
  three3d: { label: '3D', pieces: THREE_D_PIECES },
};

export const PIECE_SET_ORDER: PieceSet[] = ['classic', 'line', 'romanLuxury', 'three3d'];

const PIECE_SET_STORAGE_KEY = 'chessscope.board.pieceSet';
// The Roman-themed set is the one actually designed for this app (every
// other piece here is hand-authored for ChessScope); `defaultPieces`
// (`classic`) is `react-chessboard`'s own bundled cburnett-style art, kept
// only as a fallback for whoever prefers the familiar look.
const DEFAULT_PIECE_SET: PieceSet = 'line';

function isPieceSet(value: string | null): value is PieceSet {
  return value !== null && Object.prototype.hasOwnProperty.call(PIECE_SETS, value);
}

function readPieceSet(): PieceSet {
  try {
    const stored = window.localStorage.getItem(PIECE_SET_STORAGE_KEY);
    return isPieceSet(stored) ? stored : DEFAULT_PIECE_SET;
  } catch {
    return DEFAULT_PIECE_SET;
  }
}

function writePieceSet(pieceSet: PieceSet): void {
  try {
    window.localStorage.setItem(PIECE_SET_STORAGE_KEY, pieceSet);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

/*
 * Same tiny module-level store shape as `boardTheme.ts` — see that file's
 * comment for why: two independent boards need to repaint together on a
 * write from either one's picker, with no provider to thread through.
 */
let currentPieceSet: PieceSet | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): PieceSet {
  if (currentPieceSet === null) currentPieceSet = readPieceSet();
  return currentPieceSet;
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== PIECE_SET_STORAGE_KEY) return;
    const next = readPieceSet();
    if (next === currentPieceSet) return;
    currentPieceSet = next;
    emit();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export type PieceSetHook = {
  pieceSet: PieceSet;
  pieces: PieceRenderObject | undefined;
  setPieceSet: (pieceSet: PieceSet) => void;
};

/** Owns the site-wide piece-art preference, same pattern as `useBoardTheme`. */
export function usePieceSet(): PieceSetHook {
  const pieceSet = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const webglSupported = useWebglSupported();

  const setPieceSet = useCallback((next: PieceSet) => {
    if (next === currentPieceSet) return;
    currentPieceSet = next;
    writePieceSet(next);
    emit();
  }, []);

  // A stored '3D' preference on a browser/session that can't actually run it
  // (no WebGL, or a context was lost after the picker already offered it)
  // renders as 'line' instead — silently, and without touching the stored
  // preference, so it resumes on its own wherever 3D does work again.
  const effectiveSet = pieceSet === 'three3d' && !webglSupported ? 'line' : pieceSet;

  return { pieceSet, pieces: PIECE_SETS[effectiveSet].pieces, setPieceSet };
}
