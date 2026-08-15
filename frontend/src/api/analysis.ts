import { apiFetch } from './client';
import type { AnalysisJob, MoveAnalysisResponse } from '../types';

type JobEnvelope = { job: AnalysisJob };

/** POST /api/analysis/jobs — queues Stockfish analysis for a game. */
export async function createAnalysisJob(
  gameId: string,
  signal?: AbortSignal,
): Promise<AnalysisJob> {
  const data = await apiFetch<JobEnvelope>('/api/analysis/jobs', {
    method: 'POST',
    body: { game_id: gameId },
    signal,
  });
  return data.job;
}

/**
 * GET /api/analysis/jobs/{job_id} — also the polling fallback for the socket.
 *
 * Same `{ job }` envelope as the POST above — this was previously read as a
 * bare `AnalysisJob`, so every field on the polling-fallback path silently
 * came back `undefined`. The WebSocket path was never affected (its frames
 * are flat, not enveloped), which is exactly why this went unnoticed: the
 * fallback only matters when the socket has actually failed for real, not
 * just logged its usual harmless close-on-completion warning.
 */
export async function getAnalysisJob(jobId: string, signal?: AbortSignal): Promise<AnalysisJob> {
  const data = await apiFetch<JobEnvelope>(`/api/analysis/jobs/${encodeURIComponent(jobId)}`, {
    signal,
  });
  return data.job;
}

/**
 * GET /api/analysis/jobs/{job_id}/moves — only meaningful once the job status is
 * `completed`; callers are responsible for waiting.
 */
export function getAnalysisMoves(
  jobId: string,
  signal?: AbortSignal,
): Promise<MoveAnalysisResponse> {
  return apiFetch<MoveAnalysisResponse>(
    `/api/analysis/jobs/${encodeURIComponent(jobId)}/moves`,
    { signal },
  );
}
