import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { MoveAnalysis } from '../types';

export type GameNavigation = {
  /** 0 = starting position, N = position after N plies. Sole source of truth. */
  currentMoveIndex: number;
  setCurrentMoveIndex: (index: number) => void;
  /** FEN derived from `currentMoveIndex`. Never stored, always recomputed. */
  displayFen: string;
  /** UCI of the move that produced the current position, for board highlights. */
  lastMoveUci: string | null;
  goToStart: () => void;
  goToEnd: () => void;
  goToPrev: () => void;
  goToNext: () => void;
};

/**
 * Replays `moves[0..count-1]` on a fresh board and returns the resulting FEN.
 *
 * The starting position comes from `moves[0].fen_before` so games that begin
 * from a custom FEN still replay correctly; standard games fall back to the
 * chess.js default.
 */
function buildFen(moves: MoveAnalysis[], count: number): string {
  const startFen = moves[0]?.fen_before;
  const chess = startFen ? new Chess(startFen) : new Chess();

  const limit = Math.min(count, moves.length);
  for (let i = 0; i < limit; i += 1) {
    const move = moves[i];
    try {
      // UCI is the canonical form: `e2e4`, or `e7e8q` when promoting.
      const promotion = move.uci.length > 4 ? move.uci.slice(4, 5) : undefined;
      chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion });
    } catch {
      try {
        chess.move(move.san);
      } catch {
        // Replay broke (malformed move data). Rather than render a position that
        // silently disagrees with `currentMoveIndex`, fall back to the engine's
        // own recorded FEN for the target position and stop replaying.
        console.warn(
          `[useGameNavigation] could not replay ply ${move.ply} (${move.san} / ${move.uci});` +
            ' falling back to the recorded FEN.',
        );
        return moves[limit]?.fen_before ?? chess.fen();
      }
    }
  }

  return chess.fen();
}

/**
 * Owns board navigation for an analysed game.
 *
 * The critical invariant: `displayFen` is *derived* from `currentMoveIndex` via
 * a full replay, never stored per move. Any navigation path — prev/next,
 * clicking a move row, clicking the eval graph, arrow keys — can only move the
 * index, so the board is structurally incapable of showing a position that
 * disagrees with the selected move.
 */
export function useGameNavigation(moves: MoveAnalysis[]): GameNavigation {
  const [currentMoveIndex, setCurrentMoveIndexRaw] = useState(0);

  const maxIndex = moves.length;

  const setCurrentMoveIndex = useCallback(
    (index: number) => {
      setCurrentMoveIndexRaw(Math.max(0, Math.min(maxIndex, Math.round(index))));
    },
    [maxIndex],
  );

  const displayFen = useMemo(
    () => buildFen(moves, currentMoveIndex),
    [moves, currentMoveIndex],
  );

  const lastMoveUci = currentMoveIndex > 0 ? (moves[currentMoveIndex - 1]?.uci ?? null) : null;

  const goToStart = useCallback(() => setCurrentMoveIndexRaw(0), []);
  const goToEnd = useCallback(() => setCurrentMoveIndexRaw(maxIndex), [maxIndex]);
  const goToPrev = useCallback(
    () => setCurrentMoveIndexRaw((index) => Math.max(0, index - 1)),
    [],
  );
  const goToNext = useCallback(
    () => setCurrentMoveIndexRaw((index) => Math.min(maxIndex, index + 1)),
    [maxIndex],
  );

  return {
    currentMoveIndex,
    setCurrentMoveIndex,
    displayFen,
    lastMoveUci,
    goToStart,
    goToEnd,
    goToPrev,
    goToNext,
  };
}
