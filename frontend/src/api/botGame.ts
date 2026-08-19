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

/**
 * POST /api/bot-games/{id}/undo — rolls back the bot's last reply *and* the
 * player move that provoked it in one step, so the player always lands back
 * on their own turn (see `bot_game_service.undo_last_move`).
 */
export function undoBotMove(id: string, signal?: AbortSignal): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>(`/api/bot-games/${encodeURIComponent(id)}/undo`, {
    method: 'POST',
    signal,
  });
}

/**
 * POST /api/bot-games/{id}/claim-draw — claims a draw by threefold
 * repetition or the fifty-move rule. Rejected with a 409 (DRAW_NOT_CLAIMABLE)
 * if the position doesn't actually allow it — the server is the sole judge,
 * same as every other write against this game (see `bot_game_service`).
 */
export function claimBotDraw(id: string, signal?: AbortSignal): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>(`/api/bot-games/${encodeURIComponent(id)}/claim-draw`, {
    method: 'POST',
    signal,
  });
}

/** POST /api/bot-games/{id}/resign — the human gives up; no legality to check. */
export function resignBotGame(id: string, signal?: AbortSignal): Promise<BotGameResponse> {
  return apiFetch<BotGameResponse>(`/api/bot-games/${encodeURIComponent(id)}/resign`, {
    method: 'POST',
    signal,
  });
}
