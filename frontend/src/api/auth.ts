import { apiFetch, API_BASE_URL } from './client';
import type { AuthStatus, ConnectResponse } from '../types';

/** GET /api/auth/status */
export function getAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return apiFetch<AuthStatus>('/api/auth/status', { signal });
}

/**
 * The URL to send the browser to for "Continue with Lichess" — a real
 * top-level navigation (`<a href>`), never a `fetch`. The backend redirects
 * on to Lichess's own login/consent page, which has to actually render.
 */
export function lichessLoginUrl(): string {
  return `${API_BASE_URL}/api/auth/lichess/start`;
}

/** POST /api/auth/chesscom/connect — username only, no password. */
export function connectChessCom(
  username: string,
  signal?: AbortSignal,
): Promise<ConnectResponse> {
  return apiFetch<ConnectResponse>('/api/auth/chesscom/connect', {
    method: 'POST',
    body: { username },
    signal,
  });
}

/** DELETE /api/auth/lichess */
export function disconnectLichess(signal?: AbortSignal): Promise<null> {
  return apiFetch<null>('/api/auth/lichess', { method: 'DELETE', signal });
}

/** DELETE /api/auth/chesscom */
export function disconnectChessCom(signal?: AbortSignal): Promise<null> {
  return apiFetch<null>('/api/auth/chesscom', { method: 'DELETE', signal });
}
