import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, PieceHandlerArgs } from 'react-chessboard';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import { unlockAudio } from '../../lib/sound';
import { useBoardTheme } from '../../lib/boardTheme';
import type { Classification, LegalMoveTarget } from '../../types';

/** A classification marker to float over one square of the board. */
export type MoveBadge = {
  /** Destination square of the move being marked, e.g. `e4`. */
  square: string;
  classification: Classification;
};

type ChessBoardProps = {
  /** Position to render. Derived upstream from `currentMoveIndex`. */
  displayFen: string;
  /** UCI of the move that produced this position, highlighted on the board. */
  lastMoveUci?: string | null;
  boardOrientation?: 'white' | 'black';
  /**
   * Opt-in drag & drop. Defaults to `false` so the analysis page — which never
   * sets it — stays read-only exactly as before.
   */
  allowDragging?: boolean;
  /**
   * Called when a piece is dropped. Return `true` to accept the drop (the board
   * suppresses the snap-back animation and waits for the next `displayFen`),
   * `false` to reject it. `targetSquare` is `null` when dropped off the board.
   */
  onPieceDrop?: (args: PieceDropHandlerArgs) => boolean;
  /**
   * Legal destinations for a piece the player has just picked up, used to draw
   * the chess.com-style dots and capture rings. Optional and only consulted
   * while `allowDragging` is true, so the read-only analysis board — which
   * passes neither — is completely unaffected.
   *
   * Must be referentially stable (a `useCallback` with no deps), since it is a
   * dependency of the `squareStyles` memo.
   */
  legalMovesFor?: (square: string) => LegalMoveTarget[];
  /**
   * Optional classification marker floated over a single square — the
   * chess.com-style "??" bubble on a blunder's destination. Rendering lives
   * here rather than in the parent because the parent does not know the board's
   * orientation-dependent geometry, and this component does.
   */
  moveBadge?: MoveBadge | null;
};

/*
 * Square colours are *not* props. They are one site-wide preference read
 * straight from `useBoardTheme()` here, so every board in the app — the
 * read-only analysis board and the draggable bot board alike — picks up the
 * same choice with no prop drilling and no change to either page's existing
 * prop contract.
 */
const HIGHLIGHT = 'rgba(255, 213, 79, 0.45)';
/** The square the picked-up piece came from, in the same yellow as a last move. */
const ORIGIN_HIGHLIGHT = 'rgba(255, 213, 79, 0.55)';

/**
 * `react-chessboard` v5 has no per-square marker API beyond `squareRenderer`
 * (which would mean re-implementing the square itself), so the dot and the ring
 * are drawn purely in CSS as background images on the existing `squareStyles`
 * hook. `backgroundImage` — not the `background` shorthand — is deliberate: it
 * composes on top of the `backgroundColor` a last-move highlight may already
 * have put on the same square instead of clobbering it.
 *
 * Radial gradients size to `farthest-corner` by default, so 100% is the corner
 * distance (~70.7% of the square's width), which is what the percentages below
 * are relative to.
 */
// ~28% of the square across — a small centred dot on an empty destination.
const MOVE_DOT =
  'radial-gradient(circle at center, rgba(0, 0, 0, 0.22) 0%, rgba(0, 0, 0, 0.22) 20%, transparent 21%)';
// A thick ring hugging the piece, corners filled — the standard capture cue.
const CAPTURE_RING =
  'radial-gradient(circle at center, transparent 0%, transparent 62%, rgba(0, 0, 0, 0.28) 63%, rgba(0, 0, 0, 0.28) 100%)';

/** Each square is exactly one eighth of the board along both axes. */
const SQUARE_PCT = 100 / 8;

/**
 * Where inside its square the badge's centre sits, in square-widths from the
 * square's top-left corner. Pushed up and to the right so the bubble hugs the
 * top-right corner of the square and leaves the piece underneath readable,
 * which is where chess.com and chessiro put theirs.
 */
const BADGE_ANCHOR_X = 0.82;
const BADGE_ANCHOR_Y = 0.18;

