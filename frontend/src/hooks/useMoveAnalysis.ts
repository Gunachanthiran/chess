import { useCallback, useEffect, useState } from 'react';
import { getAnalysisMoves } from '../api/analysis';
import { errorMessage } from '../api/client';
import type { MoveAnalysis } from '../types';

export type UseMoveAnalysisResult = {
  moves: MoveAnalysis[];
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * Loads the per-move analysis for a completed job.
 *
 * `enabled` exists because `/moves` is only valid once the job status is
 * `completed`; callers pass `false` until then.
 */
export function useMoveAnalysis(jobId: string | null, enabled = true): UseMoveAnalysisResult {
  const [moves, setMoves] = useState<MoveAnalysis[]>([]);
  const [whiteAccuracy, setWhiteAccuracy] = useState<number | null>(null);
  const [blackAccuracy, setBlackAccuracy] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** Which job the current `moves` belong to, so stale data is never shown. */
  const [loadedJobId, setLoadedJobId] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!jobId || !enabled) return;

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    getAnalysisMoves(jobId, controller.signal)
      .then((response) => {
        if (!active) return;
        // Guard against out-of-order plies so index-based navigation is sound.
        const ordered = [...response.moves].sort((a, b) => a.ply - b.ply);
        setMoves(ordered);
        setWhiteAccuracy(response.white_accuracy);
        setBlackAccuracy(response.black_accuracy);
        setLoadedJobId(jobId);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [jobId, enabled, reloadToken]);

  // Report "loading" for the render between `enabled` flipping true and the
  // effect firing, otherwise the page briefly paints an empty analysis.
  const pending = enabled && jobId !== null && loadedJobId !== jobId && error === null;

  return {
    moves: loadedJobId === jobId ? moves : [],
    whiteAccuracy,
    blackAccuracy,
    loading: loading || pending,
    error,
    reload,
  };
}
