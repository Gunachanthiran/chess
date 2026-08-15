import { apiFetch } from './client';
import type { CreateImportRequest, ImportJobResponse } from '../types';

/** POST /api/imports — queues a bulk import of a player's games. */
export async function createImportJob(
  req: CreateImportRequest,
  signal?: AbortSignal,
): Promise<ImportJobResponse> {
  return apiFetch<ImportJobResponse>('/api/imports', {
    method: 'POST',
    body: req,
    signal,
  });
}

/** GET /api/imports/{id} — also the polling fallback for the socket. */
export async function getImportJob(
  id: string,
  signal?: AbortSignal,
): Promise<ImportJobResponse> {
  return apiFetch<ImportJobResponse>(`/api/imports/${encodeURIComponent(id)}`, { signal });
}
