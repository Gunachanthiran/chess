/**
 * Estimated performance rating from a single game's accuracy.
 *
 * IMPORTANT — this is a rough heuristic, NOT a validated rating formula.
 *
 * ChessScope has no accounts and no tracked rating history, so there is no
 * ground truth to fit a real curve against. What this produces is a one-off
 * "how strong did this side play in this specific game" estimate, in the spirit
 * of the performance-rating figure chess sites show next to accuracy. It must
 * never be presented as a player's actual rating, which is why the UI labels it
 * "Estimated rating" rather than "Rating".
 *
 * The curve is a piecewise-linear interpolation between hand-picked reference
 * points. It is deliberately steep at the top: the difference between 95% and
 * 100% accuracy is the difference between a strong club game and an engine-like
 * one, whereas below ~50% accuracy the rating floor flattens out because a game
 * full of blunders tells you little beyond "well below club strength".
 */

/**
 * Reference points, ordered by ascending accuracy. Interpolation walks this
 * array, so the ordering is load-bearing — keep it sorted if you edit it.
 */
const REFERENCE_POINTS: ReadonlyArray<{ accuracy: number; rating: number }> = [
  { accuracy: 0, rating: 300 },
  { accuracy: 40, rating: 450 },
  { accuracy: 50, rating: 600 },
  { accuracy: 60, rating: 900 },
  { accuracy: 70, rating: 1200 },
  { accuracy: 75, rating: 1400 },
  { accuracy: 80, rating: 1600 },
  { accuracy: 85, rating: 1800 },
  { accuracy: 90, rating: 2000 },
  { accuracy: 95, rating: 2400 },
  { accuracy: 100, rating: 2900 },
];

/**
 * Maps an accuracy percentage (0-100) to an estimated performance rating.
 *
 * Values outside 0-100 clamp to the endpoints, so a NaN-free number always
 * comes back in [300, 2900]. The result is rounded to a whole rating point —
 * decimals would imply a precision this heuristic does not have.
 *
 * Sanity checks (this project has no frontend test runner configured, so these
 * are documented rather than asserted):
 *   estimatePerformanceRating(100) === 2900   // top anchor
 *   estimatePerformanceRating(0)   === 300    // bottom anchor
 *   estimatePerformanceRating(90)  === 2000   // exact anchor hit
 *   estimatePerformanceRating(92.5) === 2200  // midpoint of 90..95
 *   estimatePerformanceRating(150) === 2900   // clamped above
 *   estimatePerformanceRating(-20) === 300    // clamped below
 *   // monotonic: a > b  =>  estimate(a) >= estimate(b)
 */
export function estimatePerformanceRating(accuracy: number): number {
  // Guard against NaN/undefined sneaking in from a malformed API payload.
  if (!Number.isFinite(accuracy)) return REFERENCE_POINTS[0].rating;

  const first = REFERENCE_POINTS[0];
  const last = REFERENCE_POINTS[REFERENCE_POINTS.length - 1];

  if (accuracy <= first.accuracy) return first.rating;
  if (accuracy >= last.accuracy) return last.rating;

  for (let i = 0; i < REFERENCE_POINTS.length - 1; i += 1) {
    const low = REFERENCE_POINTS[i];
    const high = REFERENCE_POINTS[i + 1];
    if (accuracy < low.accuracy || accuracy > high.accuracy) continue;

    // `high.accuracy > low.accuracy` for every adjacent pair above, so this
    // division can never be by zero.
    const t = (accuracy - low.accuracy) / (high.accuracy - low.accuracy);
    return Math.round(low.rating + t * (high.rating - low.rating));
  }

  // Unreachable given the clamps above, but keeps the return type honest.
  return last.rating;
}
