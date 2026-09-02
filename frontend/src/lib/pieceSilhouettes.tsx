import { useId } from 'react';

/**
 * Shared piece-body path data — the same shapes `pieceSets/lineArt.tsx` draws
 * as the "Line" piece set, pulled out here so a second consumer (the board's
 * capture-cut effect, see `ChessBoard.tsx`) can draw the *exact same*
 * silhouette without duplicating path data or importing a component meant for
 * `react-chessboard`'s `pieces` slot.
 *
 * Deliberately independent of whichever piece *set* is actually active
 * (Classic or Line): the capture effect needs one consistent, always-available
 * shape per piece type regardless of art style, the same way `moveBadge`'s
 * classification glyph is independent of piece art.
 *
 * Roman-themed, in the spirit of a Roman-military mood board (a
 * standard-bearing king, a robed matron queen, a centurion carrying a shield
 * in place of a bishop, a rearing-horse knight, a crenellated tower rook, a
 * small legionary pawn) rather than a copy of any one specific set —
 * reinterpreted as flat gradient-shaded silhouettes rather than an attempt at
 * sculptural, photorealistic detail, the same "deliberately simplified"
 * philosophy this file has always used. Every path here is hand-authored
 * geometry for this app; nothing is traced from a photograph.
 *
 * One shared coordinate system (viewBox 0 0 45 45) and one shared base
 * plinth — the same convention react-chessboard's own bundled set uses —
 * keeps every piece at a consistent height and scale.
 */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PieceColor = 'w' | 'b';

const WHITE_STROKE = '#2a2a2a';
const BLACK_STROKE = '#f4f1ea';

export const PIECE_BASE = <rect x="9" y="36.5" width="27" height="4" rx="1.3" />;

// Deliberately the smallest, plainest silhouette of the six — everything
// else is sized and detailed *relative to this baseline*, the same way a
// real Staunton set makes the pawn unmistakably "the small plain one" so it
// never gets confused with a piece that actually has a distinguishing
// feature.
const PAWN_BODY = (
  <>
    <circle cx="22.5" cy="17.5" r="4.2" />
    <path d="M18,38 C18,32 19.8,28 22.5,26.7 C25.2,28 27,32 27,38 Z" />
  </>
);

// A crenellated tower rather than a plain column: a shaft with brick-course
// lines and a battlement crown, topped with a small eagle finial.
const ROOK_BODY = (
  <>
    <path d="M20.5,4 C20.5,2.5 21.5,1.5 22.5,1.5 C23.5,1.5 24.5,2.5 24.5,4 L24.5,6 L20.5,6 Z" />
    <path d="M12,7.5 L15,4.5 L18,7.5 L18,4 L27,4 L27,7.5 L30,4.5 L33,7.5 L30,9.5 L15,9.5 Z" />
    <rect x="14.5" y="9.5" width="16" height="2.6" rx="0.7" />
    <path d="M16,12.4 L16,34 C16,34 18,35.5 22.5,35.5 C27,35.5 29,34 29,34 L29,12.4 Z" />
    <line x1="16" y1="18" x2="29" y2="18" fill="none" />
    <line x1="16" y1="24" x2="29" y2="24" fill="none" />
    <line x1="16" y1="30" x2="29" y2="30" fill="none" />
  </>
);

// Unchanged from the original set: already a clean, recognisable rearing
// horse/knight silhouette at board scale, so the redesign leaves it alone
// rather than risk an "improvement" that reads worse in play.
const KNIGHT_BODY = (
  <path d="M14,38 L14,30 C14,26 16,23 18,21 L15,17 C15,14 17,11 20,10 L23,14 L27,11 C30,11 33,14 33,18 C33,21 31,23 28,23 L30,26 L30,38 Z" />
);

// A centurion carrying a shield at his side in place of the traditional
// mitred bishop: a helmet dome noticeably wider than the pawn's plain head,
// a bold crest, and a curved shield panel with a boss — the shield's own
// asymmetric bulge is what makes this silhouette unmistakable even in solid
// colour, more than a straight sword ever did.
const BISHOP_BODY = (
  <>
    <path d="M22.5,0 L26,7 L22.5,9 L19,7 Z" />
    <path d="M22.5,3.4 C27.2,3.4 30.6,7 30.6,11.2 L30.6,12.4 C32,13 32.8,14.1 32.8,15.4 L32.8,17 L12.2,17 L12.2,15.4 C12.2,14.1 13,13 14.4,12.4 L14.4,11.2 C14.4,7 17.8,3.4 22.5,3.4 Z" />
    <path d="M14,38 L14,26 C14,20 16.3,15.8 19.8,14 C22.9,15.8 24.8,20 24.8,26 L24.8,38 Z" />
    <path d="M27,16.5 C30.5,17 33,20.5 33,25 C33,29.5 30.5,33 27,33.5 C25.8,33.5 25,32.6 25,31.4 L25,18.6 C25,17.4 25.8,16.5 27,16.5 Z" />
    <circle cx="29" cy="25" r="1.6" fill="none" />
  </>
);

