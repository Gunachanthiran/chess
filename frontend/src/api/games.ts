import { apiFetch } from './client';
import type {
  Game,
  GameListResponse,
  GameSource,
  GameStats,
  HeadToHead,
  OpeningPerformanceList,
  PhaseBreakdownList,
  TimeBucketList,
} from '../types';

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

export type GameOutcomeFilter = 'win' | 'loss' | 'draw';

/** GET /api/games?limit=&offset=&source=&opponent=&opening=&result= */
export function listGames(
  params: {
    limit?: number;
    offset?: number;
    source?: GameSource;
    opponent?: string;
    opening?: string;
    result?: GameOutcomeFilter;
  } = {},
  signal?: AbortSignal,
): Promise<GameListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.source !== undefined) query.set('source', params.source);
  if (params.opponent) query.set('opponent', params.opponent);
  if (params.opening) query.set('opening', params.opening);
  if (params.result !== undefined) query.set('result', params.result);
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

/** GET /api/games/phases — error-rate breakdown by game phase. */
export async function getPhaseBreakdown(signal?: AbortSignal): Promise<PhaseBreakdownList> {
  const data = await apiFetch<{ phases: PhaseBreakdownList }>('/api/games/phases', { signal });
  return data.phases;
}

/** GET /api/games/time-pressure — error-rate breakdown by clock remaining. */
export async function getTimePressure(signal?: AbortSignal): Promise<TimeBucketList> {
  const data = await apiFetch<{ buckets: TimeBucketList }>('/api/games/time-pressure', {
    signal,
  });
  return data.buckets;
}

/** GET /api/games/head-to-head?opponent= — your record against one player. */
export function getHeadToHead(opponent: string, signal?: AbortSignal): Promise<HeadToHead> {
  return apiFetch<HeadToHead>(
    `/api/games/head-to-head?opponent=${encodeURIComponent(opponent)}`,
    { signal },
  );
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
