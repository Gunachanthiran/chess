import { useState } from 'react';
import { useAnalysisProgress } from '../../hooks/useAnalysisProgress';
import {
  disableAnalysisNotifications,
  enableAnalysisNotifications,
  notificationsSupported,
  notifyAnalysisDone,
  readNotifyPreference,
} from '../../lib/notifications';
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

/**
 * Long analysis jobs (minutes, on a slow enough host — see tal_bot.py's own
 * comments on the deployed free tier) are exactly the kind of wait a player
 * switches tabs or apps during; this toggle asks once, remembers the answer
 * (see `lib/notifications.ts`), and fires a real browser notification on
 * completion so this panel doesn't have to stay in view for that to matter.
 */
function NotifyToggle() {
  const [enabled, setEnabled] = useState(readNotifyPreference);

  if (!notificationsSupported()) return null;

  const handleClick = async () => {
    if (enabled) {
      // Only the app-side preference turns off; the browser permission
      // itself can only be revoked by the user, from browser settings.
      disableAnalysisNotifications();
      setEnabled(false);
      return;
    }
    const granted = await enableAnalysisNotifications();
    setEnabled(granted);
  };

  return (
    <button type="button" className="progress__notify" onClick={handleClick}>
      {enabled ? '🔔 Notify me when done' : '🔕 Notify me when done'}
    </button>
  );
}

export function AnalysisProgress({ jobId, game, onComplete, onCancel }: AnalysisProgressProps) {
  const gameLabel = game ? `${game.white_name} vs ${game.black_name}` : 'Your game';

  const progress = useAnalysisProgress(jobId, {
    onComplete: (frame) => {
      void notifyAnalysisDone('Analysis complete', gameLabel, `/analysis/${jobId}`);
      onComplete(frame);
    },
    onFailed: () => {
      void notifyAnalysisDone('Analysis failed', gameLabel, `/analysis/${jobId}`);
    },
  });

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

      <div className="progress__actions">
        <button className="button" type="button" onClick={onCancel}>
          {failed ? 'Back' : 'Analyse a different game'}
        </button>
        {!failed && progress.status !== 'completed' && <NotifyToggle />}
      </div>
    </div>
  );
}
