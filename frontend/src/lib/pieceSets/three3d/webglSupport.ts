import { useSyncExternalStore } from 'react';

/**
 * Whether the 3D piece set can actually render here. Because every piece
 * shares one `<canvas>` (see `PieceCanvasRoot.tsx`), a WebGL failure is a
 * single event affecting the whole set at once — there's no per-piece
 * fallback to reach for, so this is one flag, not one per piece.
 *
 * Same lazy-init + module-level `subscribe/emit` shape as `pieceSet.ts`'s
 * own store, for the same reason: `usePieceSet()` needs to react to this
 * changing (a context-loss event after the picker already offered "3D")
 * without a provider to thread through.
 */

let supported: boolean | null = null;
const listeners = new Set<() => void>();

function probe(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Call once, from `PieceCanvasRoot`, after a real context is lost or fails
 * to be created post-mount — the rarer case the upfront probe can't catch. */
export function reportWebglUnavailable(): void {
  if (supported === false) return;
  supported = false;
  emit();
}

function getSnapshot(): boolean {
  if (supported === null) supported = probe();
  return supported;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWebglSupported(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Non-hook read, for the one call site (`pieceSet.ts`) that needs this
 * outside a component render — same read path, just not subscribed. */
export function isWebglSupported(): boolean {
  return getSnapshot();
}
