import { View } from '@react-three/drei';
import type { PieceColor, PieceType } from '../../pieceSilhouettes';
import { PieceMesh } from './PieceMesh';

/**
 * One piece's tracked `<View>` + mesh — split out from `index.tsx` so that
 * file can stay a lightweight `React.lazy()` boundary. This is the module
 * that actually pulls in `@react-three/drei`/`@react-three/fiber`/`three`,
 * and it should only ever load once someone actually selects the 3D piece
 * set — see `index.tsx`.
 */
export default function PieceView({ type, color }: { type: PieceType; color: PieceColor }) {
  // `position: absolute; inset: 0` rather than `width/height: 100%`: none of
  // react-chessboard's own intermediate wrapper divs (the dnd-kit draggable
  // wrapper especially) set an explicit height, so a plain percentage-sized
  // div collapses to 0 there — the SVG/photo piece sets don't hit this
  // because a replaced element (`<svg>`/`<img>`) with a known intrinsic
  // aspect ratio resolves its own height from its width even inside an
  // indefinite-height chain; a plain `<div>` has no such fallback. The
  // square itself (`react-chessboard`'s own square element) is
  // `position: relative`, so anchoring to that directly sidesteps the
  // collapsed intermediate wrappers entirely.
  return (
    <View style={{ position: 'absolute', inset: 0 }}>
      <PieceMesh type={type} color={color} />
    </View>
  );
}
