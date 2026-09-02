import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import { unlockAudio } from '../../lib/sound';
import { useBoardTheme } from '../../lib/boardTheme';
import { usePieceSet } from '../../lib/pieceSet';
import type { PieceColor, PieceType } from '../../lib/pieceSilhouettes';
import type { Classification, LegalMoveTarget } from '../../types';

/** A classification marker to float over one square of the board. */
export type MoveBadge = {
  /** Destination square of the move being marked, e.g. `e4`. */
  square: string;
  classification: Classification;
};

/** The piece a capturing move took. King is deliberately excluded — chess
 * ends before a king is ever actually captured, so there is no real case to
 * render. */
export type CapturedPiece = {
  type: Exclude<PieceType, 'k'>;
  color: PieceColor;
};

/**
 * Everything about the move that produced the board's current position —
 * who moved, from where to where, and what (if anything) it took. Drives
 * both the per-piece-type movement flourish (a knight hops, a rook glides,
 * a bishop leans into its slide...) and the capture-cut sword effect.
 */
export type LastMoveInfo = {
  from: string;
  to: string;
  piece: PieceType;
  color: PieceColor;
  /**
   * Square the taken piece actually sits on. Equal to `to` for every
   * capture except en passant, where the taken pawn sits one rank behind
   * `to` — the capturing pawn never lands on the square it removes a piece
   * from. `null` when this move captured nothing.
   */
  captureSquare: string | null;
  capture: CapturedPiece | null;
  /**
   * True for a castling move (`O-O`/`O-O-O`). King and rook move together,
   * which doesn't decompose into one piece's own flourish, so the movement
   * overlay skips these and falls back to `react-chessboard`'s own plain
   * slide (which handles the two-square diff correctly on its own).
   */
  isCastle: boolean;
};

function capturedPieceFrom(captured: string | undefined, moverColor: PieceColor): CapturedPiece | null {
  // chess.js types a captured piece as the full `PieceSymbol` (which
  // includes `'k'`) even though a king can never actually be captured —
  // real chess ends with checkmate first. Rather than assert that away,
  // `'k'` is treated the same as "nothing was captured": if it ever did
  // happen (a chess.js bug, an unexpected FEN), the effect just quietly
  // doesn't fire instead of the app crashing on a value its own type system
  // said was impossible.
  if (!captured || captured === 'k') return null;
  // The captured piece always belongs to whoever's *not* making this move —
  // chess.js's own `Move` only carries the piece type and the *mover's*
  // colour, never the captured piece's colour directly.
  return { type: captured as CapturedPiece['type'], color: moverColor === 'w' ? 'b' : 'w' };
}

/**
 * Builds `LastMoveInfo` from a chess.js `Move` (or the same handful of
 * fields plucked off one). The one place that knows how to read a mover's
 * piece/colour, a captured piece's type/colour, en passant's offset capture
 * square, and castling, so no caller has to re-derive any of it — and every
 * caller building `lastMove` from a replayed move (GameAnalysisPage,
 * useBotGame) gets it identically.
 */
export function lastMoveInfoFromMove(move: {
  from: string;
  to: string;
  piece: string;
  color: PieceColor;
  captured?: string;
  flags: string;
}): LastMoveInfo {
  const isEnPassant = move.flags.includes('e');
  const capture = capturedPieceFrom(move.captured, move.color);
  return {
    from: move.from,
    to: move.to,
    piece: move.piece as PieceType,
    color: move.color,
    capture,
    captureSquare: capture ? (isEnPassant ? `${move.to[0]}${move.from[1]}` : move.to) : null,
    isCastle: move.flags.includes('k') || move.flags.includes('q'),
  };
}

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
   * Full detail of the move that produced `displayFen` — drives the
   * per-piece-type movement flourish and, when it took something, the
   * capture-cut sword effect. Optional; a caller that never wires this up
   * just gets `react-chessboard`'s own plain slide with no flourish and no
   * capture effect, same as before this system existed.
   */
  lastMove?: LastMoveInfo | null;
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

