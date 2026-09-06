import { PIECE_SETS, PIECE_SET_ORDER, usePieceSet, type PieceSet } from '../../lib/pieceSet';

/** A small preview of one set's king, used as that option's own icon —
 * react-chessboard's bundled set has no standalone export, so "Classic"
 * previews with a plain figurine glyph instead of rendering the real thing
 * twice. Every other set has a real `pieces.wK` to render directly. */
function SetPreview({ pieceSet }: { pieceSet: PieceSet }) {
  const King = PIECE_SETS[pieceSet].pieces?.wK;
  if (King) {
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
