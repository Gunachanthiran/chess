import type { PieceRenderObject } from 'react-chessboard';

/**
 * Photorealistic bronze/pewter Roman legionary miniatures, supplied by the
 * user (their own photographed pieces) rather than drawn for this app —
 * a fundamentally different medium from every other set here, which are all
 * flat hand-authored SVG (see `pieceSilhouettes.tsx`). These are raster
 * `<img>` crops from one photo sheet (bronze finish for Black, pewter/silver
 * for White), background-removed to transparent PNG.
 *
 * The photo sheet didn't have a matched pair for every piece: the pawn's
 * two finishes are actually different sculpts (a standard-bearer in bronze,
 * a plain soldier in silver — both real, just not the same design), and
 * there was no silver bishop at all. `w_bishop.png` is therefore not a
 * separate photograph — it's the bronze bishop image run through a
 * desaturate+brighten filter (see the one-off script in this session's
 * history) calibrated against the sheet's own real bronze/silver pairs
 * (rook, queen, knight) until its tone matched. An approximation, not a
 * substitute for a real photographed silver piece, kept only until a real
 * one is supplied.
 */

const BASE_PATH = '/pieces/roman-luxury';

function piece(finish: 'b' | 'w', type: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king') {
  return () => (
    <img
      src={`${BASE_PATH}/${finish}_${type}.png`}
      alt=""
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        filter: 'drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45))',
        pointerEvents: 'none',
      }}
    />
  );
}

export const ROMAN_LUXURY_PIECES: PieceRenderObject = {
  wP: piece('w', 'pawn'),
  bP: piece('b', 'pawn'),
  wR: piece('w', 'rook'),
  bR: piece('b', 'rook'),
  wN: piece('w', 'knight'),
  bN: piece('b', 'knight'),
  wB: piece('w', 'bishop'),
  bB: piece('b', 'bishop'),
  wQ: piece('w', 'queen'),
  bQ: piece('b', 'queen'),
  wK: piece('w', 'king'),
  bK: piece('b', 'king'),
};
