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
 * How the game reads from the importing user's point of view.
 *
 * Only claims a side when `imported_username` actually matches one of the two
 * player names; anything else (uploads, a rename, a mismatch) falls back to the
 * neutral "White vs Black" line rather than guessing.
 */
export function describeMatchup(game: Game): { line: string; outcome: string | null } {
  const neutral = `${game.white_name} vs ${game.black_name}`;
  const who = game.imported_username?.trim().toLowerCase();
  if (!who) return { line: neutral, outcome: null };

  const isWhite = game.white_name.trim().toLowerCase() === who;
  const isBlack = game.black_name.trim().toLowerCase() === who;
  // A player facing themselves gives no usable perspective either.
  if (isWhite === isBlack) return { line: neutral, outcome: null };

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
