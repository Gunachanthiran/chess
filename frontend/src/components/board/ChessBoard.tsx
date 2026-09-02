import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import { unlockAudio } from '../../lib/sound';
import { useBoardTheme } from '../../lib/boardTheme';
import { usePieceSet } from '../../lib/pieceSet';
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
   * Opt-in interactivity — drag & drop *and* click-to-move both live behind
   * this one flag, since every board that wants one wants the other.
   * Defaults to `false` so the analysis page — which never sets it — stays
   * read-only exactly as before.
   */
  allowDragging?: boolean;
  /**
   * Called with the two squares of a completed move, whether it arrived by
   * dropping a dragged piece or by two clicks (see `handleSquareClick`).
   * Return `true` to accept the drop (the board suppresses the snap-back
   * animation and waits for the next `displayFen`), `false` to reject it.
   * `targetSquare` is `null` when a *drag* was dropped off the board — a
   * click-to-move completion always has a real target square, since it is
   * only ever triggered by clicking an actual legal destination.
   */
  onPieceDrop?: (args: PieceDropHandlerArgs) => boolean;
  /**
   * True when `lastMoveUci` took a piece — drives the capture impact effect
   * (shockwave + shard burst + a small board shake) on that square. Optional
   * and defaults to `false`, so a caller that never wires this up (there is
   * none left, but the type doesn't require it) just never sees the effect
   * rather than crashing on a missing prop.
   */
  lastMoveIsCapture?: boolean;
  /**
   * Legal destinations for a piece the player has just picked up (by drag)
   * or clicked (the first tap of a click-to-move pair), used to draw the
   * chess.com-style dots/capture rings and to decide what a click on a given
   * square means. Optional and only consulted while `allowDragging` is true,
   * so the read-only analysis board — which passes neither — is completely
   * unaffected.
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
function squarePercentPosition(
  square: string,
  boardOrientation: 'white' | 'black',
  anchorX: number,
  anchorY: number,
): { leftPct: number; topPct: number } | null {
  if (square.length < 2) return null;

  const fileIndex = square.charCodeAt(0) - 'a'.charCodeAt(0); // a=0 ... h=7
  const rankIndex = square.charCodeAt(1) - '1'.charCodeAt(0); // rank 1=0 ... rank 8=7
  if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) return null;

  const flipped = boardOrientation === 'black';
  const column = flipped ? 7 - fileIndex : fileIndex;
  const row = flipped ? rankIndex : 7 - rankIndex;

  return {
    leftPct: (column + anchorX) * SQUARE_PCT,
    topPct: (row + anchorY) * SQUARE_PCT,
  };
}

function squareBadgePosition(
  square: string,
  boardOrientation: 'white' | 'black',
): { leftPct: number; topPct: number } | null {
  return squarePercentPosition(square, boardOrientation, BADGE_ANCHOR_X, BADGE_ANCHOR_Y);
}

/** Dead centre of a square — where the capture impact effect below is anchored. */
function squareCenterPosition(
  square: string,
  boardOrientation: 'white' | 'black',
): { leftPct: number; topPct: number } | null {
  return squarePercentPosition(square, boardOrientation, 0.5, 0.5);
}

/**
 * `react-chessboard`'s own slide animation for the capturing piece — kept as
 * one named constant so the capture-impact effect below can wait for it to
 * finish before it plays, and so the two can never quietly drift apart.
 */
const BOARD_MOVE_ANIMATION_MS = 150;

/** How many debris shards fly out of a capture impact. */
const CAPTURE_FX_SHARD_COUNT = 7;
/**
 * Total lifetime of the impact effect once it starts (shockwave + shards
 * fading out), in ms — must stay roughly in sync with the CSS animation
 * durations on `.capture-fx__ring`/`.capture-fx__shard` in App.css.
 */
const CAPTURE_FX_LIFETIME_MS = 620;
/** How long the board's own impact shake runs, in ms. */
const CAPTURE_SHAKE_MS = 220;

