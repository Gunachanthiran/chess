import { useEffect, useRef, useState } from 'react';
import { errorMessage, importSocketUrl } from '../api/client';
import { getImportJob } from '../api/imports';
import type { ImportJobStatus, ImportProgressFrame } from '../types';
import type { ProgressTransport } from './useAnalysisProgress';

export type ImportProgressState = {
  status: ImportJobStatus;
  progressPct: number;
  gamesFound: number;
  gamesImported: number;
  gamesSkipped: number;
  /** Populated when status is `failed`, or when polling itself is failing. */
  error: string | null;
  transport: ProgressTransport;
};

export type UseImportProgressOptions = {
  onComplete?: (frame: ImportProgressFrame) => void;
  onFailed?: (message: string) => void;
};

const POLL_INTERVAL_MS = 2000;

const INITIAL_STATE: ImportProgressState = {
  status: 'pending',
  progressPct: 0,
  gamesFound: 0,
  gamesImported: 0,
  gamesSkipped: 0,
  error: null,
  transport: 'connecting',
};

function isTerminal(status: ImportJobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function parseFrame(raw: string): ImportProgressFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.status !== 'string') return null;
    return {
      status: candidate.status as ImportJobStatus,
      progress_pct: typeof candidate.progress_pct === 'number' ? candidate.progress_pct : 0,
      games_found: typeof candidate.games_found === 'number' ? candidate.games_found : undefined,
      games_imported:
        typeof candidate.games_imported === 'number' ? candidate.games_imported : undefined,
      games_skipped:
        typeof candidate.games_skipped === 'number' ? candidate.games_skipped : undefined,
      error: typeof candidate.error === 'string' ? candidate.error : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Live progress for one bulk-import job.
 *
 * Same shape as `useAnalysisProgress`: the WebSocket is the primary transport,
 * and if it errors or closes before a terminal frame the hook falls back to
 * polling `GET /api/imports/{id}` every 2s until the job finishes.
 */
export function useImportProgress(
  jobId: string | null,
  options: UseImportProgressOptions = {},
): ImportProgressState {
  const [state, setState] = useState<ImportProgressState>(INITIAL_STATE);

  // Refs so inline arrow callbacks don't tear down and reopen the socket on
  // every render.
  const onCompleteRef = useRef(options.onComplete);
  const onFailedRef = useRef(options.onFailed);
  onCompleteRef.current = options.onComplete;
  onFailedRef.current = options.onFailed;

  useEffect(() => {
    if (!jobId) {
      setState(INITIAL_STATE);
      return;
    }

    setState(INITIAL_STATE);

    let disposed = false;
    let reachedTerminal = false;
    let socket: WebSocket | null = null;
    let pollTimer: number | null = null;

    const stopPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const handleFrame = (frame: ImportProgressFrame) => {
      if (disposed || reachedTerminal) return;

      setState((previous) => ({
        status: frame.status,
        // Never let the bar walk backwards on a late/duplicate frame.
        progressPct: Math.max(
          previous.status === frame.status ? previous.progressPct : 0,
          Math.max(0, Math.min(100, frame.progress_pct)),
        ),
        // Counts only ever grow, so ignore a stale frame reporting fewer.
        gamesFound: Math.max(previous.gamesFound, frame.games_found ?? 0),
        gamesImported: Math.max(previous.gamesImported, frame.games_imported ?? 0),
        gamesSkipped: Math.max(previous.gamesSkipped, frame.games_skipped ?? 0),
        error: frame.status === 'failed' ? (frame.error ?? 'Import failed.') : null,
        transport: previous.transport,
      }));

      if (isTerminal(frame.status)) {
        reachedTerminal = true;
        stopPolling();
        if (frame.status === 'completed') {
          setState((previous) => ({ ...previous, progressPct: 100 }));
          onCompleteRef.current?.(frame);
        } else {
          onFailedRef.current?.(frame.error ?? 'Import failed.');
        }
      }
    };

    const pollOnce = async () => {
      if (disposed || reachedTerminal) return;
      try {
        const { job } = await getImportJob(jobId);
        handleFrame({
          status: job.status,
          progress_pct: job.progress_pct,
          games_found: job.games_found,
          games_imported: job.games_imported,
          games_skipped: job.games_skipped,
          error: job.error_message ?? undefined,
        });
      } catch (err) {
        if (disposed) return;
        // Keep polling — the backend may just be restarting — but say so rather
        // than showing a frozen bar.
        setState((previous) => ({ ...previous, error: errorMessage(err) }));
      }
    };

    const startPolling = () => {
      if (disposed || reachedTerminal || pollTimer !== null) return;
      setState((previous) => ({ ...previous, transport: 'polling' }));
      void pollOnce();
      pollTimer = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
    };

    try {
      socket = new WebSocket(importSocketUrl(jobId));
    } catch {
      startPolling();
      return () => {
        disposed = true;
        stopPolling();
      };
    }

    socket.onopen = () => {
      if (disposed) return;
      setState((previous) => ({ ...previous, transport: 'websocket' }));
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const frame = parseFrame(event.data);
      if (frame) handleFrame(frame);
    };

    socket.onerror = () => {
      if (disposed || reachedTerminal) return;
      startPolling();
    };

    socket.onclose = () => {
      if (disposed || reachedTerminal) return;
      // The server closes the socket after a terminal frame; getting here means
      // it closed early, so take over with polling.
      startPolling();
    };

    return () => {
      disposed = true;
      stopPolling();
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      }
    };
  }, [jobId]);

  return state;
}
