import { useState } from 'react';
import type { FormEvent } from 'react';
import { getHeadToHead } from '../../api/games';
import { errorMessage } from '../../api/client';
import { accuracyColor } from '../../styles/classification-colors';
import type { HeadToHead } from '../../types';

function scoreColor(scorePct: number): string {
  if (scorePct >= 60) return '#96bc4b';
  if (scorePct >= 45) return '#f7c631';
  return '#ca3431';
}

/**
 * "How have I actually done against this specific person" — a plain name
 * search over your own local game history (any source: Lichess, Chess.com,
 * uploads, bot games). Deliberately a separate component from
 * `PlayerSearchPage`, which is documented as never touching the local
 * database at all (a thin window onto each site's own public API) — this is
 * the opposite: purely local data, no external call.
 */
export function HeadToHeadPanel() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HeadToHead | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter an opponent name to search for.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getHeadToHead(trimmed);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel head-to-head">
      <div className="library__header">
        <h3 className="library__title">Head-to-head</h3>
        <span className="library__count">your record against one opponent</span>
      </div>

      <form className="head-to-head__form" onSubmit={handleSubmit}>
        <input
          className="head-to-head__input"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Opponent's username"
        />
        <button className="button button--primary" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <div className="alert alert--error">{error}</div>}

      {result && !error && (
        <div className="head-to-head__result">
          {result.games === 0 ? (
            <p className="head-to-head__empty">
              No games found against "{result.opponent_name}".
            </p>
          ) : (
            <>
              <div className="head-to-head__row">
                <span className="head-to-head__opponent">{result.opponent_name}</span>
                <span className="head-to-head__games">{result.games} games</span>
              </div>
              <div className="head-to-head__stats">
                <div className="head-to-head__stat">
                  <div className="head-to-head__stat-value">
                    {result.wins}W {result.losses}L {result.draws}D
                  </div>
                  <div className="head-to-head__stat-label">record</div>
                </div>
                <div className="head-to-head__stat">
                  <div
                    className="head-to-head__stat-value"
                    style={{ color: scoreColor(result.score_pct) }}
                  >
                    {Math.round(result.score_pct)}%
                  </div>
                  <div className="head-to-head__stat-label">score</div>
                </div>
                <div className="head-to-head__stat">
                  <div
                    className="head-to-head__stat-value"
                    style={
                      result.avg_accuracy !== null
                        ? { color: accuracyColor(result.avg_accuracy) }
                        : undefined
                    }
                  >
                    {result.avg_accuracy !== null ? `${Math.round(result.avg_accuracy)}%` : '—'}
                  </div>
                  <div className="head-to-head__stat-label">avg accuracy</div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
