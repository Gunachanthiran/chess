import { PIECE_SETS, PIECE_SET_ORDER, usePieceSet, type PieceSet } from '../../lib/pieceSet';
import { useWebglSupported } from '../../lib/pieceSets/three3d/webglSupport';

/** A small preview of one set's king, used as that option's own icon —
 * react-chessboard's bundled set has no standalone export, so "Classic"
 * previews with a plain figurine glyph instead of rendering the real thing
 * twice. The 3D set also uses the glyph here deliberately, even though it
 * has a real `pieces.wK` — rendering it would load and spin up the whole
 * WebGL canvas just for a decorative swatch nobody may ever pick. Every
 * other set renders its real `pieces.wK` directly. */
function SetPreview({ pieceSet }: { pieceSet: PieceSet }) {
  const King = pieceSet === 'three3d' ? undefined : PIECE_SETS[pieceSet].pieces?.wK;
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
  const webglSupported = useWebglSupported();
  // Never offer "3D" on a browser that can't actually run it — nobody
  // should be able to pick a visibly-broken option from this list.
  const options = webglSupported ? PIECE_SET_ORDER : PIECE_SET_ORDER.filter((option) => option !== 'three3d');

  return (
    <div className="theme-picker" role="group" aria-label="Piece style">
      {options.map((option) => {
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
