import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { listGames } from '../../api/games';
import type { GameOutcomeFilter } from '../../api/games';
import { createAnalysisJob } from '../../api/analysis';
import { errorMessage } from '../../api/client';
import { BulkImportForm } from '../upload/BulkImportForm';
import { ImportProgress } from '../analysis/ImportProgress';
import { LibraryRowsSkeleton } from '../common/Skeleton';
import { AccuracyBadge } from '../common/AccuracyBadge';
import { IconRefresh } from '../common/Icons';
import { describeMatchup, formatPlayedAt } from '../../lib/gameDisplay';
import type { Game } from '../../types';

/** Panel shown in place of the list while a bulk import is being set up or run. */
type Mode = 'list' | 'import-setup' | 'import-running';

const PAGE_SIZE = 25;

export function GameLibraryPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [mode, setMode] = useState<Mode>('list');
  const [importJobId, setImportJobId] = useState<string | null>(null);

  // Filter *inputs* (what's in the text boxes right now) vs. the *applied*
  // filters the current fetch actually used — kept separate so typing in
  // the opponent/opening boxes doesn't refetch on every keystroke; only
  // submitting the form (or picking a result) applies them.
  const [opponentInput, setOpponentInput] = useState('');
  const [openingInput, setOpeningInput] = useState('');
  const [appliedOpponent, setAppliedOpponent] = useState('');
  const [appliedOpening, setAppliedOpening] = useState('');
  const [result, setResult] = useState<GameOutcomeFilter | ''>('');

  /** Which row's Analyze button is mid-flight, so only that one shows a spinner. */
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError(null);

    listGames(
      {
        limit: PAGE_SIZE,
        offset,
        opponent: appliedOpponent || undefined,
        opening: appliedOpening || undefined,
        result: result || undefined,
      },
      controller.signal,
    )
      .then((response) => {
        if (!active) return;
        setGames(response.games);
        setTotal(response.total);
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
  }, [offset, reloadToken, appliedOpponent, appliedOpening, result]);

  const handleFilterSubmit = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setAppliedOpponent(opponentInput.trim());
    setAppliedOpening(openingInput.trim());
  };

  const handleResultChange = (next: GameOutcomeFilter | '') => {
    setOffset(0);
    setResult(next);
  };

  const hasActiveFilters = appliedOpponent !== '' || appliedOpening !== '' || result !== '';

  const clearFilters = () => {
    setOpponentInput('');
    setOpeningInput('');
    setAppliedOpponent('');
    setAppliedOpening('');
    setResult('');
    setOffset(0);
  };

  const handleAnalyse = async (game: Game) => {
    setStartingId(game.id);
    setStartError(null);
    try {
      const job = await createAnalysisJob(game.id);
      navigate(`/analysis/${job.id}`);
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStartingId(null);
    }
  };

  const handleImportStarted = useCallback((jobId: string) => {
    setImportJobId(jobId);
    setMode('import-running');
  }, []);

  // Newly imported games only exist once the job finishes, so refresh then.
  const handleImportComplete = useCallback(() => {
    setOffset(0);
    reload();
  }, [reload]);

  const handleImportDone = useCallback(() => {
    setImportJobId(null);
    setMode('list');
  }, []);

  if (mode === 'import-setup') {
    return (
      <div className="upload-grid upload-grid--single">
        <BulkImportForm
          onImportStarted={handleImportStarted}
          onCancel={() => setMode('list')}
        />
      </div>
    );
  }

  if (mode === 'import-running' && importJobId) {
    return (
      <ImportProgress
        jobId={importJobId}
        label="Fetching games and adding them to your library"
        onComplete={handleImportComplete}
        onDone={handleImportDone}
      />
    );
  }

  const pageEnd = offset + games.length;
  const hasMore = pageEnd < total;

  return (
    <div className="library">
      <header className="library__header">
        <h2 className="library__title">Game library</h2>
        <span className="library__count">
          {total === 0 ? 'No games yet' : `${total} game${total === 1 ? '' : 's'}`}
        </span>
        <div className="library__actions">
          <button
            className="button button--primary"
            type="button"
            onClick={() => setMode('import-setup')}
          >
            Bulk import
          </button>
          <button className="button" type="button" onClick={() => navigate('/analyze')}>
            Back
          </button>
        </div>
      </header>

      <form className="library__filters" onSubmit={handleFilterSubmit}>
        <input
          className="library__filter-input"
          type="text"
          value={opponentInput}
          onChange={(event) => setOpponentInput(event.target.value)}
          placeholder="Opponent"
        />
        <input
          className="library__filter-input"
          type="text"
          value={openingInput}
          onChange={(event) => setOpeningInput(event.target.value)}
          placeholder="Opening"
        />
        <select
          className="library__filter-select"
          value={result}
          onChange={(event) => handleResultChange(event.target.value as GameOutcomeFilter | '')}
        >
          <option value="">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
        <button className="button button--primary" type="submit">
          Filter
        </button>
        {hasActiveFilters && (
          <button className="button" type="button" onClick={clearFilters}>
            Clear
          </button>
        )}
      </form>

      {error && (
        <div className="panel">
          <div className="alert alert--error">{error}</div>
          <div className="form__row">
            <button className="button" type="button" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      )}

      {startError && <div className="alert alert--error">{startError}</div>}

      {loading && (
        <div className="panel library__table-wrap">
          <table className="library__table">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col">Result</th>
                <th scope="col">Accuracy</th>
                <th scope="col">Date</th>
                <th scope="col">Opening</th>
                <th scope="col" className="library__col-action">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <LibraryRowsSkeleton />
          </table>
        </div>
      )}

      {!loading && !error && games.length === 0 && (
        <div className="panel library--empty">
          {hasActiveFilters ? (
            <>No games match these filters. <button className="library__filter-reset" type="button" onClick={clearFilters}>Clear them</button> to see your whole library.</>
          ) : (
            'Nothing here yet. Bulk import your games from Lichess or Chess.com, or upload a PGN.'
          )}
        </div>
      )}

      {!loading && !error && games.length > 0 && (
        <div className="panel library__table-wrap">
          <table className="library__table">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col">Result</th>
                <th scope="col">Accuracy</th>
                <th scope="col">Date</th>
                <th scope="col">Opening</th>
                <th scope="col" className="library__col-action">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => {
                const { line, outcome } = describeMatchup(game);
                return (
                  <tr key={game.id}>
                    <td>
                      <span className="library__matchup">{line}</span>
                    </td>
                    <td className="library__result">
                      {outcome ? (
                        <>
                          <strong className={`library__outcome library__outcome--${outcome.toLowerCase()}`}>
                            {outcome}
                          </strong>{' '}
                          <span className="library__score">{game.result}</span>
                        </>
                      ) : (
                        <span className="library__score">{game.result}</span>
                      )}
                    </td>
                    <td className="library__accuracy">
                      <AccuracyBadge game={game} />
                    </td>
                    <td className="library__date">{formatPlayedAt(game.played_at)}</td>
                    <td className="library__opening">
                      {game.opening_name || game.eco ? (
                        <>
                          {game.eco && <span className="library__eco">{game.eco}</span>}
                          {game.opening_name ?? ''}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="library__col-action">
                      {game.latest_completed_job_id ? (
                        <div className="library__actions-cell">
                          <button
                            className="button dashboard-card__reanalyse"
                            type="button"
                            onClick={() => void handleAnalyse(game)}
                            disabled={startingId !== null}
                            title="Re-analyse with the latest engine settings"
                            aria-label="Re-analyse this game"
                          >
                            <IconRefresh
                              className={
                                startingId === game.id
                                  ? 'dashboard-card__reanalyse-icon--spinning'
                                  : undefined
                              }
                            />
                          </button>
                          <button
                            className="button"
                            type="button"
                            onClick={() => navigate(`/analysis/${game.latest_completed_job_id}`)}
                          >
                            Reviewed
                          </button>
                        </div>
                      ) : (
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => void handleAnalyse(game)}
                          disabled={startingId !== null}
                        >
                          {startingId === game.id ? 'Starting…' : 'Analyze'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE && (
        <div className="controls library__pager">
          <button
            className="button"
            type="button"
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            disabled={offset === 0}
          >
            ◀ Previous
          </button>
          <span className="controls__counter">
            {offset + 1}–{pageEnd} of {total}
          </span>
          <button
            className="button"
            type="button"
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            disabled={!hasMore}
          >
            Next ▶
          </button>
        </div>
      )}
    </div>
  );
}