/*
 * The badge's diameter lives in CSS (`.board-badge { width: 4.25% }`), which is
 * 34% of a square — 12.5% * 0.34. It is centred on the anchor point below by a
 * `translate(-50%, -50%)` there rather than by arithmetic here.
 */

/**
 * Converts a square name to its position on the rendered board, expressed as a
 * percentage of the board's width/height.
 *
 * Done from the square's *name* rather than by measuring DOM nodes: measurement
 * would have to be redone on every resize and orientation flip, whereas the
 * file/rank of a square plus the board orientation fully determine where it is
 * drawn. The returned point is the badge's centre, so the caller offsets by
 * half the badge size via a CSS transform.
 *
 * Column/row are counted from the board's top-left as drawn:
 *  - White at the bottom  → a8 is top-left, so column = file index (a=0..h=7)
 *    and row counts down from rank 8 (rank 8 → 0 ... rank 1 → 7).
 *  - Black at the bottom  → the board is rotated 180°, which flips *both* axes:
 *    h1 is top-left, so column = 7 - file index and row counts down from rank 1
 *    (rank 1 → 0 ... rank 8 → 7), i.e. row = rank - 1.
 *
 * Returns null for anything that is not a well-formed square name, so a
 * malformed UCI string drops the badge instead of positioning it at NaN%.
 */
function squareBadgePosition(
  square: string,
  boardOrientation: 'white' | 'black',
): { leftPct: number; topPct: number } | null {
  if (square.length < 2) return null;

  const fileIndex = square.charCodeAt(0) - 'a'.charCodeAt(0); // a=0 ... h=7
  const rankIndex = square.charCodeAt(1) - '1'.charCodeAt(0); // rank 1=0 ... rank 8=7
  if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) return null;

  const flipped = boardOrientation === 'black';
  const column = flipped ? 7 - fileIndex : fileIndex;
  const row = flipped ? rankIndex : 7 - rankIndex;

  return {
    leftPct: (column + BADGE_ANCHOR_X) * SQUARE_PCT,
    topPct: (row + BADGE_ANCHOR_Y) * SQUARE_PCT,
  };
}

/**
 * Presentational board. It renders whatever FEN it is given and owns no game
 * state of its own: even with dragging enabled the piece only *moves* when the
 * parent feeds back a new `displayFen`, so the board can never diverge from the
 * parent's idea of the position.
 */
