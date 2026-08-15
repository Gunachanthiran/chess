import type { ApiErrorBody } from '../types';

/**
 * Single place where the backend origin is resolved. Everything else in the app
 * goes through `apiFetch` / `wsUrl` so there is exactly one definition of "where
 * is the API".
 */
const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export const API_BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
);

export const WS_BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_WS_BASE_URL ??
    API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'),
);

/**
 * Every failure the UI can see — HTTP error responses, network failures and
 * malformed bodies — is normalised into this one class. UI code therefore never
 * has to inspect `e.response.data.detail` and guess whether it is a string, an
 * array of validation objects, or missing entirely: it reads `.message`.
 */
export class ApiError extends Error {
  /** Machine-readable code from the backend body, or a synthetic one. */
  readonly code: string;
  /** HTTP status, or 0 when the request never completed (network/CORS). */
  readonly status: number;
  /** Opaque structured extra info from the backend. Never rendered raw. */
  readonly detail: unknown;

  constructor(code: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Narrows an unknown thrown value to a user-presentable message. Use this in
 * catch blocks so a stray TypeError still renders something sensible.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.message === 'string' && typeof candidate.error === 'string';
}

/**
 * Best-effort extraction of a human message from a body that did not match the
 * documented error contract (e.g. a proxy's HTML error page, or a FastAPI
 * validation error that slipped through unwrapped).
 */
function salvageMessage(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim().length > 0) {
    return body.trim().slice(0, 300);
  }
  if (typeof body === 'object' && body !== null) {
    const candidate = body as Record<string, unknown>;
    if (typeof candidate.message === 'string') return candidate.message;
    if (typeof candidate.detail === 'string') return candidate.detail;
    if (Array.isArray(candidate.detail)) {
      const parts = candidate.detail
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (typeof entry === 'object' && entry !== null) {
            const msg = (entry as Record<string, unknown>).msg;
            if (typeof msg === 'string') return msg;
          }
          return null;
        })
        .filter((part): part is string => part !== null);
      if (parts.length > 0) return parts.join('; ');
    }
  }
  return `Request failed with status ${status}.`;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * The one HTTP entry point. Resolves with the parsed JSON body on 2xx and
 * throws an `ApiError` on anything else.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      'NETWORK_ERROR',
      `Could not reach the ChessScope API at ${API_BASE_URL}. Is the backend running?`,
      0,
      err,
    );
  }

  // 204/205 carry no body; everything else in this API is JSON.
  const isEmpty = response.status === 204 || response.status === 205;
  let parsed: unknown = null;
  if (!isEmpty) {
    const raw = await response.text();
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
  }

  if (!response.ok) {
    if (isApiErrorBody(parsed)) {
      throw new ApiError(parsed.error, parsed.message, response.status, parsed.detail);
    }
    throw new ApiError(
      `HTTP_${response.status}`,
      salvageMessage(parsed, response.status),
      response.status,
      parsed,
    );
  }

  return parsed as T;
}

/** Builds the analysis progress WebSocket URL for a job. */
export function analysisSocketUrl(jobId: string): string {
  return `${WS_BASE_URL}/ws/analysis/${encodeURIComponent(jobId)}`;
}

/** Builds the bulk-import progress WebSocket URL for an import job. */
export function importSocketUrl(jobId: string): string {
  return `${WS_BASE_URL}/ws/import/${encodeURIComponent(jobId)}`;
}
