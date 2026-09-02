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
 * Roman-themed, in the same spirit as a classic pewter Roman Empire chess
 * set (a standard-bearing king, a robed queen, a helmeted centurion in place
 * of a bishop, a rearing-horse knight, a fluted column for a rook, a small
 * legionary pawn) — reinterpreted as flat single-colour silhouettes rather
 * than an attempt at sculptural, photorealistic detail, the same
 * "deliberately simplified" philosophy this file has always used, just on a
 * new theme. Every path here is hand-authored for this app; nothing is
 * traced from an existing piece set or a specific manufactured product.
 *
 * One shared coordinate system (viewBox 0 0 45 45) and one shared base
 * plinth — the same convention react-chessboard's own bundled set uses —
 * keeps every piece at a consistent height and scale.
 */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PieceColor = 'w' | 'b';

const WHITE_FILL = '#f4f1ea';
const WHITE_STROKE = '#2a2a2a';
const BLACK_FILL = '#2a2a2a';
const BLACK_STROKE = '#f4f1ea';

export const PIECE_BASE = <rect x="9" y="36.5" width="27" height="4" rx="1.3" />;

// Deliberately the smallest, plainest silhouette of the six — everything
// else is sized and detailed *relative to this baseline*, the same way a
// real Staunton set makes the pawn unmistakably "the small plain one" so it
// never gets confused with a piece that actually has a distinguishing
// feature. An earlier pass gave this a helmet ridge like the bishop's, which
// was exactly the mistake: at board scale the two read as the same piece.
const PAWN_BODY = (
  <>
    <circle cx="22.5" cy="17.5" r="4.2" />
    <path d="M18,38 C18,32 19.8,28 22.5,26.7 C25.2,28 27,32 27,38 Z" />
  </>
);

// A fluted classical column, not a crenellated tower — the "rook" of a
// Roman-themed set, per the reference set this theme is drawn from: a
// stepped capital, a shaft with two flute lines for texture, and a flared
// base sitting on the shared plinth.
const ROOK_BODY = (
  <>
    <path d="M15.5,9.5 C15.5,7.5 17.7,6 20.4,6 L24.6,6 C27.3,6 29.5,7.5 29.5,9.5 L29.5,11.3 L15.5,11.3 Z" />
    <rect x="17.5" y="11.3" width="10" height="2.6" rx="0.8" />
    <rect x="18.7" y="14.4" width="7.6" height="19.6" />
    <line x1="20.7" y1="15.5" x2="20.7" y2="33" fill="none" />
    <line x1="24.3" y1="15.5" x2="24.3" y2="33" fill="none" />
    <rect x="15.8" y="34.5" width="13.4" height="2.8" rx="0.8" />
  </>
);

// Unchanged from the original set: already a clean, recognisable rearing
// horse/knight silhouette at board scale, so the Roman redesign leaves it
// alone rather than risk a "improvement" that reads worse in play.
const KNIGHT_BODY = (
  <path d="M14,38 L14,30 C14,26 16,23 18,21 L15,17 C15,14 17,11 20,10 L23,14 L27,11 C30,11 33,14 33,18 C33,21 31,23 28,23 L30,26 L30,38 Z" />
);

// A centurion in place of the traditional mitred bishop: a helmet dome
// noticeably *wider* than the pawn's plain head (width, not just added
// detail, is what actually survives being shrunk to board scale), a bold
// crest, and a sword — one solid tapered blade shape, not a thin outline —
// held point-down in front. Every one of these three features is sized to
// still read on its own; the first version's crest and blade were both thin
// enough to disappear into the stroke outline at real board size.
const BISHOP_BODY = (
  <>
    <path d="M22.5,0 L26,7 L22.5,9 L19,7 Z" />
    <path d="M22.5,3.4 C27.2,3.4 30.6,7 30.6,11.2 L30.6,12.4 C32,13 32.8,14.1 32.8,15.4 L32.8,17 L12.2,17 L12.2,15.4 C12.2,14.1 13,13 14.4,12.4 L14.4,11.2 C14.4,7 17.8,3.4 22.5,3.4 Z" />
    <path d="M16,38 L16,25.5 C16,19 18.7,14.6 22.5,12.8 C26.3,14.6 29,19 29,25.5 L29,38 Z" />
    <path d="M22.5,12 L25.6,15.5 L23.6,15.5 L23.6,33 L21.4,33 L21.4,15.5 L19.4,15.5 Z" />
    <rect x="17" y="10.6" width="11" height="3" rx="1" />
  </>
);

// Taller than the bishop and topped with the widest head silhouette of the
// six — a big rounded hood/veil, wider than the bishop's helmet dome and
// with no crest or weapon on it — so width and softness are what read as
// "queen" instead of a smaller, subtler version of the centurion next to her.
const QUEEN_BODY = (
  <>
    <path d="M10.5,10.5 C10.5,4 15.7,0 22.5,0 C29.3,0 34.5,4 34.5,10.5 L34.5,12 C34.5,13.3 33.2,14.2 31.5,14.2 L13.5,14.2 C11.8,14.2 10.5,13.3 10.5,12 Z" />
    <circle cx="22.5" cy="16.2" r="5.4" />
    <path d="M14.5,38 L14.5,29.5 C14.5,22.5 17.8,17 22.5,14.7 C27.2,17 30.5,22.5 30.5,29.5 L30.5,38 Z" />
  </>
);

// The tallest piece on the board, via a bold staff (a thick shaft and a big
// orb, not a hairline that vanishes at board scale) standing well above
// every other piece's own tallest point — the one silhouette cue proven to
// survive simplification, rather than a crown-on-head convention that
// doesn't.
const KING_BODY = (
  <>
    <rect x="29.6" y="0.3" width="2.8" height="22" rx="1.2" />
    <circle cx="31" cy="1.6" r="3.1" />
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

/** One piece, drawn from the shared body/base shapes above. */
export function PieceSilhouette({
  type,
  color,
  fill,
  svgStyle,
  includeBase = true,
}: PieceSilhouetteProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" width="100%" height="100%" style={svgStyle}>
      <g
        style={{
          fill: fill ?? (color === 'w' ? WHITE_FILL : BLACK_FILL),
          stroke: color === 'w' ? WHITE_STROKE : BLACK_STROKE,
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }}
      >
        {PIECE_BODY[type]}
        {includeBase && PIECE_BASE}
      </g>
    </svg>
  );
}