/** Dead centre of a square — where the movement/capture overlays below are anchored. */
function squareCenterPosition(
  square: string,
  boardOrientation: 'white' | 'black',
): { leftPct: number; topPct: number } | null {
  return squarePercentPosition(square, boardOrientation, 0.5, 0.5);
}

/**
 * Converts a delta expressed as a percentage of the *board's* width into a
 * percentage of *one square's* width. A CSS `%` inside `transform:
 * translate()` always resolves against the translated element's own box —
 * never its parent's or the board's — so every element this app animates by
 * a board-relative distance (a movement flourish, a capture-cut half, a
 * shard) is deliberately sized to exactly one square, and its own travel
 * distances are expressed in this unit rather than raw board percentages.
 */
function toOwnSquarePercent(boardDeltaPct: number): number {
  return (boardDeltaPct / SQUARE_PCT) * 100;
}

/** Fallback slide duration for a move this board has no `LastMoveInfo` for
 * (a caller that hasn't wired `lastMove` up) — matches what every move on
 * this board used before the per-piece movement system existed. */
const DEFAULT_SLIDE_MS = 150;
/** Castling moves two pieces at once, which doesn't decompose into one
 * piece's own flourish — `react-chessboard`'s own diff-based slide handles
 * it correctly on its own, just a little slower than a single piece's move. */
const CASTLE_SLIDE_MS = 220;

/**
 * How long each piece type's own movement flourish takes, in ms. The knight
 * gets noticeably longer than the rest — it's the one piece whose motion is
 * a real hop/arc rather than a glide, and needs the extra time to read as
 * one rather than a fast, jerky slide.
 */
const MOVEMENT_DURATION_MS: Record<PieceType, number> = {
  p: 190,
  n: 360,
  b: 260,
  r: 220,
  q: 250,
  k: 260,
};

/** How many debris shards fly out of a capture impact, alongside the sliced piece. */
const CAPTURE_FX_SHARD_COUNT = 5;
/**
 * Total lifetime of the capture-cut effect once it starts (piece halves
 * flying apart, shockwave, blade flash, shards, all fading out), in ms —
 * must stay roughly in sync with the longest CSS animation duration in
 * App.css's "Capture impact effect" section (currently
 * `.capture-fx__piece-half`'s 560ms).
 */
const CAPTURE_FX_LIFETIME_MS = 680;
/** How long the board's own impact shake runs, in ms. */
const CAPTURE_SHAKE_MS = 220;

/** Which diagonal the "blade" cuts along. */
type CutOrientation = 'tlbr' | 'trbl';

/**
 * End transform for each half of the sliced piece, keyed by cut orientation
 * — `a` is the half above/right of the cut line, `b` the half below/left.
 * Percentages are, per `toOwnSquarePercent`'s comment, relative to the
 * half's own box, which App.css sizes to fill `.capture-fx` exactly. Halves
 * separate roughly perpendicular to the blade, each with a little rotation
 * and a downward bias — the piece falling apart, not just sliding sideways.
 */
const PIECE_CUT_TRAJECTORY: Record<CutOrientation, { a: string; b: string }> = {
  // "/" blade (top-right to bottom-left): the upper-left half kicks up-left,
  // the lower-right half drops down-right.
  trbl: {
    a: 'translate(-46%, -30%) rotate(-26deg)',
    b: 'translate(42%, 48%) rotate(24deg)',
  },
  // "\" blade (top-left to bottom-right): mirrored.
  tlbr: {
    a: 'translate(46%, -30%) rotate(26deg)',
    b: 'translate(-42%, 48%) rotate(-24deg)',
  },
};

type CaptureShard = { dx: number; dy: number; rotate: number; delay: number };

