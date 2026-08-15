import { useEffect, useRef, useState } from 'react';
import { analysisSocketUrl, errorMessage } from '../api/client';
import { getAnalysisJob } from '../api/analysis';
import type { AnalysisProgressFrame, JobStatus } from '../types';

/** How the hook is currently receiving updates. */
export type ProgressTransport = 'connecting' | 'websocket' | 'polling';

export type AnalysisProgressState = {
  status: JobStatus;
  progressPct: number;
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  /** Populated when status is `failed`, or when polling itself is failing. */
  error: string | null;
  transport: ProgressTransport;
};

export type UseAnalysisProgressOptions = {
  onComplete?: (frame: AnalysisProgressFrame) => void;
  onFailed?: (message: string) => void;
};

const POLL_INTERVAL_MS = 2000;

const INITIAL_STATE: AnalysisProgressState = {
  status: 'pending',
  progressPct: 0,
  whiteAccuracy: null,
  blackAccuracy: null,
  error: null,
  transport: 'connecting',
};

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function parseFrame(raw: string): AnalysisProgressFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.status !== 'string') return null;
    return {
      status: candidate.status as JobStatus,
      progress_pct: typeof candidate.progress_pct === 'number' ? candidate.progress_pct : 0,
      white_accuracy:
        typeof candidate.white_accuracy === 'number' ? candidate.white_accuracy : undefined,
      black_accuracy:
        typeof candidate.black_accuracy === 'number' ? candidate.black_accuracy : undefined,
      error: typeof candidate.error === 'string' ? candidate.error : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Live progress for one analysis job.
 *
 * Primary transport is the WebSocket. If it errors, or closes before delivering
 * a terminal frame, the hook transparently falls back to polling
 * `GET /api/analysis/jobs/{id}` every 2s until the job reaches a terminal state,
 * so a proxy that drops websockets degrades rather than hanging the UI.
 */
export function useAnalysisProgress(
  jobId: string | null,
  options: UseAnalysisProgressOptions = {},
): AnalysisProgressState {
  const [state, setState] = useState<AnalysisProgressState>(INITIAL_STATE);

  // Callbacks live in refs so a caller passing inline arrow functions does not
  // tear down and reopen the socket on every render.
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

    const handleFrame = (frame: AnalysisProgressFrame) => {
      if (disposed || reachedTerminal) return;

      setState((previous) => ({
        status: frame.status,
        // Never let the bar walk backwards on a late/duplicate frame.
        progressPct: Math.max(
          previous.status === frame.status ? previous.progressPct : 0,
          Math.max(0, Math.min(100, frame.progress_pct)),
        ),
        whiteAccuracy: frame.white_accuracy ?? previous.whiteAccuracy,
        blackAccuracy: frame.black_accuracy ?? previous.blackAccuracy,
        error: frame.status === 'failed' ? (frame.error ?? 'Analysis failed.') : null,
        transport: previous.transport,
      }));

      if (isTerminal(frame.status)) {
        reachedTerminal = true;
        stopPolling();
        if (frame.status === 'completed') {
          setState((previous) => ({ ...previous, progressPct: 100 }));
          onCompleteRef.current?.(frame);
        } else {
          onFailedRef.current?.(frame.error ?? 'Analysis failed.');
        }
      }
    };

    const pollOnce = async () => {
      if (disposed || reachedTerminal) return;
      try {
        const job = await getAnalysisJob(jobId);
        handleFrame({
          status: job.status,
          progress_pct: job.progress_pct,
          white_accuracy: job.white_accuracy ?? undefined,
          black_accuracy: job.black_accuracy ?? undefined,
          error: job.error_message ?? undefined,
        });
      } catch (err) {
        if (disposed) return;
        // Keep polling — the backend may just be restarting — but tell the user
        // what is going on instead of showing a frozen bar.
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
      socket = new WebSocket(analysisSocketUrl(jobId));
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
