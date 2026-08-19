import type { PieceRenderObject } from 'react-chessboard';

/**
 * An original, deliberately simplified piece set — clean flat silhouettes
 * distinguished mainly by their "topper" (a crown, a cross, a crenellated
 * turret, a slit ball...), the same way pieces actually read at a glance on
 * a real board, rather than an attempt at photorealistic Staunton detail.
 * Every path here is hand-authored for this app; nothing is traced from an
 * existing piece set.
 *
 * Shares one coordinate system (viewBox 0 0 45 45, the same convention
 * react-chessboard's own bundled set uses) and one shared base plinth, so
 * every piece sits at a consistent height and scale next to the others.
 */

type PieceProps = { fill?: string; svgStyle?: React.CSSProperties } | undefined;

const WHITE_FILL = '#f4f1ea';
const WHITE_STROKE = '#2a2a2a';
const BLACK_FILL = '#2a2a2a';
const BLACK_STROKE = '#f4f1ea';

const BASE = <rect x="9" y="36.5" width="27" height="4" rx="1.3" />;

function pieceSvg(color: 'w' | 'b', shapes: React.ReactNode) {
  return (props: PieceProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 45 45"
      width="100%"
      height="100%"
      style={props?.svgStyle}
    >
      <g
        style={{
          fill: props?.fill ?? (color === 'w' ? WHITE_FILL : BLACK_FILL),
          stroke: color === 'w' ? WHITE_STROKE : BLACK_STROKE,
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }}
      >
        {shapes}
        {BASE}
      </g>
    </svg>
  );
}

const PAWN_BODY = (
  <>
    <circle cx="22.5" cy="13" r="5" />
    <path d="M16,38 C16,29 19,22 22.5,20 C26,22 29,29 29,38 Z" />
  </>
);

const ROOK_BODY = (
  <path d="M13,10 L17,10 L17,13 L20,13 L20,10 L25,10 L25,13 L28,13 L28,10 L32,10 L32,38 L13,38 Z" />
);

const KNIGHT_BODY = (
  <path d="M14,38 L14,30 C14,26 16,23 18,21 L15,17 C15,14 17,11 20,10 L23,14 L27,11 C30,11 33,14 33,18 C33,21 31,23 28,23 L30,26 L30,38 Z" />
);

const BISHOP_BODY = (
  <>
    <circle cx="22.5" cy="8" r="1.8" />
    <circle cx="22.5" cy="15" r="4.8" />
    <path d="M14,38 C14,29 18,24 22.5,21 C27,24 31,29 31,38 Z" />
  </>
);

// A bold zigzag crown (five triangular points) reads clearly at board scale;
// five separate small circles did not.
const QUEEN_BODY = (
  <>
    <path d="M14,14 L17,6 L20,13 L22.5,5 L25,13 L28,6 L31,14 Z" />
    <rect x="14" y="14" width="17" height="2.6" rx="1" />
    <path d="M14,38 C14,29 18,21 22.5,18 C27,21 31,29 31,38 Z" />
  </>
);

const KING_BODY = (
  <>
    <rect x="20" y="1.5" width="5" height="10.5" />
    <rect x="16.5" y="4.75" width="12" height="5" />
    <circle cx="22.5" cy="18" r="4" />
    <path d="M14,38 C14,29 18,22 22.5,20 C27,22 31,29 31,38 Z" />
  </>
);

export const LINE_ART_PIECES: PieceRenderObject = {
  wP: pieceSvg('w', PAWN_BODY),
  bP: pieceSvg('b', PAWN_BODY),
  wR: pieceSvg('w', ROOK_BODY),
  bR: pieceSvg('b', ROOK_BODY),
  wN: pieceSvg('w', KNIGHT_BODY),
  bN: pieceSvg('b', KNIGHT_BODY),
  wB: pieceSvg('w', BISHOP_BODY),
  bB: pieceSvg('b', BISHOP_BODY),
  wQ: pieceSvg('w', QUEEN_BODY),
  bQ: pieceSvg('b', QUEEN_BODY),
  wK: pieceSvg('w', KING_BODY),
  bK: pieceSvg('b', KING_BODY),
};
