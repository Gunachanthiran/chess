import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import { reportWebglUnavailable } from './webglSupport';

/**
 * The one real `<canvas>`/WebGL context for every 3D piece on the board.
 * Mounted once by `ChessBoard.tsx`, only while the "3D" piece set is active.
 *
 * Each piece (see `index.tsx`) renders its own `<View>` wherever
 * react-chessboard puts that square's content — `View` (used outside a
 * Canvas) renders the actual tracked DOM node in place there and tunnels
 * its 3D children here via `<View.Port />`, which portals every currently
 * mounted `View` into its own scissored rect of this one shared canvas.
 * This is what keeps a full board (up to 32 pieces, plus a drag-clone) to
 * exactly one WebGL context instead of one per piece — real browsers still
 * enforce a hard, low per-page context ceiling.
 *
 * Fixed, full-viewport, and `pointer-events: none`: it only ever paints
 * over the real board, and every actual click/drag still lands on the
 * plain DOM tracking node underneath, so react-chessboard's own
 * drag-and-drop and click-to-move are completely undisturbed.
 */
export function PieceCanvasRoot() {
  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 5 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        // Guarded on `isConnected`: navigating between pages unmounts this
        // canvas and mounts a fresh one for the next page, and that teardown
        // routinely fires a `webglcontextlost` event on the *old*, already-
        // detached canvas — confirmed while testing this (plain route
        // navigation reliably logged "THREE.WebGLRenderer: Context Lost."
        // and permanently fell back to the flat set for the rest of the
        // session, on a browser that supports WebGL fine). That's normal
        // cleanup, not a real failure, so only a loss on a canvas still
        // actually in the DOM counts as the genuine mid-session case this
        // exists to catch.
        const handleLoss = () => {
          if (canvas.isConnected) reportWebglUnavailable();
        };
        canvas.addEventListener('webglcontextlost', handleLoss);
        canvas.addEventListener('webglcontextcreationerror', handleLoss);
      }}
    >
      <View.Port />
    </Canvas>
  );
}
