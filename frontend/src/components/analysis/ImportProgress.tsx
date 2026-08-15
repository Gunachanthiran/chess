import { useImportProgress } from '../../hooks/useImportProgress';
import type { ImportProgressFrame } from '../../types';

type ImportProgressProps = {
  jobId: string;
  /** Shown above the bar so the user knows which import is running. */
  label?: string | null;
  onComplete: (frame: ImportProgressFrame) => void;
  onDone: () => void;
};

const STATUS_COPY: Record<string, string> = {
  pending: 'Queued — waiting to start',
  running: 'Importing games',
  completed: 'Import complete',
  failed: 'Import failed',
};

export function ImportProgress({ jobId, label, onComplete, onDone }: ImportProgressProps) {
  const progress = useImportProgress(jobId, { onComplete });

  const failed = progress.status === 'failed';
  const pct = Math.round(progress.progressPct);

  return (
    <div className="panel progress">
      <div className="panel__header">{STATUS_COPY[progress.status] ?? progress.status}</div>

      {label && <div className="progress__game">{label}</div>}

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

      <div className="progress__counts">
        <span>
          Found <strong>{progress.gamesFound}</strong>
        </span>
        <span>
          Imported <strong>{progress.gamesImported}</strong>
        </span>
        <span>
          Skipped <strong>{progress.gamesSkipped}</strong>
        </span>
      </div>

      {failed && (
        <div className="alert alert--error">{progress.error ?? 'The import job failed.'}</div>
      )}
      {!failed && progress.error && <div className="alert alert--warn">{progress.error}</div>}

      <button className="button" type="button" onClick={onDone}>
        {failed ? 'Back' : 'Back to library'}
      </button>
    </div>
  );
}
