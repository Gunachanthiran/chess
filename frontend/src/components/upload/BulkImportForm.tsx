import { useState } from 'react';
import type { FormEvent } from 'react';
import { createImportJob } from '../../api/imports';
import { errorMessage } from '../../api/client';
import type { CreateImportRequest, ImportSource } from '../../types';

type BulkImportFormProps = {
  /** Called with the queued job's id so the caller can show progress. */
  onImportStarted: (importJobId: string) => void;
  onCancel?: () => void;
};

const DEFAULT_MAX_GAMES = 50;
/** The server rejects anything above this. */
const MAX_GAMES_CAP = 500;

/**
 * Converts a `<input type="date">` value (`YYYY-MM-DD`) to epoch milliseconds,
 * or undefined when the field is blank/unparseable. Deliberately naive: the
 * backend only uses these as coarse bounds, so local-midnight is close enough.
 */
function dateToEpochMs(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Queues a bulk import of a player's games from Lichess or Chess.com. Unlike the
 * single-game forms this does not chain into analysis — it returns a job id and
 * the caller polls it to completion.
 */
export function BulkImportForm({ onImportStarted, onCancel }: BulkImportFormProps) {
  const [source, setSource] = useState<ImportSource>('lichess');
  const [username, setUsername] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [maxGames, setMaxGames] = useState(String(DEFAULT_MAX_GAMES));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setError('Enter a username to import games for.');
      return;
    }

    const sinceMs = dateToEpochMs(since);
    const untilMs = dateToEpochMs(until);
    if (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs) {
      setError('The "from" date must be before the "to" date.');
      return;
    }

    const parsedMax = Number(maxGames);
    if (!Number.isFinite(parsedMax) || parsedMax < 1) {
      setError('Max games must be a positive number.');
      return;
    }
    if (parsedMax > MAX_GAMES_CAP) {
      setError(`Max games cannot exceed ${MAX_GAMES_CAP}.`);
      return;
    }

    const request: CreateImportRequest = {
      source,
      username: trimmed,
      max_games: Math.floor(parsedMax),
    };
    if (sinceMs !== undefined) request.since = sinceMs;
    if (untilMs !== undefined) request.until = untilMs;

    setSubmitting(true);
    setError(null);
    try {
      const { job } = await createImportJob(request);
      onImportStarted(job.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <div className="panel__header">Bulk import games</div>

      <span className="form__label">Source</span>
      <div className="tabs" role="radiogroup" aria-label="Import source">
        <button
          type="button"
          role="radio"
          aria-checked={source === 'lichess'}
          className={`tabs__tab${source === 'lichess' ? ' tabs__tab--active' : ''}`}
          onClick={() => setSource('lichess')}
          disabled={submitting}
        >
          Lichess
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={source === 'chess_com'}
          className={`tabs__tab${source === 'chess_com' ? ' tabs__tab--active' : ''}`}
          onClick={() => setSource('chess_com')}
          disabled={submitting}
        >
          Chess.com
        </button>
      </div>

      <label className="form__label" htmlFor="bulk-import-username">
        {source === 'lichess' ? 'Lichess username' : 'Chess.com username'}
      </label>
      <input
        id="bulk-import-username"
        className="form__input"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder={source === 'lichess' ? 'DrNykterstein' : 'MagnusCarlsen'}
        autoComplete="off"
        disabled={submitting}
      />

      <div className="form__grid">
        <div className="form__field">
          <label className="form__label" htmlFor="bulk-import-since">
            From (optional)
          </label>
          <input
            id="bulk-import-since"
            className="form__input"
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="bulk-import-until">
            To (optional)
          </label>
          <input
            id="bulk-import-until"
            className="form__input"
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <label className="form__label" htmlFor="bulk-import-max">
        Max games
      </label>
      <input
        id="bulk-import-max"
        className="form__input"
        type="number"
        min={1}
        max={MAX_GAMES_CAP}
        step={1}
        value={maxGames}
        onChange={(event) => setMaxGames(event.target.value)}
        disabled={submitting}
      />
      <span className="form__hint">
        Leave the dates blank to take the most recent games. The server caps a single import at{' '}
        {MAX_GAMES_CAP} games.
      </span>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="form__row">
        <button className="button button--primary" type="submit" disabled={submitting}>
          {submitting ? 'Starting import…' : 'Start import'}
        </button>
        {onCancel && (
          <button className="button" type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
