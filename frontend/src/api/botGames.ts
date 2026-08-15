import { apiFetch } from './client';
import type { BotGameSummaryListResponse } from '../types';

/** GET /api/bot-games?limit=&offset= — most-recently-active first. */
export function listBotGames(
  params: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<BotGameSummaryListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  const suffix = query.toString();
  return apiFetch<BotGameSummaryListResponse>(`/api/bot-games${suffix ? `?${suffix}` : ''}`, {
    signal,
  });
}