/**
 * One-off scatter of shard trajectories for a single capture. Spread evenly
 * around the compass with a little jitter on each — enough that a burst
 * never looks mechanically identical twice, without needing to be
 * reproducible (this is transient visual flourish, not anything a test or
 * replay depends on). `dx`/`dy` are percentages of the shard's own box, per
 * `toOwnSquarePercent`'s comment.
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

/** True when the viewer has asked the OS/browser for reduced motion. Read
 * fresh each time rather than cached — it's cheap, and the preference can
 * change while the app is open. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Whether a piece of the given type/colour is sitting on `square` in `fen`.
 * The one safety check the movement overlay is built on: it only ever
 * animates a piece flying from `from` to `to` when that piece is verifiably
 * still at `from` in the position currently on screen. That single check is
 * what keeps the overlay correct without it having to know anything about
 * *why* the position changed — a normal single move forward satisfies it; a
 * multi-ply jump (a move-list click, "go to end") or a step *backward*
 * almost never does, in which case this board falls back to `react-chessboard`'s
 * own plain diff-based slide instead of animating a piece "from" a square it
 * was never actually just on. */
function pieceIsAt(fen: string, square: string, type: PieceType, color: PieceColor): boolean {
  try {
    const piece = new Chess(fen).get(square as Square);
    return !!piece && piece.type === type && piece.color === color;
  } catch {
    return false;
  }
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
  lastMove = null,
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
  // How long `react-chessboard`'s *own* slide takes. 0 whenever the
  // movement overlay below is handling a move itself (the normal case) —
  // otherwise `react-chessboard`'s own animation would run at the same time
  // as ours, doubling the piece up. Bumped only for the moves the overlay
  // deliberately steps aside for (see the effect below).
  const [boardAnimationMs, setBoardAnimationMs] = useState(DEFAULT_SLIDE_MS);

  const { colors } = useBoardTheme();
  const { pieces } = usePieceSet();
  // Whichever piece art is actually on screen right now (Classic or Line) —
  // used to draw both the movement overlay and the capture-cut halves, so
  // neither ever mismatches the art style the rest of the board is using.
  const activePieceRenderers = pieces ?? defaultPieces;
  const renderPieceGlyph = useCallback(
    (type: PieceType, color: PieceColor) => {
      const code = `${color}${type.toUpperCase()}`;
      const Renderer = activePieceRenderers[code];
      return Renderer ? <Renderer /> : null;
    },
    [activePieceRenderers],
  );

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

  // The piece currently flying from one square to another, per its own
  // piece-type flourish — see `MOVEMENT_DURATION_MS`/the big effect below.
  // `id` is a bump counter (not the squares) so replaying the exact same
  // move (e.g. stepping back then forward again past it) restarts the
  // animation via a changed `key`.
  const [activeMovement, setActiveMovement] = useState<{
    id: number;
    from: string;
    to: string;
    piece: PieceType;
    color: PieceColor;
  } | null>(null);
  const movementIdRef = useRef(0);

  // Capture-cut effect: the taken piece's own art sliced in two along a
  // blade flash, a shard burst, and a brief board shake — all on the
  // square the capture actually happened on (see `LastMoveInfo.captureSquare`
  // — not always the mover's destination square, because of en passant).
  const [captureFx, setCaptureFx] = useState<{
    id: number;
    square: string;
    type: CapturedPiece['type'];
    color: PieceColor;
    orientation: CutOrientation;
    shards: CaptureShard[];
  } | null>(null);
  const captureFxIdRef = useRef(0);
  const [boardShaking, setBoardShaking] = useState(false);

  // `lastMove` is a fresh `{ ... }` literal from the caller on every render
  // (GameAnalysisPage/useBotGame both rebuild it each time), so depending on
  // it directly would re-run the effect below — and restart whatever
  // animation is mid-flight — on any unrelated re-render. `useMemo` keyed on
  // its actual fields collapses that back down to one stable reference that
  // only changes when the move itself does.
  const stableLastMove = useMemo(
    () => lastMove,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lastMove?.from,
      lastMove?.to,
      lastMove?.piece,
      lastMove?.color,
      lastMove?.captureSquare,
      lastMove?.capture?.type,
      lastMove?.capture?.color,
      lastMove?.isCastle,
    ],
  );

  // Whether this is the very first commit for this board instance (mount,
  // or a hard reload landing mid-game) — guards the effect below so it never
  // tries to animate a piece "arriving" at a position the viewer is simply
  // *seeing for the first time*, which would show every piece already on
  // the board flying in from nowhere.
  const hasRenderedOnceRef = useRef(false);

  useLayoutEffect(() => {
    clearDragOrigin();
    clearSelection();

    if (!hasRenderedOnceRef.current) {
      hasRenderedOnceRef.current = true;
      setRenderedFen(displayFen);
      setBoardAnimationMs(DEFAULT_SLIDE_MS);
      setActiveMovement(null);
      return;
    }

    const reduceMotion = prefersReducedMotion();
    const canAnimateMovement =
      !!stableLastMove &&
      !stableLastMove.isCastle &&
      !reduceMotion &&
      pieceIsAt(renderedFen, stableLastMove.from, stableLastMove.piece, stableLastMove.color);

    /** Fires the capture-cut effect `delayMs` after this move visibly lands
     * — whichever animation (ours or `react-chessboard`'s own) is actually
     * playing. Returns a cleanup that cancels both its timers. */
    const scheduleCaptureCut = (move: LastMoveInfo, delayMs: number): (() => void) => {
      if (!move.capture || !move.captureSquare || reduceMotion) return () => {};
      const { capture, captureSquare } = move;
      const showTimer = window.setTimeout(() => {
        captureFxIdRef.current += 1;
        setCaptureFx({
          id: captureFxIdRef.current,
          square: captureSquare,
          type: capture.type,
          color: capture.color,
          // Which way the blade cuts is the one thing about this effect
          // that's randomized rather than derived — real variety, since
          // which piece and which square are dictated entirely by the move.
          orientation: Math.random() < 0.5 ? 'tlbr' : 'trbl',
          shards: buildCaptureShards(),
        });
        setBoardShaking(true);
        window.setTimeout(() => setBoardShaking(false), CAPTURE_SHAKE_MS);
      }, delayMs);
      const clearTimer = window.setTimeout(() => setCaptureFx(null), delayMs + CAPTURE_FX_LIFETIME_MS);
      return () => {
        window.clearTimeout(showTimer);
        window.clearTimeout(clearTimer);
      };
    };

    if (!canAnimateMovement) {
      // Plain path: `react-chessboard`'s own diff-based slide handles it —
      // either because there's nothing to animate from (no `lastMove`), the
      // move was a castle, the viewer asked for reduced motion, or the
      // safety check above couldn't verify the mover was really at `from`
      // (a multi-ply jump, a step backward). Same behaviour every move on
      // this board had before the per-piece system existed.
      const slideMs = stableLastMove?.isCastle ? CASTLE_SLIDE_MS : DEFAULT_SLIDE_MS;
      setBoardAnimationMs(slideMs);
      setRenderedFen(displayFen);
      setActiveMovement(null);
      return stableLastMove ? scheduleCaptureCut(stableLastMove, slideMs) : undefined;
    }

    // Custom path: take over from `react-chessboard` entirely for this move
    // — otherwise its own slide would run at the same time as our overlay,
    // doubling the piece up.
    setBoardAnimationMs(0);

    // "In transit" position: the pre-move board with the mover's origin
    // square, its destination square, and (for en passant) the actually-
    // captured square all emptied, so nothing sits under the overlay piece
    // while it's mid-flight and no captured piece is left behind for it to
    // overlap.
    let inTransitFen = displayFen;
    try {
      const chess = new Chess(renderedFen);
      chess.remove(stableLastMove.from as Square);
      chess.remove(stableLastMove.to as Square);
      if (stableLastMove.captureSquare && stableLastMove.captureSquare !== stableLastMove.to) {
        chess.remove(stableLastMove.captureSquare as Square);
      }
      inTransitFen = chess.fen();
    } catch {
      // Malformed square name — fall back to jumping straight to the final
      // position rather than leaving the board looking broken.
    }
    setRenderedFen(inTransitFen);

    movementIdRef.current += 1;
    setActiveMovement({
      id: movementIdRef.current,
      from: stableLastMove.from,
      to: stableLastMove.to,
      piece: stableLastMove.piece,
      color: stableLastMove.color,
    });

    const duration = MOVEMENT_DURATION_MS[stableLastMove.piece];
    const landTimer = window.setTimeout(() => {
      setRenderedFen(displayFen);
      setActiveMovement(null);
    }, duration);

    const cancelCaptureCut = scheduleCaptureCut(stableLastMove, duration);

    return () => {
      window.clearTimeout(landTimer);
      cancelCaptureCut();
    };
  }, [displayFen, stableLastMove, clearDragOrigin, clearSelection]);

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

  const movementPositions = useMemo(() => {
    if (!activeMovement) return null;
    const from = squareCenterPosition(activeMovement.from, boardOrientation);
    const to = squareCenterPosition(activeMovement.to, boardOrientation);
    if (!from || !to) return null;
    return { from, to };
  }, [activeMovement, boardOrientation]);

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
          animationDurationInMs: boardAnimationMs,
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
        The piece currently mid-move, drawn with whichever piece art
        (Classic/Line) the rest of the board is using — see
        `renderPieceGlyph`. Positioned at its *source* square; `--mv-dx/dy`
        (the source→destination delta, in the "percent of one square" unit
        `toOwnSquarePercent` produces) is what each piece type's own
        `@keyframes` in App.css actually travels along.
      */}
      {activeMovement && movementPositions && (
        <div className="board-fx" aria-hidden="true">
          <span
            key={activeMovement.id}
            className={`movement-fx__piece movement-fx__piece--${activeMovement.piece}`}
            style={
              {
                left: `${movementPositions.from.leftPct}%`,
                top: `${movementPositions.from.topPct}%`,
                '--mv-dx': `${toOwnSquarePercent(movementPositions.to.leftPct - movementPositions.from.leftPct)}%`,
                '--mv-dy': `${toOwnSquarePercent(movementPositions.to.topPct - movementPositions.from.topPct)}%`,
              } as React.CSSProperties
            }
          >
            {renderPieceGlyph(activeMovement.piece, activeMovement.color)}
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

            {/*
              The taken piece itself, drawn twice (in whichever piece art is
              active) and clipped to opposite triangles of the same diagonal
              — at rest (frame 0) the two halves overlap exactly and read as
              the whole intact piece; the keyframe in App.css then carries
              each half apart along `--capture-fx-piece-end` (see
              `PIECE_CUT_TRAJECTORY`). Both halves render the *full* art
              rather than pre-split paths — clip-path, not the art itself,
              does the cutting — so this works identically for every piece
              type and every piece set with zero per-piece/per-set art.
            */}
            <span
              className={`capture-fx__piece-half capture-fx__piece-half--a capture-fx__piece-half--${captureFx.orientation}`}
              style={
                { '--capture-fx-piece-end': PIECE_CUT_TRAJECTORY[captureFx.orientation].a } as React.CSSProperties
              }
            >
              {renderPieceGlyph(captureFx.type, captureFx.color)}
            </span>
            <span
              className={`capture-fx__piece-half capture-fx__piece-half--b capture-fx__piece-half--${captureFx.orientation}`}
              style={
                { '--capture-fx-piece-end': PIECE_CUT_TRAJECTORY[captureFx.orientation].b } as React.CSSProperties
              }
            >
              {renderPieceGlyph(captureFx.type, captureFx.color)}
            </span>

            {/* The blade itself — a bright flash swept along the same
                diagonal the two halves just split along. */}
            <span className={`capture-fx__blade capture-fx__blade--${captureFx.orientation}`}>
              <span className="capture-fx__blade-bar" />
            </span>

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
