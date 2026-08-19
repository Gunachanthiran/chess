import { PIECE_SETS, PIECE_SET_ORDER, usePieceSet } from '../../lib/pieceSet';
import { LINE_ART_PIECES } from '../../lib/pieceSets/lineArt';

/** A small preview of one set's king, used as that option's own icon —
 * react-chessboard's bundled set has no standalone export, so "Classic"
 * previews with a plain figurine glyph instead of rendering the real thing
 * twice. */
function SetPreview({ pieceSet }: { pieceSet: 'classic' | 'line' }) {
  if (pieceSet === 'line') {
    const King = LINE_ART_PIECES.wK;
    return (
      <span className="piece-swatch__preview" aria-hidden="true">
        <King />
      </span>
    );
  }
  return (
    <span className="piece-swatch__preview piece-swatch__preview--glyph" aria-hidden="true">
      ♔
    </span>
  );
}

/**
 * Row of small preview buttons for the site-wide piece art style, sized to
 * sit next to `BoardThemePicker` in the same controls row. Reads and writes
 * `usePieceSet()`, so the pages that render it need no piece-set wiring.
 */
export function PieceSetPicker() {
  const { pieceSet, setPieceSet } = usePieceSet();

  return (
    <div className="theme-picker" role="group" aria-label="Piece style">
      {PIECE_SET_ORDER.map((option) => {
        const info = PIECE_SETS[option];
        const isActive = option === pieceSet;
        return (
          <button
            key={option}
            type="button"
            className={`theme-swatch${isActive ? ' theme-swatch--active' : ''}`}
            onClick={() => setPieceSet(option)}
            title={`${info.label} pieces`}
            aria-label={`${info.label} piece style`}
            aria-pressed={isActive}
          >
            <SetPreview pieceSet={option} />
          </button>
        );
      })}
    </div>
  );
}
