import { PerspectiveCamera } from '@react-three/drei';
import type * as THREE from 'three';
import type { PieceColor, PieceType } from '../../pieceSilhouettes';
import {
  BISHOP_BODY_GEOMETRY,
  BISHOP_FINIAL_GEOMETRY,
  BISHOP_FINIAL_Y,
  KING_BODY_GEOMETRY,
  KING_CROSS_HORIZONTAL_GEOMETRY,
  KING_CROSS_VERTICAL_GEOMETRY,
  KING_CROSS_Y,
  KNIGHT_BODY_GEOMETRY,
  KNIGHT_STEM_GEOMETRY,
  PAWN_BODY_GEOMETRY,
  QUEEN_BODY_GEOMETRY,
  QUEEN_CROWN_POINT_COUNT,
  QUEEN_CROWN_POINT_GEOMETRY,
  QUEEN_CROWN_RING_RADIUS,
  QUEEN_CROWN_RING_Y,
  ROOK_BODY_GEOMETRY,
  ROOK_CAP_GEOMETRY,
  ROOK_MERLON_COUNT,
  ROOK_MERLON_GEOMETRY,
  ROOK_MERLON_RING_RADIUS,
  ROOK_TOP_Y,
  SHADOW_DECAL_GEOMETRY,
} from './geometry';
import { BLACK_METAL, SHADOW_DECAL_MATERIAL, WHITE_METAL } from './materials';

type PieceMeshProps = {
  type: PieceType;
  color: PieceColor;
};

// drei's `<PerspectiveCamera>` doesn't aim itself at anything — it just
// applies `position`/`rotation` straight to the underlying THREE camera, so
// an elevated, offset position with no explicit rotation looks in whatever
// direction the camera's default orientation happens to be, not at the
// piece (this was the actual cause of the knight rendering as a clipped
// sliver: the camera wasn't pointed at the geometry at all). Kept on the
// symmetric Y-Z plane (no X offset) so a plain X-axis pitch is enough to
// aim it, computed once here rather than hand-tuned as a literal Euler
// angle so moving the camera doesn't silently un-aim it.
// fov=42 at this distance comfortably frames the full 0-40 unit height range
// (the king's cross, the tallest feature on any piece, tops out around 40) —
// an earlier, tighter fov=24 clipped the king's cross and the rook's
// crenellations clean out of frame, since it only covered roughly y=3-29.
const CAMERA_POSITION: [number, number, number] = [0, 34, 62];
const CAMERA_FOV = 42;
const CAMERA_TARGET_Y = 20;
const CAMERA_PITCH = Math.atan2(CAMERA_TARGET_Y - CAMERA_POSITION[1], CAMERA_POSITION[2]);

/** Every piece uses the same fixed elevated camera and the same small
 * light rig — declared inside each piece's own `<View>` rather than once
 * at a shared scene level, since drei's `View` portals each tracked piece
 * into its own independent `THREE.Scene` (confirmed against drei's source
 * while planning this): a light declared outside a given piece's `View`
 * simply never reaches it. All plain numbers, no textures, so repeating
 * this per piece (up to 32 on screen) is effectively free. */
function Rig() {
  return (
    <>
      <PerspectiveCamera makeDefault fov={CAMERA_FOV} position={CAMERA_POSITION} rotation={[CAMERA_PITCH, 0, 0]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[20, 30, 20]} intensity={1.8} />
      <pointLight position={[-14, 14, 20]} intensity={0.3} />
    </>
  );
}

function ShadowDecal() {
  return (
    <mesh geometry={SHADOW_DECAL_GEOMETRY} material={SHADOW_DECAL_MATERIAL} rotation-x={-Math.PI / 2} position-y={0.05} />
  );
}

function Pawn({ metal }: { metal: THREE.Material }) {
  return (
    <>
      <mesh geometry={PAWN_BODY_GEOMETRY} material={metal} />
      <ShadowDecal />
    </>
  );
}

function Rook({ metal }: { metal: THREE.Material }) {
  const merlons = Array.from({ length: ROOK_MERLON_COUNT }, (_, i) => {
    const angle = (i / ROOK_MERLON_COUNT) * Math.PI * 2;
    return (
      <mesh
        key={i}
        geometry={ROOK_MERLON_GEOMETRY}
        material={metal}
        position={[Math.cos(angle) * ROOK_MERLON_RING_RADIUS, ROOK_TOP_Y + 1.5, Math.sin(angle) * ROOK_MERLON_RING_RADIUS]}
        rotation-y={-angle}
      />
    );
  });
  return (
    <>
      <mesh geometry={ROOK_BODY_GEOMETRY} material={metal} />
      <mesh geometry={ROOK_CAP_GEOMETRY} material={metal} rotation-x={-Math.PI / 2} position-y={ROOK_TOP_Y} />
      {merlons}
      <ShadowDecal />
    </>
  );
}

function Knight({ metal }: { metal: THREE.Material }) {
  return (
    <>
      <mesh geometry={KNIGHT_STEM_GEOMETRY} material={metal} />
      <mesh geometry={KNIGHT_BODY_GEOMETRY} material={metal} />
      <ShadowDecal />
    </>
  );
}

function Bishop({ metal }: { metal: THREE.Material }) {
  return (
    <>
      <mesh geometry={BISHOP_BODY_GEOMETRY} material={metal} />
      <mesh geometry={BISHOP_FINIAL_GEOMETRY} material={metal} position-y={BISHOP_FINIAL_Y} />
      <ShadowDecal />
    </>
  );
}

function Queen({ metal }: { metal: THREE.Material }) {
  const points = Array.from({ length: QUEEN_CROWN_POINT_COUNT }, (_, i) => {
    const angle = (i / QUEEN_CROWN_POINT_COUNT) * Math.PI * 2;
    return (
      <mesh
        key={i}
        geometry={QUEEN_CROWN_POINT_GEOMETRY}
        material={metal}
        position={[Math.cos(angle) * QUEEN_CROWN_RING_RADIUS, QUEEN_CROWN_RING_Y, Math.sin(angle) * QUEEN_CROWN_RING_RADIUS]}
      />
    );
  });
  return (
    <>
      <mesh geometry={QUEEN_BODY_GEOMETRY} material={metal} />
      {points}
      <ShadowDecal />
    </>
  );
}

function King({ metal }: { metal: THREE.Material }) {
  return (
    <>
      <mesh geometry={KING_BODY_GEOMETRY} material={metal} />
      <mesh geometry={KING_CROSS_VERTICAL_GEOMETRY} material={metal} position-y={KING_CROSS_Y} />
      <mesh geometry={KING_CROSS_HORIZONTAL_GEOMETRY} material={metal} position-y={KING_CROSS_Y + 1} />
      <ShadowDecal />
    </>
  );
}

const PIECE_COMPONENTS: Record<PieceType, (props: { metal: THREE.Material }) => React.JSX.Element> = {
  p: Pawn,
  r: Rook,
  n: Knight,
  b: Bishop,
  q: Queen,
  k: King,
};

export function PieceMesh({ type, color }: PieceMeshProps) {
  const metal = color === 'w' ? WHITE_METAL : BLACK_METAL;
  const Body = PIECE_COMPONENTS[type];
  return (
    <>
      <Rig />
      <Body metal={metal} />
    </>
  );
}
