import { apiFetch } from './client';
import type { ImportSource, PlayerLookup } from '../types';

/** GET /api/players/lookup?source=&username= — a public profile, not tied to
 * any connected account. */
export function lookupPlayer(
  source: ImportSource,
  username: string,
  signal?: AbortSignal,
): Promise<PlayerLookup> {
  const query = new URLSearchParams({ source, username });
  return apiFetch<PlayerLookup>(`/api/players/lookup?${query.toString()}`, { signal });
}
