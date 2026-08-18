import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { lookupPlayer } from '../api/players';
import { errorMessage } from '../api/client';
import { IconBook, IconBullet, IconClock, IconHourglass } from '../components/common/Icons';
import type { ImportSource, PlayerLookup } from '../types';

const FORMAT_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

const FORMAT_ICONS: Record<string, (props: { className?: string }) => ReactElement> = {
  bullet: IconBullet,
  blitz: IconClock,
  rapid: IconHourglass,
  classical: IconBook,
};

function ResultCard({ player }: { player: PlayerLookup }) {
  const initial = (player.display_name ?? player.username).slice(0, 1).toUpperCase();
  const wins = player.wins ?? 0;
  const losses = player.losses ?? 0;
  const draws = player.draws ?? 0;
  const totalGames = wins + losses + draws;
  const winPct = totalGames > 0 ? (wins / totalGames) * 100 : 0;
  const drawPct = totalGames > 0 ? (draws / totalGames) * 100 : 0;

  return (
    <div className="panel player-result">
      <div className="player-result__head">
        {player.avatar_url ? (
          <img className="player-result__avatar player-result__avatar--photo" src={player.avatar_url} alt="" />
        ) : (
          <div className="player-result__avatar" aria-hidden="true">
            {initial}
          </div>
        )}
        <div className="player-result__identity">
          <div className="player-result__name">
            {player.display_name ?? player.username}
            {player.title && <span className="player-result__title">{player.title}</span>}
          </div>
          <div className="player-result__meta">
            @{player.username}
            {player.country && ` · ${player.country}`}
          </div>
        </div>
        {player.profile_url && (
          <a
            className="button player-result__link"
            href={player.profile_url}
            target="_blank"
            rel="noreferrer"
          >
            View profile ↗
          </a>
        )}
      </div>

      {totalGames > 0 && (
        <div className="player-result__record">
          <div className="player-result__record-bar" aria-hidden="true">
            <span className="player-result__record-bar-win" style={{ width: `${winPct}%` }} />
            <span className="player-result__record-bar-draw" style={{ width: `${drawPct}%` }} />
          </div>
          <div className="player-result__record-labels">
            <span className="player-result__record-item player-result__record-item--win">
              {wins} W
            </span>
            <span className="player-result__record-item player-result__record-item--loss">
              {losses} L
            </span>
            <span className="player-result__record-item player-result__record-item--draw">
              {draws} D
            </span>
          </div>
        </div>
      )}

      {player.ratings.length > 0 && (
        <div className="player-result__ratings">
          {player.ratings.map((rating) => {
            const Icon = FORMAT_ICONS[rating.format];
            return (
              <div key={rating.format} className="player-result__rating">
                {Icon && (
                  <span className="player-result__rating-icon" aria-hidden="true">
                    <Icon />
                  </span>
                )}
                <div>
                  <div className="player-result__rating-value">{rating.rating ?? '—'}</div>
                  <div className="player-result__rating-label">
                    {FORMAT_LABELS[rating.format] ?? rating.format}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * `/players` — look up any public Chess.com or Lichess player by username and
 * see their ratings and W/L/D record. Unlike everything else in the app this
 * never touches a connected account or the local database: it is a thin,
 * read-only window onto each site's own public API.
 */
export function PlayerSearchPage() {
  const [source, setSource] = useState<ImportSource>('chess_com');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerLookup | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      setError('Enter a username to search for.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await lookupPlayer(source, trimmed);
      setPlayer(result);
    } catch (err) {
      setPlayer(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="start">
      <div className="start__head">
        <h2 className="start__title">Player search</h2>
        <p className="start__subtitle">
          Look up anyone's public Chess.com or Lichess profile — ratings and results, no
          account connection needed.
        </p>
      </div>

      <div className="player-search__body">
        <form className="panel form" onSubmit={handleSubmit}>
          <span className="form__label">Source</span>
          <div className="tabs" role="radiogroup" aria-label="Player search source">
            <button
              type="button"
              role="radio"
              aria-checked={source === 'chess_com'}
              className={`tabs__tab${source === 'chess_com' ? ' tabs__tab--active' : ''}`}
              onClick={() => setSource('chess_com')}
              disabled={loading}
            >
              Chess.com
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === 'lichess'}
              className={`tabs__tab${source === 'lichess' ? ' tabs__tab--active' : ''}`}
              onClick={() => setSource('lichess')}
              disabled={loading}
            >
              Lichess
            </button>
          </div>

          <label className="form__label" htmlFor="player-search-username">
            Username
          </label>
          <div className="form__row">
            <input
              id="player-search-username"
              className="form__input"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={source === 'chess_com' ? 'MagnusCarlsen' : 'DrNykterstein'}
              autoComplete="off"
              disabled={loading}
            />
            <button
              className={`button button--primary${loading ? ' button--loading' : ''}`}
              type="submit"
              disabled={loading}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {error && <div className="alert alert--error">{error}</div>}

        {player && <ResultCard player={player} />}
      </div>
    </section>
  );
}
