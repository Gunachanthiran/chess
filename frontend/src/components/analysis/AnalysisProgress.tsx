import { useAnalysisProgress } from '../../hooks/useAnalysisProgress';
import type { AnalysisProgressFrame, Game } from '../../types';

type AnalysisProgressProps = {
  jobId: string;
  game: Game | null;
  onComplete: (frame: AnalysisProgressFrame) => void;
  onCancel: () => void;
};

const STATUS_COPY: Record<string, string> = {
  pending: 'Queued — waiting for an engine slot',
  running: 'Analysing with Stockfish',
  completed: 'Analysis complete',
  failed: 'Analysis failed',
};

export function AnalysisProgress({ jobId, game, onComplete, onCancel }: AnalysisProgressProps) {
  const progress = useAnalysisProgress(jobId, { onComplete });

  const failed = progress.status === 'failed';
  const pct = Math.round(progress.progressPct);

  return (
    <div className="panel progress">
      <div className="panel__header">{STATUS_COPY[progress.status] ?? progress.status}</div>

      {game && (
        <div className="progress__game">
          {game.white_name} vs {game.black_name}
          {game.opening_name ? ` — ${game.opening_name}` : ''}
        </div>
      )}

      <div
        className="progress__bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`progress__fill${failed ? ' progress__fill--failed' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="progress__meta">
        <span className="progress__pct">{pct}%</span>
        <span className="progress__transport">
          {progress.transport === 'websocket' && 'live'}
          {progress.transport === 'polling' && 'live updates unavailable — polling'}
          {progress.transport === 'connecting' && 'connecting…'}
        </span>
      </div>

      {failed && (
        <div className="alert alert--error">
          {progress.error ?? 'The analysis job failed.'}
        </div>
      )}
      {!failed && progress.error && <div className="alert alert--warn">{progress.error}</div>}

      <button className="button" type="button" onClick={onCancel}>
        {failed ? 'Back' : 'Analyse a different game'}
      </button>
    </div>
  );
}
