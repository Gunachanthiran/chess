import { apiFetch } from './client';
import type { Game, GameListResponse, GameSource, GameStats, OpeningPerformanceList } from '../types';

type GameEnvelope = { game: Game };

/** POST /api/games/upload — raw PGN text in, persisted Game out. */
export async function uploadPgn(pgn: string, signal?: AbortSignal): Promise<Game> {
  const data = await apiFetch<GameEnvelope>('/api/games/upload', {
    method: 'POST',
    body: { pgn },
    signal,
  });
  return data.game;
}

/** GET /api/games/{game_id} */
export async function getGame(gameId: string, signal?: AbortSignal): Promise<Game> {
  const data = await apiFetch<GameEnvelope>(`/api/games/${encodeURIComponent(gameId)}`, {
    signal,
  });
  return data.game;
}

/** GET /api/games?limit=&offset=&source= */
export function listGames(
  params: { limit?: number; offset?: number; source?: GameSource } = {},
  signal?: AbortSignal,
): Promise<GameListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.source !== undefined) query.set('source', params.source);
  const suffix = query.toString();
  return apiFetch<GameListResponse>(`/api/games${suffix ? `?${suffix}` : ''}`, { signal });
}

/** GET /api/games/stats — dashboard stats widget's data source. */
export function getGameStats(signal?: AbortSignal): Promise<GameStats> {
  return apiFetch<GameStats>('/api/games/stats', { signal });
}

/** GET /api/games/openings — win/loss/draw + accuracy grouped by opening. */
export async function getOpeningPerformance(
  signal?: AbortSignal,
): Promise<OpeningPerformanceList> {
  const data = await apiFetch<{ openings: OpeningPerformanceList }>('/api/games/openings', {
    signal,
  });
  return data.openings;
}

/** POST /api/lichess/import — by explicit game id. */
export async function importLichessGame(
  lichessGameId: string,
  signal?: AbortSignal,
): Promise<Game> {
  const data = await apiFetch<GameEnvelope>('/api/lichess/import', {
    method: 'POST',
    body: { lichess_game_id: lichessGameId },
    signal,
  });
  return data.game;
}

/** POST /api/lichess/import — most recent game for a username. */
export async function importLichessRecent(
  username: string,
  signal?: AbortSignal,
): Promise<Game> {
  const data = await apiFetch<GameEnvelope>('/api/lichess/import', {
    method: 'POST',
    body: { username, recent: true },
    signal,
  });
  return data.game;
}
