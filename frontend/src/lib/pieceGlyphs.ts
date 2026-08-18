/** Unicode chess figurine glyphs, shared by anywhere a piece needs a small
 * icon rather than a letter — the analysis recommendations panel's move
 * text, and the captured-pieces trays. */
export const PIECE_GLYPHS = {
  white: { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' },
  black: { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' },
} as const;

export type PieceLetter = keyof typeof PIECE_GLYPHS.white;
