import { apiFetch } from './client';
import type { PuzzleListResponse } from '../types';

/** GET /api/puzzles?limit= — a random batch of your own Mistakes/Blunders. */
export function getPuzzles(limit = 20, signal?: AbortSignal): Promise<PuzzleListResponse> {
  return apiFetch<PuzzleListResponse>(`/api/puzzles?limit=${limit}`, { signal });
}
