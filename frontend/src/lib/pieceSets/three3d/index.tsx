import { lazy, Suspense } from 'react';
import type { PieceRenderObject } from 'react-chessboard';
import type { PieceColor, PieceType } from '../../pieceSilhouettes';

/**
 * The real entry point for `pieceSet.ts` — deliberately has no top-level
 * import of `three`/`@react-three/fiber`/`@react-three/drei`. Those are
 * hundreds of KB that every other piece set (and every user who never
 * touches the 3D option) has no reason to download, so both the per-piece
 * view and the shared canvas are behind `React.lazy()` — Vite code-splits
 * each into its own chunk, fetched only the first time either actually
 * renders (i.e. only once someone selects "3D").
 */
const LazyPieceView = lazy(() => import('./PieceView'));

function piece(type: PieceType, color: PieceColor) {
  return () => (
    <Suspense fallback={null}>
      <LazyPieceView type={type} color={color} />
    </Suspense>
  );
}

export const THREE_D_PIECES: PieceRenderObject = {
  wP: piece('p', 'w'),
  bP: piece('p', 'b'),
  wR: piece('r', 'w'),
  bR: piece('r', 'b'),
  wN: piece('n', 'w'),
  bN: piece('n', 'b'),
  wB: piece('b', 'w'),
  bB: piece('b', 'b'),
  wQ: piece('q', 'w'),
  bQ: piece('q', 'b'),
  wK: piece('k', 'w'),
  bK: piece('k', 'b'),
};

export const LazyPieceCanvasRoot = lazy(() =>
  import('./PieceCanvasRoot').then((module) => ({ default: module.PieceCanvasRoot })),
);