// Topped with the widest head silhouette of the six — a big rounded
// hood/veil, wider than the centurion's helmet dome and with no crest or
// weapon on it — so width and softness read as "queen" instead of a
// quieter version of the piece next to her.
const QUEEN_BODY = (
  <>
    <path d="M10.5,10.5 C10.5,4 15.7,0 22.5,0 C29.3,0 34.5,4 34.5,10.5 L34.5,12 C34.5,13.3 33.2,14.2 31.5,14.2 L13.5,14.2 C11.8,14.2 10.5,13.3 10.5,12 Z" />
    <circle cx="22.5" cy="16.2" r="5.4" />
    <path d="M14.5,38 L14.5,29.5 C14.5,22.5 17.8,17 22.5,14.7 C27.2,17 30.5,22.5 30.5,29.5 L30.5,38 Z" />
  </>
);

// A standard-bearer: a bold staff (thick shaft, not a hairline) topped with
// a small spread-winged eagle rather than a plain orb, standing well above
// every other piece's own tallest point — the tallest piece on the board,
// which is the one silhouette cue proven to survive simplification.
const KING_BODY = (
  <>
    <rect x="29.6" y="4" width="2.8" height="18" rx="1.2" />
    <path d="M31,0.3 C29,1.3 27.4,2.9 27.7,4.5 C29,3.7 30.2,3.7 31,4.5 C31.8,3.7 33,3.7 34.3,4.5 C34.6,2.9 33,1.3 31,0.3 Z" />
    <rect x="25.4" y="10.6" width="11.2" height="2.8" rx="1" />
    <circle cx="16.5" cy="11" r="5.8" />
    <path d="M5,26 C5,20.7 9.8,17 16.5,17 C23.2,17 28,20.7 28,26 L28,29.6 L5,29.6 Z" />
    <path d="M7.7,38 L7.7,28.8 C7.7,22 11.2,17.5 16.5,15.5 C21.8,17.5 25.3,22 25.3,28.8 L25.3,38 Z" />
  </>
);

export const PIECE_BODY: Record<PieceType, React.ReactNode> = {
  p: PAWN_BODY,
  r: ROOK_BODY,
  n: KNIGHT_BODY,
  b: BISHOP_BODY,
  q: QUEEN_BODY,
  k: KING_BODY,
};

export type PieceSilhouetteProps = {
  type: PieceType;
  color: PieceColor;
  fill?: string;
  svgStyle?: React.CSSProperties;
  /** Off for a consumer that only wants the body shape, e.g. one half of a
   * clipped capture effect — the plinth would otherwise get sliced too. */
  includeBase?: boolean;
};

/**
 * One piece, drawn from the shared body/base shapes above with a metallic
 * gradient fill (warm silver/pewter for white, dark gunmetal for black) and
 * a soft drop shadow, rather than a flat single colour — what actually reads
 * as "premium" in a hand-drawn silhouette, short of full sculptural
 * rendering.
 *
 * The gradient is defined fresh per rendered instance via `useId()`, not as
 * one fixed, shared `<linearGradient id="...">`: a real board has many
 * pieces of the same colour on screen at once, all rendering their own
 * `<svg>`, and an HTML/SVG `id` is unique per *document*, not per element —
 * two elements sharing one hard-coded id resolve any `url(#id)` reference to
 * whichever one happens to be first in the DOM. That "happens to work" only
 * by coincidence (every white piece's gradient looks identical anyway) right
 * up until the first piece in DOM order is captured and removed, at which
 * point every *other* piece referencing its id would suddenly render with no
 * fill at all. `useId()` sidesteps that class of bug entirely. Its own output
 * contains `:`, which is valid in an `id` attribute but not safely usable
 * unescaped inside a CSS `url(#...)` reference, hence the strip below.
 */
export function PieceSilhouette({
  type,
  color,
  fill,
  svgStyle,
  includeBase = true,
}: PieceSilhouetteProps) {
  const rawId = useId();
  const gradientId = `piece-fill-${rawId.replace(/:/g, '')}`;
  const isWhite = color === 'w';

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" width="100%" height="100%" style={svgStyle}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="15%" y2="100%">
          {isWhite ? (
            <>
              <stop offset="0%" stopColor="#fffdf6" />
              <stop offset="35%" stopColor="#eee7d3" />
              <stop offset="70%" stopColor="#c9bd9e" />
              <stop offset="100%" stopColor="#a89a76" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#5c5850" />
              <stop offset="35%" stopColor="#38352f" />
              <stop offset="70%" stopColor="#1c1a17" />
              <stop offset="100%" stopColor="#0d0c0b" />
            </>
          )}
        </linearGradient>
      </defs>
      <g
        style={{
          fill: fill ?? `url(#${gradientId})`,
          stroke: isWhite ? WHITE_STROKE : BLACK_STROKE,
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
          filter: 'drop-shadow(0 1.6px 1.2px rgba(0, 0, 0, 0.4))',
        }}
      >
        {PIECE_BODY[type]}
        {includeBase && PIECE_BASE}
      </g>
    </svg>
  );
}
