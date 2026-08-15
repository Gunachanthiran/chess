import { apiFetch } from './client';
import type { BotGameResponse, CreateBotGameRequest, SubmitBotMoveRequest } from '../types';

/**
 * Thin wrappers over `apiFetch` for the "play a Tal-style bot" endpoints.
 *
 * Unlike the analysis/games wrappers these return the whole `{ bot_game }`
 * envelope rather than unwrapping it: the caller (`useBotGame`) replaces its
 * entire local state with the server's object after every call, so keeping the
 * envelope makes that reconciliation the obvious thing to write.
 */

/** POST /api/bot-games — creates a game and, if the bot is White, its first move. */
export function createBotGame(
  req: CreateBotGameRequest,
  signal?: AbortSignal,
): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>('/api/bot-games', {
    method: 'POST',
    body: req,
    signal,
  });
}

/** GET /api/bot-games/{id} */
export function getBotGame(id: string, signal?: AbortSignal): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>(`/api/bot-games/${encodeURIComponent(id)}`, { signal });
}

/**
 * POST /api/bot-games/{id}/moves — submits the player's move. The response
 * carries the board *after* the bot has replied, so one request covers both
 * plies.
 */
export function submitBotMove(
  id: string,
  req: SubmitBotMoveRequest,
  signal?: AbortSignal,
): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>(`/api/bot-games/${encodeURIComponent(id)}/moves`, {
    method: 'POST',
    body: req,
    signal,
  });
}
