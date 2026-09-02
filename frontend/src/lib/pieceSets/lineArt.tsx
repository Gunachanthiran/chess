import type { PieceRenderObject } from 'react-chessboard';
import { PieceSilhouette } from '../pieceSilhouettes';
import type { PieceColor, PieceType } from '../pieceSilhouettes';

/**
 * An original, deliberately simplified piece set — clean flat silhouettes
 * distinguished mainly by their "topper" (a crown, a cross, a crenellated
 * turret, a slit ball...), the same way pieces actually read at a glance on
 * a real board, rather than an attempt at photorealistic Staunton detail.
 * Every path here is hand-authored for this app; nothing is traced from an
 * existing piece set.
 *
 * The actual shapes live in `lib/pieceSilhouettes.tsx`, shared with the
 * board's capture-cut effect (`ChessBoard.tsx`) so a sliced piece always
 * matches this same silhouette regardless of which set is on screen — this
 * file just adapts them to `react-chessboard`'s `PieceRenderObject` shape.
 */

type PieceProps = { fill?: string; svgStyle?: React.CSSProperties } | undefined;

function piece(type: PieceType, color: PieceColor) {
  return (props: PieceProps) => (
    <PieceSilhouette type={type} color={color} fill={props?.fill} svgStyle={props?.svgStyle} />
  );
}

export const LINE_ART_PIECES: PieceRenderObject = {
  wP: piece('p', 'w'),
  bP: piece('p', 'b'),
  wR: piece('r', 'w'),
  bR: piece('r', 'b'),
  wN: piece('n', 'w'),
  bN: piece('n', 'b'),
  wB: piece('b', 'w'),
  bB: piece('b', 'b'),
  wQ: piece('q', 'w'),
  bQ: piece('q', 'b'),
  wK: piece('k', 'w'),
  bK: piece('k', 'b'),
};
