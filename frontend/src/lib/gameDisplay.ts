import type { Game } from '../types';

/** `2026-08-15T...` -> `Aug 15, 2026`, or an em dash for an unset date. */
export function formatPlayedAt(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** `2026-08-15T10:30:00Z` -> `2h ago`, chessiro-dashboard style. */
export function formatTimeAgo(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatPlayedAt(value);
}

/**
 * Which side `imported_username` played, or `null` when it can't be told
 * apart — the name matches neither side, matches both (a player facing
 * themselves), or there's no `imported_username` at all (an upload).
 *
 * Case/whitespace-insensitive, and shared by every "what happened to me in
 * this game" reading below rather than each re-deriving the same match —
 * mirrored server-side by `app/services/game_stats.py::my_accuracy` for the
 * stats widget, which needs the identical rule over the *whole* game history
 * rather than just the page on screen.
 */
export function mySide(game: Game): 'white' | 'black' | null {
  const who = game.imported_username?.trim().toLowerCase();
  if (!who) return null;

  const isWhite = game.white_name.trim().toLowerCase() === who;
  const isBlack = game.black_name.trim().toLowerCase() === who;
  if (isWhite === isBlack) return null;
  return isWhite ? 'white' : 'black';
}

/**
 * How the game reads from the importing user's point of view.
 *
 * Only claims a side when `imported_username` actually matches one of the two
 * player names; anything else (uploads, a rename, a mismatch) falls back to the
 * neutral "White vs Black" line rather than guessing.
 */
export function describeMatchup(game: Game): { line: string; outcome: string | null } {
  const neutral = `${game.white_name} vs ${game.black_name}`;
  const side = mySide(game);
  if (!side) return { line: neutral, outcome: null };

  const isWhite = side === 'white';
  const opponent = isWhite ? game.black_name : game.white_name;
  const youWon = isWhite ? game.result === '1-0' : game.result === '0-1';
  const youLost = isWhite ? game.result === '0-1' : game.result === '1-0';

  let outcome: string | null;
  if (youWon) outcome = 'Win';
  else if (youLost) outcome = 'Loss';
  else if (game.result === '1/2-1/2') outcome = 'Draw';
  else outcome = null;

  return { line: `vs ${opponent}`, outcome };
}

/** My-side accuracy for one game, or `null` when it can't be determined (see
 * `mySide`) or nothing has been analysed yet. */
export function myAccuracy(game: Game): number | null {
  const side = mySide(game);
  if (!side) return null;
  return side === 'white' ? game.white_accuracy : game.black_accuracy;
}
