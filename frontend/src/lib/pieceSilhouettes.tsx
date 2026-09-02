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

// A small legionary: helmet (a plain head with a thin ridge standing in for
// a brow band — anything more detailed stopped reading as a helmet at all
// at board scale) over a simple robed/armoured body.
const PAWN_BODY = (
  <>
    <circle cx="22.5" cy="13" r="5" />
    <path
      d="M19.3,8.6 C19.3,6 20.7,4 22.5,4 C24.3,4 25.7,6 25.7,8.6"
      fill="none"
    />
    <path d="M16,38 C16,29 19,22.5 22.5,20.4 C26,22.5 29,29 29,38 Z" />
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

// A centurion in place of the traditional mitred bishop: a domed helmet
// with a small crest spike and cheek guards, a sword held point-down in
// front (a blade + crossguard), over a simple armoured robe.
const BISHOP_BODY = (
  <>
    <path d="M21.5,3 L22.5,0.4 L23.5,3 Z" />
    <path d="M22.5,2 C25.5,2 27.8,4.5 27.8,7.6 L27.8,8.6 C28.8,9 29.4,9.9 29.4,11 L29.4,12.2 L15.6,12.2 L15.6,11 C15.6,9.9 16.2,9 17.2,8.6 L17.2,7.6 C17.2,4.5 19.5,2 22.5,2 Z" />
    <path d="M17,38 L17,25 C17,19.5 19.2,15.8 22.5,14.4 C25.8,15.8 28,19.5 28,25 L28,38 Z" />
    <rect x="21" y="13.5" width="3" height="22" rx="1" />
    <rect x="18.5" y="13.5" width="8" height="2.2" rx="0.7" />
  </>
);

// A soft rounded hood/veil in place of a spiked crown — a Roman matron's
// headdress reads more like an arch than a zigzag, so this trades the old
// set's five-point crown for one continuous dome over the head.
const QUEEN_BODY = (
  <>
    <path d="M13.5,10 C13.5,4.5 17.5,1 22.5,1 C27.5,1 31.5,4.5 31.5,10 L31.5,11 C31.5,12 30.5,12.6 29.3,12.6 L15.7,12.6 C14.5,12.6 13.5,12 13.5,11 Z" />
    <circle cx="22.5" cy="13.5" r="4.4" />
    <path d="M15,37 C15,29 18,24 22.5,22 C27,24 30,29 30,37 Z" />
  </>
);

// A standard-bearer: the staff (topped with a small orb, the way a legion's
// standard reads at this scale better than an eagle would) stands beside the
// king rather than on his head, which is what actually distinguishes this
// piece from the queen at a glance — the crown-on-head convention doesn't
// survive simplification nearly as well as "this one is holding something."
const KING_BODY = (
  <>
    <rect x="29.2" y="1" width="1.8" height="19" rx="0.9" />
    <circle cx="30.1" cy="1.8" r="2.3" />
    <rect x="26.7" y="9" width="6.6" height="1.6" rx="0.6" />
    <circle cx="18.5" cy="9.5" r="5" />
    <path d="M9,23 C9,19 12.8,16.3 18.5,16.3 C24.2,16.3 28,19 28,23 L28,26.5 L9,26.5 Z" />
    <path d="M11,38 C11,29.5 13.7,24 18.5,22.3 C23.3,24 26,29.5 26,38 Z" />
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
