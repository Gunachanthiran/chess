import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnalysisProgress } from '../components/analysis/AnalysisProgress';
import { GameAnalysisPage } from '../components/layout/GameAnalysisPage';
import { PanelSkeleton } from '../components/common/Skeleton';
import { useMoveAnalysis } from '../hooks/useMoveAnalysis';
import { createAnalysisJob, getAnalysisJob } from '../api/analysis';
import { getGame } from '../api/games';
import { errorMessage } from '../api/client';
import type { AnalysisJob, Game } from '../types';

/**
 * `/analysis/:jobId` — one route for both "still running" and "done", exactly
 * like the underlying data already works (a job id plus its status). Fetches
 * the job, and via its `game_id` the game, from the URL param alone, so a
 * direct visit or a page reload always resolves standalone without depending
 * on how the user got here — no client-side handoff, no localStorage.
 */
export function AnalysisRoute() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [reanalysing, setReanalysing] = useState(false);
  const [reanalyseError, setReanalyseError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    setLoading(true);
    setNotFound(false);

    getAnalysisJob(jobId)
      .then((fetchedJob) => {
        if (!active) return;
        setJob(fetchedJob);
        return getGame(fetchedJob.game_id).then((fetchedGame) => {
          if (!active) return;
          setGame(fetchedGame);
        });
      })
      .catch(() => {
        if (active) setNotFound(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [jobId]);

  const handleReset = useCallback(() => navigate('/analyze'), [navigate]);

  // Re-runs analysis on the *same* game from a stale/older result — a fresh
  // job (routers/games.py never dedupes these), so tightened classification
  // rules or engine settings that shipped after this game was last analysed
  // actually take effect. `game` is the one already loaded for this route.
  const handleReanalyse = useCallback(async () => {
    if (!game) return;
    setReanalysing(true);
    setReanalyseError(null);
    try {
      const newJob = await createAnalysisJob(game.id);
      navigate(`/analysis/${newJob.id}`);
    } catch (err) {
      setReanalyseError(errorMessage(err));
      setReanalysing(false);
    }
  }, [game, navigate]);

  // The progress socket already knows the moment the job completes; this just
  // updates local state to switch this route over to the finished view.
  const handleProgressComplete = useCallback(() => {
    setJob((previous) => (previous ? { ...previous, status: 'completed' } : previous));
  }, []);

  const analysis = useMoveAnalysis(jobId ?? null, job?.status === 'completed');

  if (!jobId || notFound) {
    return (
      <div className="panel">
        <div className="alert alert--error">No analysis found for this link.</div>
        <button className="button" type="button" onClick={() => navigate('/library')}>
          Back to library
        </button>
      </div>
    );
  }

  if (loading || !job) {
    return <PanelSkeleton />;
  }

  if (job.status !== 'completed') {
    return (
      <AnalysisProgress
        jobId={jobId}
        game={game}
        onComplete={handleProgressComplete}
        onCancel={handleReset}
      />
    );
  }

  return (
    <>
      {analysis.loading && <PanelSkeleton lines={5} />}
      {analysis.error && (
        <div className="panel">
          <div className="alert alert--error">{analysis.error}</div>
          <button className="button" type="button" onClick={analysis.reload}>
            Retry
          </button>
          <button className="button" type="button" onClick={handleReset}>
            Start over
          </button>
        </div>
      )}
      {reanalyseError && <div className="alert alert--error">{reanalyseError}</div>}
      {!analysis.loading && !analysis.error && (
        <GameAnalysisPage
          game={game}
          moves={analysis.moves}
          whiteAccuracy={analysis.whiteAccuracy}
          blackAccuracy={analysis.blackAccuracy}
          onAnalyseAnother={handleReset}
          onReanalyse={game ? () => void handleReanalyse() : undefined}
          reanalysing={reanalysing}
        />
      )}
    </>
  );
}
