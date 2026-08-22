import { useState } from 'react';
import { formatEval } from '../../lib/evaluation';
import { PIECE_GLYPHS } from '../../lib/pieceGlyphs';
import type { MoveAnalysis, Side, TopMove } from '../../types';

type RecommendationsPanelProps = {
  /** The move about to be played from the position currently on the board —
   * `null` at the final position (nothing left to recommend a line for) or
   * before any moves exist. */
  upcomingMove: MoveAnalysis | null;
  /** Starts stepping a candidate's SAN line out on the board as a
   * hypothetical, without touching the real game's own move index. Omitted
   * (no button rendered) when the caller has no board to preview onto. */
  onPreview?: (sans: string[], candidateIndex: number) => void;
  /** Which candidate row is currently the active preview, or `null`/omitted
   * when none is. */
  previewCandidateIndex?: number | null;
  /** How many plies of the active candidate's line have been played —
   * `0` is the real position (nothing from the line played yet). */
  previewStep?: number;
  onStepPreview?: (delta: number) => void;
  onClosePreview?: () => void;
};

/** `Nd3` -> `♘d3` (white to move) / `♞d3` (black) — pawn moves and castling
 * (`O-O`) have no leading piece letter and pass through unchanged. */
function toFigurine(san: string, side: Side): string {
  const letter = san[0];
  const glyph = (PIECE_GLYPHS[side] as Record<string, string>)[letter];
  return glyph ? glyph + san.slice(1) : san;
}

type LineToken = {
  text: string;
  /** The 0-based index into the candidate's `sans` this token IS the move
   * for, or `null` for a move-number/ellipsis marker token. */
  moveIndex: number | null;
};

/**
 * A line of SAN moves to move-numbered figurine tokens: `1.` `♘f3` `d5` `2.`
 * `♗g2` `♞f6` ... — kept as separate tokens (rather than one joined string)
 * so the active preview can highlight exactly which move `previewStep`
 * currently sits on. `startSide` is the side to move in the position this
 * line starts from — usually white, but a line can start on black's move,
 * which needs its own leading `N...` marker (algebraic notation convention
 * for "black to move here") instead of a plain move number.
 */
function formatLineTokens(sans: string[], startMoveNumber: number, startSide: Side): LineToken[] {
  const tokens: LineToken[] = [];
  let moveNumber = startMoveNumber;
  let side = startSide;

  sans.forEach((san, index) => {
    const figurine = toFigurine(san, side);
    if (side === 'white') {
      tokens.push({ text: `${moveNumber}.`, moveIndex: null });
      tokens.push({ text: figurine, moveIndex: index });
    } else {
      if (index === 0) tokens.push({ text: `${moveNumber}...`, moveIndex: null });
      tokens.push({ text: figurine, moveIndex: index });
      moveNumber += 1;
    }
    side = side === 'white' ? 'black' : 'white';
  });

  return tokens;
}

/** `cp`/`mate` are White-POV; the panel reads from the mover's own side. */
function moverEval(candidate: TopMove, side: Side): string {
  const cp = candidate.cp === null ? null : side === 'white' ? candidate.cp : -candidate.cp;
  const mate = candidate.mate === null ? null : side === 'white' ? candidate.mate : -candidate.mate;
  return formatEval({ cp, mate });
}

/** Plies shown before the line collapses behind a "show more" toggle — the
 * active preview always shows the full line regardless (stepping past ply 10
 * with the rest hidden would be confusing). */
const PREVIEW_PLIES = 10;

function CandidateLine({
  candidate,
  index,
  upcomingMove,
  onPreview,
  isActive,
  previewStep,
  onStepPreview,
  onClosePreview,
}: {
  candidate: TopMove;
  index: number;
  upcomingMove: MoveAnalysis;
  onPreview?: (sans: string[], candidateIndex: number) => void;
  isActive: boolean;
  previewStep: number;
  onStepPreview?: (delta: number) => void;
  onClosePreview?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = candidate.sans.length > PREVIEW_PLIES;
  const showFull = expanded || isActive;
  const shown = showFull ? candidate.sans : candidate.sans.slice(0, PREVIEW_PLIES);

  const tokens = formatLineTokens(shown, upcomingMove.move_number, upcomingMove.side);
  const evalLabel = moverEval(candidate, upcomingMove.side);
  // The move just "played" to reach `previewStep` — e.g. previewStep 1 means
  // sans[0] has been played, so that's the token to highlight.
  const currentMoveIndex = previewStep - 1;

  return (
    <li className={`recommendations__row${isActive ? ' recommendations__row--active' : ''}`}>
      <span className="recommendations__eval">{evalLabel}</span>
      <span className="recommendations__line">
        {tokens.map((token, tokenIndex) => (
          <span
            key={tokenIndex}
            className={
              isActive && token.moveIndex === currentMoveIndex
                ? 'recommendations__move recommendations__move--current'
                : 'recommendations__move'
            }
          >
            {token.text}{' '}
          </span>
        ))}
        {canExpand && !showFull && '…'}
      </span>
      {isActive && onStepPreview ? (
        <div className="recommendations__stepper">
          <button
            type="button"
            onClick={() => onStepPreview(-1)}
            disabled={previewStep <= 0}
            title="Step back one move"
            aria-label="Step back one move"
          >
            ◀
          </button>
          <span className="recommendations__step-count">
            {previewStep}/{candidate.sans.length}
          </span>
          <button
            type="button"
            onClick={() => onStepPreview(1)}
            disabled={previewStep >= candidate.sans.length}
            title="Step forward one move"
            aria-label="Step forward one move"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={onClosePreview}
            title="Stop previewing this line"
            aria-label="Stop previewing this line"
          >
            ✕
          </button>
        </div>
      ) : (
        onPreview && (
          <button
            type="button"
            className="recommendations__play"
            onClick={() => onPreview(candidate.sans, index)}
            title="Step through this line on the board"
            aria-label="Step through this line on the board"
          >
            ▶
          </button>
        )
      )}
      {canExpand && !isActive && (
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
export function RecommendationsPanel({
  upcomingMove,
  onPreview,
  previewCandidateIndex = null,
  previewStep = 0,
  onStepPreview,
  onClosePreview,
}: RecommendationsPanelProps) {
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
          <CandidateLine
            key={index}
            candidate={candidate}
            index={index}
            upcomingMove={upcomingMove}
            onPreview={onPreview}
            isActive={previewCandidateIndex === index}
            previewStep={previewStep}
            onStepPreview={onStepPreview}
            onClosePreview={onClosePreview}
          />
        ))}
      </ol>
    </div>
  );
}
