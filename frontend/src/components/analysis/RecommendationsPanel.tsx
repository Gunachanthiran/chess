import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { formatEval } from '../../lib/evaluation';
import type { MoveAnalysis, Side, TopMove } from '../../types';

type RecommendationsPanelProps = {
  /** The move about to be played from the position currently on the board —
   * `null` at the final position (nothing left to recommend a move for) or
   * before any moves exist. */
  upcomingMove: MoveAnalysis | null;
};

/** UCI (`e7e8q`) to SAN (`e8=Q`) for one candidate, given the position it's played from. */
function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
    return chess.move({ from, to, promotion })?.san ?? null;
  } catch {
    return null;
  }
}

/** `cp`/`mate` are White-POV; the panel reads from the mover's own side. */
function moverEval(candidate: TopMove, side: Side): string {
  const cp = candidate.cp === null ? null : side === 'white' ? candidate.cp : -candidate.cp;
  const mate = candidate.mate === null ? null : side === 'white' ? candidate.mate : -candidate.mate;
  return formatEval({ cp, mate });
}

/**
 * Stockfish's own ranked candidate moves for the position currently on the
 * board — the same `top_moves` data `analyze_game.py` already computed
 * alongside every move's classification, at no extra engine cost (see
 * `engine_pool.py`'s `ANALYSIS_MULTIPV`). Hidden entirely rather than shown
 * empty for games analysed before this existed (`top_moves: null`) or once
 * play has reached the final recorded position.
 */
export function RecommendationsPanel({ upcomingMove }: RecommendationsPanelProps) {
  const candidates = useMemo(() => {
    if (!upcomingMove?.top_moves) return null;
    return upcomingMove.top_moves
      .map((candidate) => ({
        san: uciToSan(upcomingMove.fen_before, candidate.uci),
        evalLabel: moverEval(candidate, upcomingMove.side),
      }))
      .filter((candidate): candidate is { san: string; evalLabel: string } => candidate.san !== null);
  }, [upcomingMove]);

  if (!candidates || candidates.length === 0) return null;

  return (
    <div className="panel recommendations">
      <div className="panel__header">Stockfish recommends</div>
      <ol className="recommendations__list">
        {candidates.map((candidate, index) => (
          <li key={candidate.san} className="recommendations__row">
            <span className="recommendations__rank">{index + 1}</span>
            <span className="recommendations__san">{candidate.san}</span>
            <span className="recommendations__eval">{candidate.evalLabel}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
