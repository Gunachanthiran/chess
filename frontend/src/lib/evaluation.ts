import type { MoveAnalysis } from '../types';

/**
 * A position evaluation from White's point of view. Exactly one of `cp` / `mate`
 * is normally set; both null means "engine gave us nothing here".
 */
export type PositionEval = {
  cp: number | null;
  mate: number | null;
};

/** Evaluations are clamped to +-10 pawns for display purposes. */
export const EVAL_CLAMP_PAWNS = 10;

/**
 * Evaluation at a navigation index, where index 0 is the starting position and
 * index N is the position after N plies.
 *
 * Index 0 reads `eval_cp_before` of the first move; index N reads
 * `eval_cp_after` of move N-1. This keeps the eval bar in lockstep with
 * `currentMoveIndex` using the same indexing rule as the board.
 */
export function evalAtIndex(moves: MoveAnalysis[], index: number): PositionEval {
  if (moves.length === 0) return { cp: null, mate: null };

  if (index <= 0) {
    const first = moves[0];
    return { cp: first.eval_cp_before, mate: first.mate_before };
  }

  const move = moves[Math.min(index, moves.length) - 1];
  return { cp: move.eval_cp_after, mate: move.mate_after };
}

/**
 * Maps an evaluation to White's share of the bar (0-100).
 *
 * Uses the logistic win-probability curve rather than a linear centipawn scale:
 * a linear bar spends most of its travel in positions that are already
 * resigned, whereas this keeps the visually useful resolution around equality.
 */
export function evalToWhitePercent(evaluation: PositionEval): number {
  if (evaluation.mate !== null) {
    if (evaluation.mate > 0) return 100;
    if (evaluation.mate < 0) return 0;
    return 50;
  }
  if (evaluation.cp === null) return 50;

  const clamped = clampCp(evaluation.cp);
  const winProbability = 2 / (1 + Math.exp(-0.004 * clamped)) - 1;
  return Math.max(0, Math.min(100, 50 + 50 * winProbability));
}

/** Clamps centipawns to the +-10 pawn display window. */
export function clampCp(cp: number): number {
  const limit = EVAL_CLAMP_PAWNS * 100;
  return Math.max(-limit, Math.min(limit, cp));
}

/** Clamped pawn value used as the y-axis of the eval graph. */
export function evalToClampedPawns(evaluation: PositionEval): number {
  if (evaluation.mate !== null) {
    if (evaluation.mate > 0) return EVAL_CLAMP_PAWNS;
    if (evaluation.mate < 0) return -EVAL_CLAMP_PAWNS;
    return 0;
  }
  if (evaluation.cp === null) return 0;
  return clampCp(evaluation.cp) / 100;
}

/**
 * Short label shown on the eval bar: `M3` / `M-5` for forced mates, otherwise a
 * signed pawn score such as `+1.4`.
 */
export function formatEval(evaluation: PositionEval): string {
  if (evaluation.mate !== null) return `M${evaluation.mate}`;
  if (evaluation.cp === null) return '--';

  const pawns = evaluation.cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '-' : '';
  return `${sign}${Math.abs(pawns).toFixed(Math.abs(pawns) >= 10 ? 1 : 2)}`;
}
