import { capturedPieces } from '../../lib/capturedPieces';
import { PIECE_GLYPHS } from '../../lib/pieceGlyphs';

type CapturedPiecesProps = {
  /** The position to read captures/material from — the board's own FEN. */
  fen: string;
  /** Which side's trophy row this is. */
  side: 'white' | 'black';
};

/**
 * A row of small captured-piece icons plus a "+N" material lead, the same
 * treatment chess.com/lichess use next to each player. Renders nothing once
 * that side has captured nothing yet, rather than an empty row.
 *
 * Captured pieces render in the *captured* piece's own colour — a row next
 * to White showing small black figurines is what reads as "these are black
 * pieces White took", not White's own pieces.
 */
export function CapturedPieces({ fen, side }: CapturedPiecesProps) {
  const { capturedByWhite, capturedByBlack, materialDiff } = capturedPieces(fen);
  const captured = side === 'white' ? capturedByWhite : capturedByBlack;
  const advantage = side === 'white' ? materialDiff : -materialDiff;
  const glyphs = side === 'white' ? PIECE_GLYPHS.black : PIECE_GLYPHS.white;

  if (captured.length === 0) return null;

  return (
    <span className="captured-pieces" aria-label={`Pieces captured by ${side}`}>
      {captured.map((letter, index) => (
        <span key={`${letter}-${index}`} className="captured-pieces__glyph" aria-hidden="true">
          {(glyphs as Record<string, string>)[letter]}
        </span>
      ))}
      {advantage > 0 && <span className="captured-pieces__advantage">+{advantage}</span>}
    </span>
  );
}
