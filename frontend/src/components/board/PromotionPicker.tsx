import { PieceSilhouette } from '../../lib/pieceSilhouettes';
import type { PieceColor } from '../../lib/pieceSilhouettes';

/** The four pieces a pawn can actually become — never a king or another pawn. */
export type PromotionChoice = 'q' | 'r' | 'b' | 'n';

const CHOICES: { piece: PromotionChoice; label: string }[] = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];

type PromotionPickerProps = {
  /** Colour of the pawn being promoted — decides which piece art (light/dark
   * fill) the four choices are drawn in. */
  color: PieceColor;
  onChoose: (piece: PromotionChoice) => void;
  /** Backing out entirely — the move is simply never submitted; the board
   * already snapped the pawn back to its origin square before this ever
   * opened (see `PlayBotPage`'s `handlePieceDrop`), so there is nothing else
   * to undo here. */
  onCancel: () => void;
};

/**
 * The chess.com/lichess-standard "which piece?" prompt for a promoting pawn.
 * A full-viewport backdrop rather than something anchored to the promotion
 * square: `ChessBoard` owns the board's own geometry and this component
 * deliberately doesn't reach into it, so a simple centred modal is the
 * option that needs no coordinate math and works identically at any board
 * size or orientation.
 */
export function PromotionPicker({ color, onChoose, onCancel }: PromotionPickerProps) {
  return (
    <div className="promotion-picker__backdrop" onClick={onCancel}>
      <div
        className="panel promotion-picker"
        // Stops a click *inside* the picker from bubbling to the backdrop
        // and cancelling the very choice being made.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel__header">Promote to</div>
        <div className="promotion-picker__choices">
          {CHOICES.map(({ piece, label }) => (
            <button
              key={piece}
              type="button"
              className="promotion-picker__choice"
              onClick={() => onChoose(piece)}
              title={label}
              aria-label={`Promote to ${label}`}
            >
              <PieceSilhouette type={piece} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
