import { useState } from 'react';
import type { FormEvent } from 'react';
import { importLichessGame, importLichessRecent } from '../../api/games';
import { createAnalysisJob } from '../../api/analysis';
import { errorMessage } from '../../api/client';
import type { AnalysisJob, Game } from '../../types';

type ImportFromLichessFormProps = {
  onAnalysisStarted: (game: Game, job: AnalysisJob) => void;
};

type Mode = 'game-id' | 'username';

/**
 * Extracts the game id from a pasted Lichess URL so users can paste the whole
 * address rather than hunting for the 8-character id.
 */
function normaliseGameId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/lichess\.org\/([A-Za-z0-9]{8,12})/);
  return match ? match[1] : trimmed;
}

export function ImportFromLichessForm({ onAnalysisStarted }: ImportFromLichessFormProps) {
  const [mode, setMode] = useState<Mode>('game-id');
  const [gameId, setGameId] = useState('');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const value = mode === 'game-id' ? normaliseGameId(gameId) : username.trim();
    if (value.length === 0) {
      setError(mode === 'game-id' ? 'Enter a Lichess game ID or URL.' : 'Enter a username.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const game =
        mode === 'game-id' ? await importLichessGame(value) : await importLichessRecent(value);
      const job = await createAnalysisJob(game.id);
      onAnalysisStarted(game, job);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <div className="panel__header">Import from Lichess</div>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'game-id'}
          className={`tabs__tab${mode === 'game-id' ? ' tabs__tab--active' : ''}`}
          onClick={() => setMode('game-id')}
          disabled={submitting}
        >
          By game ID
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'username'}
          className={`tabs__tab${mode === 'username' ? ' tabs__tab--active' : ''}`}
          onClick={() => setMode('username')}
          disabled={submitting}
        >
          Most recent by user
        </button>
      </div>

      {mode === 'game-id' ? (
        <>
          <label className="form__label" htmlFor="lichess-game-id">
            Game ID or URL
          </label>
          <input
            id="lichess-game-id"
            className="form__input"
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            placeholder="abcd1234 or https://lichess.org/abcd1234"
            autoComplete="off"
            disabled={submitting}
          />
        </>
      ) : (
        <>
          <label className="form__label" htmlFor="lichess-username">
            Lichess username
          </label>
          <input
            id="lichess-username"
            className="form__input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="DrNykterstein"
            autoComplete="off"
            disabled={submitting}
          />
          <span className="form__hint">Imports that player&rsquo;s most recent game.</span>
        </>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <button
        className={`button button--primary${submitting ? ' button--loading' : ''}`}
        type="submit"
        disabled={submitting}
      >
        {submitting ? 'Importing…' : 'Import & analyse'}
      </button>
    </form>
  );
}
