/**
 * Bot-strength constants, shared by the setup form and the in-game header.
 *
 * `GRANDMASTER_ELO` mirrors `tal_bot.GRANDMASTER_ELO` on the backend. It is a
 * sentinel, not a rating: Stockfish's own UCI_Elo mechanism tops out at 3190,
 * so this value does not ask for "3600 Elo" — it selects the tier that stops
 * limiting the engine at all.
 *
 * That tier is the default. The values below it are practice mode: tunable,
 * genuinely beatable, and reachable only by explicitly opting in — a weakened
 * engine has to blunder sometimes, which is exactly what makes it beatable and
 * exactly what the default experience should not do.
 */

/** Weakest selectable practice strength. */
export const BOT_ELO_MIN = 800;

/** Strongest *tunable* practice strength — Stockfish's own UCI_Elo ceiling
 * (`engine_pool.MAX_UCI_ELO`). Raised from 2500: that left real headroom
 * under the engine's own limit unused, so "strongest practice bot" was
 * weaker than it needed to be. */
export const BOT_ELO_TUNABLE_MAX = 3190;

/** Slider granularity for the tunable range. */
export const BOT_ELO_STEP = 10;

/** Stockfish's UCI_Elo floor: anything below plays at exactly this. */
export const BOT_ELO_FLOOR = 1320;

/** Where the practice slider starts when practice mode is switched on. */
export const DEFAULT_PRACTICE_ELO = 1500;

/** Selects unrestricted, full-strength Stockfish. Matches the backend sentinel. */
export const GRANDMASTER_ELO = 3600;

/** True when this strength selects the unrestricted tier. */
export function isGrandmasterElo(elo: number): boolean {
  return elo >= GRANDMASTER_ELO;
}