export function ChessBoard({
  displayFen,
  lastMoveUci = null,
  boardOrientation = 'white',
  allowDragging,
  onPieceDrop,
  legalMovesFor,
  moveBadge = null,
}: ChessBoardProps) {
  // `react-chessboard` drives its animation from the position it was last
  // rendered with. Mirroring the incoming FEN in `useLayoutEffect` (not
  // `useEffect`) means the sync happens after commit but *before* the browser
  // paints, so a navigation jump can never show one frame of the previous
  // position. This is deliberate: a stale-frame flash here is the visible
  // symptom of the board-desync bug class we are designing this page against.
  const [renderedFen, setRenderedFen] = useState(displayFen);

  const { colors } = useBoardTheme();

  // Square a piece is currently being dragged from, or null when nothing is in
  // hand. Purely ephemeral view state: it drives the legal-move markers and
  // nothing else, and is cleared on drop, on drag-cancel, and defensively
  // whenever the position changes underneath us.
  const [dragOrigin, setDragOrigin] = useState<string | null>(null);

  const clearDragOrigin = useCallback(() => {
    // Functional update so a no-op clear does not schedule a render.
    setDragOrigin((current) => (current === null ? current : null));
  }, []);

  useLayoutEffect(() => {
    setRenderedFen(displayFen);
    clearDragOrigin();
  }, [displayFen, clearDragOrigin]);

  const handlePieceDrag = useCallback(({ square }: PieceHandlerArgs) => {
    // Belt-and-braces alongside the app-wide gesture listener in `App.tsx`:
    // picking up a piece is unambiguously a direct, trusted user gesture, so
    // unlocking right here guarantees the move-sound path is never the first
    // thing to touch the AudioContext. `unlockAudio()` is a no-op once the
    // context is already running, so this costs nothing on every later drag.
    unlockAudio();
    // `square` is null for spare pieces, which this board never renders.
    setDragOrigin(square);
  }, []);

  const handlePieceDrop = useCallback(
    (args: PieceDropHandlerArgs): boolean => {
      clearDragOrigin();
      return onPieceDrop ? onPieceDrop(args) : false;
    },
    [clearDragOrigin, onPieceDrop],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (lastMoveUci && lastMoveUci.length >= 4) {
      const from = lastMoveUci.slice(0, 2);
      const to = lastMoveUci.slice(2, 4);
      styles[from] = { backgroundColor: HIGHLIGHT };
      styles[to] = { backgroundColor: HIGHLIGHT };
    }

    // Markers are gated on `allowDragging` as well as on the callback being
    // supplied, so they can never appear on a read-only board.
    if (allowDragging && legalMovesFor && dragOrigin) {
      styles[dragOrigin] = { ...styles[dragOrigin], backgroundColor: ORIGIN_HIGHLIGHT };
      legalMovesFor(dragOrigin).forEach((target) => {
        styles[target.to] = {
          ...styles[target.to],
          backgroundImage: target.capture ? CAPTURE_RING : MOVE_DOT,
        };
      });
    }

    return styles;
  }, [lastMoveUci, allowDragging, legalMovesFor, dragOrigin]);

  const badgePosition = useMemo(
    () => (moveBadge ? squareBadgePosition(moveBadge.square, boardOrientation) : null),
    [moveBadge, boardOrientation],
  );

  return (
    <div className="chessboard-wrapper">
      <Chessboard
        options={{
          id: 'chessscope-analysis-board',
          position: renderedFen,
          boardOrientation,
          allowDragging: allowDragging ?? false,
          ...(onPieceDrop ? { onPieceDrop: handlePieceDrop } : {}),
          ...(allowDragging && legalMovesFor
            ? { onPieceDrag: handlePieceDrag, onPieceDragCancel: clearDragOrigin }
            : {}),
          allowDrawingArrows: false,
          showNotation: true,
          animationDurationInMs: 150,
          squareStyles,
          lightSquareStyle: { backgroundColor: colors.light },
          darkSquareStyle: { backgroundColor: colors.dark },
          boardStyle: {
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
          },
        }}
      />

      {/*
        Overlay sibling of the board rather than a child of it, so nothing here
        can perturb `react-chessboard`'s own layout or drag handling. It is
        sized from the wrapper's *width* with `aspect-ratio: 1` — matching the
        square board exactly — instead of stretching to the wrapper's height,
        which would skew the percentages if the wrapper ever grew taller than
        the board.

        `key` restarts the entrance animation whenever the marked square or its
        classification changes, so stepping between moves re-plays the fade-in
        instead of the badge silently teleporting.
      */}
      {moveBadge && badgePosition && (
        <div className="board-badges" aria-hidden="true">
          <span
            key={`${moveBadge.square}-${moveBadge.classification}`}
            className="board-badge"
            style={{
              left: `${badgePosition.leftPct}%`,
              top: `${badgePosition.topPct}%`,
              backgroundColor: classificationColor(moveBadge.classification),
            }}
            title={classificationLabel(moveBadge.classification)}
          >
            {/*
              An inline SVG with a fixed viewBox keeps the glyph proportional to
              the badge at any board size. Sizing the text in CSS would need the
              badge's pixel size, which is exactly the DOM measurement this
              component is built to avoid.
            */}
            <svg viewBox="0 0 100 100" className="board-badge__glyph">
              <text x="50" y="50" textAnchor="middle" dominantBaseline="central">
                {classificationIcon(moveBadge.classification)}
              </text>
            </svg>
          </span>
        </div>
      )}
    </div>
  );
}
