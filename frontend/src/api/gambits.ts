import { apiFetch } from './client';
import type { GambitListResponse } from '../types';

/** GET /api/gambits — the whole "Choose Your Gambit" data source. */
export function listGambits(signal?: AbortSignal): Promise<GambitListResponse> {
  return apiFetch<GambitListResponse>('/api/gambits', { signal });
}