type CaptureShard = { dx: number; dy: number; rotate: number; delay: number };

/**
 * One-off scatter of shard trajectories for a single capture. `dx`/`dy` are
 * percentages, but deliberately *not* board-relative: a CSS `%` inside
 * `transform: translate()` always resolves against the element's own box,
 * never its parent's, so `.capture-fx__shard` is sized in App.css to fill
 * `.capture-fx` exactly (see that rule's comment) and these percentages are
 * fractions of *that* — roughly half to three-quarters of one square outward,
 * which is what `distance` below actually means.
 *
 * Spread evenly around the compass with a little jitter on each — enough
 * that a burst never looks mechanically identical twice, without needing to
 * be reproducible (this is transient visual flourish, not anything a test or
 * replay depends on).
 */
function buildCaptureShards(): CaptureShard[] {
  return Array.from({ length: CAPTURE_FX_SHARD_COUNT }, (_, i) => {
    const angle = (360 / CAPTURE_FX_SHARD_COUNT) * i + (Math.random() * 26 - 13);
    const radians = (angle * Math.PI) / 180;
    const distance = 0.46 + Math.random() * 0.26; // fraction of the shard's own box
    return {
      dx: Math.cos(radians) * distance * 100,
      dy: Math.sin(radians) * distance * 100,
      rotate: Math.round(angle + (Math.random() * 200 - 100)),
      delay: Math.round(Math.random() * 35),
    };
  });
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
  lastMoveIsCapture = false,
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
  const { pieces } = usePieceSet();

  // Square a piece is currently being dragged from, or null when nothing is in
  // hand. Purely ephemeral view state: it drives the legal-move markers and
  // nothing else, and is cleared on drop, on drag-cancel, and defensively
  // whenever the position changes underneath us.
  const [dragOrigin, setDragOrigin] = useState<string | null>(null);
  // Click-to-move's equivalent of `dragOrigin`: the square tapped first, held
  // across the gap between two separate clicks (a drag has both ends of the
  // gesture in one continuous pointer interaction; a click sequence does not,
  // so this has to survive between renders in a way `dragOrigin` never needs
  // to). The two are mutually exclusive — starting a real drag clears this,
  // and `legalMovesFor` is reused unchanged as the single source of truth for
  // both, so the click and drag paths can never disagree about what is legal.
  //
  // Kept as a ref *and* a state value, not just state: `handleSquareClick`
  // has to branch on "what was the previous selection" while also submitting
  // a move — a `setState(prev => ...)` updater is the wrong place for that,
  // since React may invoke an updater more than once per commit (StrictMode's
  // dev double-invoke does this deliberately, to surface exactly this kind of
  // impurity), which would submit the same move twice. The ref gives a plain,
  // single-read synchronous value to branch on; the state half exists only to
  // trigger the re-render `squareStyles` needs to draw the highlight.
  const [selectedOrigin, setSelectedOriginState] = useState<string | null>(null);
  const selectedOriginRef = useRef<string | null>(null);

  const setSelectedOrigin = useCallback((next: string | null) => {
    selectedOriginRef.current = next;
    setSelectedOriginState(next);
  }, []);

  const clearDragOrigin = useCallback(() => {
    // Functional update so a no-op clear does not schedule a render.
    setDragOrigin((current) => (current === null ? current : null));
  }, []);

  const clearSelection = useCallback(() => setSelectedOrigin(null), [setSelectedOrigin]);

  useLayoutEffect(() => {
    setRenderedFen(displayFen);
    clearDragOrigin();
    clearSelection();
  }, [displayFen, clearDragOrigin, clearSelection]);

  // Capture impact effect: a shockwave + shard burst on the destination
  // square, plus a brief board shake. `id` is a bump counter, not a boolean,
  // so replaying the exact same capture (e.g. clicking back and forward past
  // it in the move list) restarts the animation via a changed `key` instead
  // of silently no-op'ing because "isCapture" never toggled.
  const [captureFx, setCaptureFx] = useState<{ id: number; square: string; shards: CaptureShard[] } | null>(
    null,
  );
  const captureFxIdRef = useRef(0);
  const [boardShaking, setBoardShaking] = useState(false);

  useLayoutEffect(() => {
    if (!lastMoveIsCapture || !lastMoveUci || lastMoveUci.length < 4) return;
    const square = lastMoveUci.slice(2, 4);

    // Wait out react-chessboard's own slide first, so the burst reads as the
    // impact of the piece landing rather than announcing the capture before
    // it visibly arrives.
    const showTimer = window.setTimeout(() => {
      captureFxIdRef.current += 1;
      setCaptureFx({ id: captureFxIdRef.current, square, shards: buildCaptureShards() });
      setBoardShaking(true);
      window.setTimeout(() => setBoardShaking(false), CAPTURE_SHAKE_MS);
    }, BOARD_MOVE_ANIMATION_MS);

    const clearTimer = window.setTimeout(
      () => setCaptureFx(null),
      BOARD_MOVE_ANIMATION_MS + CAPTURE_FX_LIFETIME_MS,
    );

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(clearTimer);
    };
    // `lastMoveUci` alone would miss a capture replayed onto the very same
    // square as the previous one; both together fire on every real new move.
  }, [lastMoveUci, lastMoveIsCapture]);

  const handlePieceDrag = useCallback(
    ({ square }: PieceHandlerArgs) => {
      // Belt-and-braces alongside the app-wide gesture listener in `App.tsx`:
      // picking up a piece is unambiguously a direct, trusted user gesture, so
      // unlocking right here guarantees the move-sound path is never the first
      // thing to touch the AudioContext. `unlockAudio()` is a no-op once the
      // context is already running, so this costs nothing on every later drag.
      unlockAudio();
      // `square` is null for spare pieces, which this board never renders.
      setDragOrigin(square);
      // A real drag starting takes over from any pending click-selection.
      clearSelection();
    },
    [clearSelection],
  );

  const handlePieceDrop = useCallback(
    (args: PieceDropHandlerArgs): boolean => {
      clearDragOrigin();
      clearSelection();
      return onPieceDrop ? onPieceDrop(args) : false;
    },
    [clearDragOrigin, clearSelection, onPieceDrop],
  );

  const handleSquareClick = useCallback(
    ({ square }: SquareHandlerArgs) => {
      if (!legalMovesFor) return;
      unlockAudio();

      const current = selectedOriginRef.current;

      if (current === null) {
        // Nothing selected yet — only a piece with a legal move (i.e. one
        // belonging to the side to move) can start a selection.
        if (legalMovesFor(square).length > 0) setSelectedOrigin(square);
        return;
      }

      if (square === current) {
        clearSelection(); // Tapping the same piece again deselects it.
        return;
      }

      const isLegalTarget = legalMovesFor(current).some((target) => target.to === square);
      if (isLegalTarget) {
        clearSelection();
        // `onPieceDrop` is the same completion path a drag ends on, so
        // click-to-move and drag-and-drop share every bit of the actual
        // move-submission logic (sound, optimistic state, the API call) —
        // this component only ever decides *which* two squares to submit.
        // Called as a plain statement here, never from inside a state
        // updater, so it runs exactly once per click no matter how React
        // schedules the `setSelectedOrigin` calls around it.
        onPieceDrop?.({
          sourceSquare: current,
          targetSquare: square,
          piece: { isSparePiece: false, position: current, pieceType: '' },
        });
        return;
      }

      // Not a legal destination from the current selection: switch to it if
      // it is itself selectable (another of the mover's own pieces),
      // otherwise treat the click as a cancel.
      if (legalMovesFor(square).length > 0) {
        setSelectedOrigin(square);
      } else {
        clearSelection();
      }
    },
    [legalMovesFor, onPieceDrop, setSelectedOrigin, clearSelection],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};

    if (lastMoveUci && lastMoveUci.length >= 4) {
      const from = lastMoveUci.slice(0, 2);
      const to = lastMoveUci.slice(2, 4);
      styles[from] = { backgroundColor: HIGHLIGHT };
      styles[to] = { backgroundColor: HIGHLIGHT };
    }

    // The active origin is whichever gesture is live — a drag in progress, or
    // a pending click-selection — the two never coexist (see `handlePieceDrag`).
    const activeOrigin = dragOrigin ?? selectedOrigin;

    // Markers are gated on `allowDragging` as well as on the callback being
    // supplied, so they can never appear on a read-only board.
    if (allowDragging && legalMovesFor && activeOrigin) {
      styles[activeOrigin] = { ...styles[activeOrigin], backgroundColor: ORIGIN_HIGHLIGHT };
      legalMovesFor(activeOrigin).forEach((target) => {
        styles[target.to] = {
          ...styles[target.to],
          backgroundImage: target.capture ? CAPTURE_RING : MOVE_DOT,
        };
      });
    }

    return styles;
  }, [lastMoveUci, allowDragging, legalMovesFor, dragOrigin, selectedOrigin]);

  const badgePosition = useMemo(
    () => (moveBadge ? squareBadgePosition(moveBadge.square, boardOrientation) : null),
    [moveBadge, boardOrientation],
  );

  const captureFxPosition = useMemo(
    () => (captureFx ? squareCenterPosition(captureFx.square, boardOrientation) : null),
    [captureFx, boardOrientation],
  );

  return (
    <div className={`chessboard-wrapper${boardShaking ? ' chessboard-wrapper--impact' : ''}`}>
      <Chessboard
        options={{
          id: 'chessscope-analysis-board',
          position: renderedFen,
          boardOrientation,
          allowDragging: allowDragging ?? false,
          ...(onPieceDrop ? { onPieceDrop: handlePieceDrop } : {}),
          ...(allowDragging && legalMovesFor
            ? {
                onPieceDrag: handlePieceDrag,
                onPieceDragCancel: clearDragOrigin,
                onSquareClick: handleSquareClick,
              }
            : {}),
          allowDrawingArrows: false,
          showNotation: true,
          animationDurationInMs: BOARD_MOVE_ANIMATION_MS,
          ...(pieces ? { pieces } : {}),
          squareStyles,
          lightSquareStyle: { backgroundColor: colors.light },
          darkSquareStyle: { backgroundColor: colors.dark },
          boardStyle: {
            borderRadius: '10px',
            overflow: 'hidden',
            boxShadow:
              '0 20px 48px -16px rgba(0, 0, 0, 0.55), 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent)',
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

      {/*
        Same overlay-sibling pattern as the badge layer above. `key={captureFx.id}`
        (not the square name) is what actually matters here — it's a bump
        counter, so a capture landing on the exact same square as the previous
        one still gets a fresh DOM node and replays from scratch instead of the
        browser treating it as the same element with unchanged props.
      */}
      {captureFx && captureFxPosition && (
        <div className="board-fx" aria-hidden="true">
          <span
            key={captureFx.id}
            className="capture-fx"
            style={{ left: `${captureFxPosition.leftPct}%`, top: `${captureFxPosition.topPct}%` }}
          >
            <span className="capture-fx__flash" />
            <span className="capture-fx__ring" />
            <span className="capture-fx__ring capture-fx__ring--delay" />
            {captureFx.shards.map((shard, index) => (
              <span
                key={index}
                className="capture-fx__shard"
                style={
                  {
                    '--capture-fx-dx': `${shard.dx}%`,
                    '--capture-fx-dy': `${shard.dy}%`,
                    '--capture-fx-rotate': `${shard.rotate}deg`,
                    animationDelay: `${shard.delay}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
