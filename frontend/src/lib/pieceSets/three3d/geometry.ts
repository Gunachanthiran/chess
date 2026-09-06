import * as THREE from 'three';

/**
 * Procedural Staunton-style piece geometry — no external model files. Every
 * body is a `LatheGeometry` (a 2D profile revolved around the Y axis), built
 * once here at module load and shared by every on-screen instance of that
 * piece (white and black reuse the same geometry, only the material
 * differs) — see `materials.ts`.
 *
 * Profiles are built bottom-to-top with `x >= 0` throughout (a `LatheGeometry`
 * requirement) and always closed to a point (`x === 0`) at the very top, so
 * the revolved mesh has no open hole facing the camera. The one piece that
 * needs a genuinely flat top (the rook, for its crenellations) caps the lathe
 * with a separate flat disc instead of closing to a point.
 */

const LATHE_SEGMENTS = 28;

/** Points along a circular arc, used for the rounded heads/domes every
 * piece but the rook tops out with — smooth without needing to hand-author
 * dozens of literal coordinates. Degrees, measured from the positive X axis
 * (0 = equator/widest point, 90 = top pole, x=0). */
function arcPoints(centerY: number, radius: number, fromDeg: number, toDeg: number, segments: number): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = fromDeg + ((toDeg - fromDeg) * i) / segments;
    const rad = (t * Math.PI) / 180;
    points.push(new THREE.Vector2(Math.max(0, radius * Math.cos(rad)), centerY + radius * Math.sin(rad)));
  }
  return points;
}

/** Shared base/stem, common to every piece for a consistent footprint —
 * echoes the flat shared plinth (`PIECE_BASE`) the flat SVG set uses. */
function baseAndStem(): THREE.Vector2[] {
  return [
    new THREE.Vector2(12.5, 0),
    new THREE.Vector2(12.5, 2.5),
    new THREE.Vector2(8.5, 5),
    new THREE.Vector2(6, 7.5),
    new THREE.Vector2(6, 10),
    new THREE.Vector2(8, 12.5),
  ];
}

function lathe(points: THREE.Vector2[]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points, LATHE_SEGMENTS);
}

// ---------- Pawn — deliberately the smallest, plainest body ----------
export const PAWN_BODY_GEOMETRY = lathe([
  ...baseAndStem(),
  new THREE.Vector2(6.5, 15),
  new THREE.Vector2(6.5, 17),
  ...arcPoints(20, 6, 180, 90, 10), // neck curving up into the head
  ...arcPoints(20, 6, 90, -80, 14), // round head, closes near x=0
]);

// ---------- Rook — tapered tower, flat-capped for crenellations ----------
export const ROOK_BODY_GEOMETRY = lathe([
  ...baseAndStem(),
  new THREE.Vector2(9, 15),
  new THREE.Vector2(9.5, 28),
  new THREE.Vector2(10.5, 30), // slight outward lip just under the cap
  new THREE.Vector2(10.5, 32),
]);
export const ROOK_CAP_GEOMETRY = new THREE.CircleGeometry(10.5, LATHE_SEGMENTS);
export const ROOK_MERLON_GEOMETRY = new THREE.BoxGeometry(3.4, 4, 3);
export const ROOK_MERLON_COUNT = 8;
export const ROOK_MERLON_RING_RADIUS = 8.4;
export const ROOK_TOP_Y = 32;

// ---------- Knight — the one non-lathe piece: an extruded horse-head ----------
function knightProfileShape(): THREE.Shape {
  const shape = new THREE.Shape();
  // A stylised horse-head-and-neck silhouette, traced in the XY plane,
  // roughly 24 wide x 30 tall, centered so it extrudes symmetrically.
  shape.moveTo(-5, 0);
  shape.lineTo(-6, 6);
  shape.quadraticCurveTo(-7, 12, -4, 16); // neck curving forward
  shape.quadraticCurveTo(0, 20, 2, 24); // rising toward the head
  shape.quadraticCurveTo(4, 27, 9, 27); // muzzle top
  shape.quadraticCurveTo(11, 27, 11, 24.5); // nose tip
  shape.quadraticCurveTo(9.5, 23.5, 7.5, 23.5); // chin
  shape.quadraticCurveTo(5, 22.5, 4.5, 20); // jawline back
  shape.lineTo(3, 18);
  shape.quadraticCurveTo(6, 17.5, 6.5, 20.5); // ear
  shape.quadraticCurveTo(7, 22, 5.5, 22.5);
  shape.quadraticCurveTo(2, 19, 0, 15); // mane down the back of the neck
  shape.quadraticCurveTo(-1, 11, 2, 8);
  shape.quadraticCurveTo(4, 6, 3, 3);
  shape.lineTo(6, 0);
  shape.closePath();
  return shape;
}

export const KNIGHT_BODY_GEOMETRY = new THREE.ExtrudeGeometry(knightProfileShape(), {
  depth: 7,
  bevelEnabled: true,
  bevelThickness: 0.6,
  bevelSize: 0.6,
  bevelSegments: 2,
  curveSegments: 12,
});
KNIGHT_BODY_GEOMETRY.center();
KNIGHT_BODY_GEOMETRY.translate(0, 15.5, 0); // sits on the shared base/stem
export const KNIGHT_STEM_GEOMETRY = lathe(baseAndStem());

// ---------- Bishop — tall mitre with a collar, topped with a small ball ----------
export const BISHOP_BODY_GEOMETRY = lathe([
  ...baseAndStem(),
  new THREE.Vector2(7, 16),
  new THREE.Vector2(9.5, 18.5), // collar
  new THREE.Vector2(9.5, 19.5),
  new THREE.Vector2(6, 22),
  new THREE.Vector2(5.5, 30),
  ...arcPoints(30, 5.5, 90, -85, 10), // mitre taper, near-point top
]);
export const BISHOP_FINIAL_GEOMETRY = new THREE.SphereGeometry(2.4, 16, 12);
export const BISHOP_FINIAL_Y = 36.5;

// ---------- Queen — wide crown ring topped with small spheres ----------
export const QUEEN_BODY_GEOMETRY = lathe([
  ...baseAndStem(),
  new THREE.Vector2(7, 15),
  new THREE.Vector2(7, 18),
  new THREE.Vector2(10.5, 21), // crown widening out
  new THREE.Vector2(10.5, 24),
  new THREE.Vector2(8.5, 26),
  ...arcPoints(26, 5, 90, 0, 10),
]);
export const QUEEN_CROWN_POINT_GEOMETRY = new THREE.SphereGeometry(2.1, 12, 10);
export const QUEEN_CROWN_POINT_COUNT = 6;
export const QUEEN_CROWN_RING_RADIUS = 9;
export const QUEEN_CROWN_RING_Y = 22.5;

// ---------- King — tallest piece, crowned body topped with a cross ----------
export const KING_BODY_GEOMETRY = lathe([
  ...baseAndStem(),
  new THREE.Vector2(7, 16),
  new THREE.Vector2(7, 19),
  new THREE.Vector2(10, 22),
  new THREE.Vector2(10, 25),
  new THREE.Vector2(7.5, 28),
  ...arcPoints(28, 4.5, 90, 0, 10),
]);
export const KING_CROSS_VERTICAL_GEOMETRY = new THREE.BoxGeometry(2.2, 9, 2.2);
export const KING_CROSS_HORIZONTAL_GEOMETRY = new THREE.BoxGeometry(6.5, 2.2, 2.2);
export const KING_CROSS_Y = 36;

// ---------- Shared base-shadow decal ----------
export const SHADOW_DECAL_GEOMETRY = new THREE.CircleGeometry(13, 24);
