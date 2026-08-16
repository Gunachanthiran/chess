import { useState } from 'react';
import { formatEval } from '../../lib/evaluation';
import type { MoveAnalysis, Side, TopMove } from '../../types';

type RecommendationsPanelProps = {
  /** The move about to be played from the position currently on the board —
   * `null` at the final position (nothing left to recommend a line for) or
   * before any moves exist. */
  upcomingMove: MoveAnalysis | null;
};

const WHITE_FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const BLACK_FIGURINES: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

/** `Nd3` -> `♘d3` (white to move) / `♞d3` (black) — pawn moves and castling
 * (`O-O`) have no leading piece letter and pass through unchanged. */
function toFigurine(san: string, side: Side): string {
  const letter = san[0];
  const glyph = (side === 'white' ? WHITE_FIGURINES : BLACK_FIGURINES)[letter];
  return glyph ? glyph + san.slice(1) : san;
}

/**
 * A line of SAN moves to move-numbered figurine text: `1. ♘f3 d5 2. ♗g2 ♞f6`.
 * `startSide` is the side to move in the position this line starts from —
 * usually white, but a line can start on black's move, which needs its own
 * leading `N...` marker (algebraic notation convention for "black to move
 * here") instead of a plain move number.
 */
function formatLine(sans: string[], startMoveNumber: number, startSide: Side): string {
  const tokens: string[] = [];
  let moveNumber = startMoveNumber;
  let side = startSide;

  sans.forEach((san, index) => {
    const figurine = toFigurine(san, side);
    if (side === 'white') {
      tokens.push(`${moveNumber}.`, figurine);
    } else {
      if (index === 0) tokens.push(`${moveNumber}...`);
      tokens.push(figurine);
      moveNumber += 1;
    }
    side = side === 'white' ? 'black' : 'white';
  });

  return tokens.join(' ');
}

/** `cp`/`mate` are White-POV; the panel reads from the mover's own side. */
function moverEval(candidate: TopMove, side: Side): string {
  const cp = candidate.cp === null ? null : side === 'white' ? candidate.cp : -candidate.cp;
  const mate = candidate.mate === null ? null : side === 'white' ? candidate.mate : -candidate.mate;
  return formatEval({ cp, mate });
}

/** Plies shown before the line collapses behind a "show more" toggle. */
const PREVIEW_PLIES = 6;

function CandidateLine({
  candidate,
  upcomingMove,
}: {
  candidate: TopMove;
  upcomingMove: MoveAnalysis;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = candidate.sans.length > PREVIEW_PLIES;
  const shown = expanded ? candidate.sans : candidate.sans.slice(0, PREVIEW_PLIES);

  const text = formatLine(shown, upcomingMove.move_number, upcomingMove.side);
  const evalLabel = moverEval(candidate, upcomingMove.side);

  return (
    <li className="recommendations__row">
      <span className="recommendations__eval">{evalLabel}</span>
      <span className="recommendations__line">
        {text}
        {canExpand && !expanded && '…'}
      </span>
      {canExpand && (
        <button
          type="button"
          className="recommendations__toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Show fewer moves' : 'Show more moves'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      )}
    </li>
  );
}

/**
 * Stockfish's own ranked candidate lines for the position currently on the
 * board — the same `top_moves` data `analyze_game.py` already computed
 * alongside every move's classification, at no extra engine cost (see
 * `engine_pool.py`'s `ANALYSIS_MULTIPV`/`PV_DISPLAY_PLIES`: the engine
 * already searches each candidate's whole continuation to score it, so
 * reading further into that line than just its first move is free). Hidden
 * entirely rather than shown empty for games analysed before this existed
 * (`top_moves: null`) or once play has reached the final recorded position.
 */
export function RecommendationsPanel({ upcomingMove }: RecommendationsPanelProps) {
  if (!upcomingMove?.top_moves || upcomingMove.top_moves.length === 0) return null;

  return (
    <div className="panel recommendations">
      <div className="panel__header">Stockfish recommends</div>
      <ol className="recommendations__list">
        {upcomingMove.top_moves.map((candidate, index) => (
          // Index as key is deliberate: two candidate lines can share a SAN
          // prefix (a shared best move with divergent follow-ups), so there
          // is no piece of the data itself that is a stable, unique identity
          // — the array's own position is the only one available.
          <CandidateLine key={index} candidate={candidate} upcomingMove={upcomingMove} />
        ))}
      </ol>
    </div>
  );
}
