import * as THREE from 'three';

/**
 * Two shared metal materials, one per side — built once and reused across
 * every mesh of every piece of that color, never per-instance. Colors are
 * the mid-tones of the existing flat sets' own metallic gradients (see
 * `pieceSilhouettes.tsx`'s white/black `linearGradient` stops), so this set
 * reads as the same family rather than a mismatched add-on.
 */
// Metalness capped well below "mirror" (0.85 was tried first, per the
// initial plan, and rendered nearly black at real board scale: a PBR
// material's diffuse response scales down with `1 - metalness`, and with no
// environment map providing reflected ambient light — skipped deliberately,
// see `PieceMesh.tsx` — there's nothing left to light a highly metallic
// surface but small direct-light specular highlights. Lower metalness here
// trades a little "shine" for the material actually being visible.
export const WHITE_METAL = new THREE.MeshStandardMaterial({
  color: '#cabf9e',
  metalness: 0.35,
  roughness: 0.45,
});

export const BLACK_METAL = new THREE.MeshStandardMaterial({
  color: '#3a3630',
  metalness: 0.3,
  roughness: 0.5,
});

/** A flat, semi-transparent dark decal under each piece — fakes contact
 * shadow/grounding far cheaper than a real-time shadow map repeated across
 * up to 32 simultaneous independent piece scenes (see `PieceMesh.tsx`). */
export const SHADOW_DECAL_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#000000',
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
