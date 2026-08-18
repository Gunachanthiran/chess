import type { PieceLetter } from './pieceGlyphs';

/** Pawn-unit values, matching the backend's `classification.PIECE_VALUES`
 * (kings excluded — they're never captured). */
const PIECE_VALUES: Record<Exclude<PieceLetter, 'K'>, number> = {
  Q: 9,
  R: 5,
  B: 3,
  N: 3,
  P: 1,
};

/** Full starting count of each piece type, per side. */
const STARTING_COUNTS: Record<Exclude<PieceLetter, 'K'>, number> = {
  Q: 1,
  R: 2,
  B: 2,
  N: 2,
  P: 8,
};

/** Value-descending display order — biggest trophies first, matching the
 * usual chess.com/lichess captured-piece tray convention. */
const DISPLAY_ORDER: Exclude<PieceLetter, 'K'>[] = ['Q', 'R', 'B', 'N', 'P'];

export type CapturedSummary = {
  /** Piece letters (uppercase) of the pieces White has captured from Black,
   * one entry per piece, value-descending. */
  capturedByWhite: string[];
  /** Same, for Black's captures from White. */
  capturedByBlack: string[];
  /** White's material lead in pawn-units — negative when Black is ahead. */
  materialDiff: number;
};

/**
 * Derives captured pieces and material balance purely from a FEN's board
 * field — no move-history dependency, so it works identically for the
 * analysis page's step-through position and the bot page's live one. A
 * piece is "captured by White" when fewer of that black piece type remain
 * on the board than the full starting set; the reverse for Black.
 */
export function capturedPieces(fen: string): CapturedSummary {
  const boardField = fen.split(' ')[0] ?? '';
  const counts: Record<string, number> = {};
  for (const char of boardField) {
    if ('pnbrqPNBRQ'.includes(char)) {
      counts[char] = (counts[char] ?? 0) + 1;
    }
  }

  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  let materialDiff = 0;

  for (const letter of DISPLAY_ORDER) {
    const whiteOnBoard = counts[letter] ?? 0;
    const blackOnBoard = counts[letter.toLowerCase()] ?? 0;
    const missingBlack = STARTING_COUNTS[letter] - blackOnBoard; // captured by White
    const missingWhite = STARTING_COUNTS[letter] - whiteOnBoard; // captured by Black

    for (let i = 0; i < missingBlack; i += 1) capturedByWhite.push(letter);
    for (let i = 0; i < missingWhite; i += 1) capturedByBlack.push(letter);

    materialDiff += (whiteOnBoard - blackOnBoard) * PIECE_VALUES[letter];
  }

  return { capturedByWhite, capturedByBlack, materialDiff };
}
