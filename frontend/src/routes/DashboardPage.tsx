import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listGames } from '../api/games';
import { listBotGames } from '../api/botGames';
import { createAnalysisJob } from '../api/analysis';
import { createImportJob } from '../api/imports';
import { errorMessage } from '../api/client';
import type { UseAccountStatusResult } from '../hooks/useAccountStatus';
import { ImportProgress } from '../components/analysis/ImportProgress';
import { DashboardGridSkeleton } from '../components/common/Skeleton';
import { AccuracyBadge } from '../components/common/AccuracyBadge';
import { IconRefresh } from '../components/common/Icons';
import { DashboardStats } from '../components/layout/DashboardStats';
import { describeMatchup, formatTimeAgo } from '../lib/gameDisplay';
import { isGrandmasterElo } from '../lib/botConstants';
import type { BotGameSummary, Game, GameSource, ImportSource } from '../types';

/** One connected account queued for `handleSync`. */
type SyncTarget = { source: ImportSource; username: string };

type Tab = 'all' | 'lichess' | 'chess_com' | 'bots' | 'imported';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'lichess', label: 'Lichess' },
  { id: 'chess_com', label: 'Chess.com' },
  { id: 'bots', label: 'Bots' },
  { id: 'imported', label: 'Imported' },
];

const PAGE_SIZE = 12;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function sourceForTab(tab: Tab): GameSource | undefined {
  if (tab === 'lichess') return 'lichess';
  if (tab === 'chess_com') return 'chess_com';
  if (tab === 'imported') return 'upload';
  return undefined;
}

function sourceLabel(source: GameSource): string {
  if (source === 'lichess') return 'Lichess';
  if (source === 'chess_com') return 'Chess.com';
  return 'Imported PGN';
}

function ResultBadge({ label, variant }: { label: string; variant: 'win' | 'loss' | 'draw' | 'neutral' | 'live' }) {
  return <span className={`dashboard-card__badge dashboard-card__badge--${variant}`}>{label}</span>;
}

function GameCard({
  game,
  onAnalyse,
  onReview,
  analysing,
}: {
  game: Game;
  onAnalyse: () => void;
  onReview: () => void;
  analysing: boolean;
}) {
  const { outcome } = describeMatchup(game);
  const badgeLabel = outcome ?? (game.result === '1/2-1/2' ? 'Draw' : game.result);
  const badgeVariant =
    outcome === 'Win' ? 'win' : outcome === 'Loss' ? 'loss' : outcome === 'Draw' ? 'draw' : 'neutral';
  const isReviewed = game.latest_completed_job_id !== null;

  return (
    <div className="panel dashboard-card">
      <div className="dashboard-card__head">
        <span className="dashboard-card__source">{sourceLabel(game.source)}</span>
        <ResultBadge label={badgeLabel.toUpperCase()} variant={badgeVariant} />
      </div>

      <div className="dashboard-card__players">
        <div className="dashboard-card__player">
          <span className="dashboard-card__disc dashboard-card__disc--white" aria-hidden="true" />
          {game.white_name}
        </div>
        <div className="dashboard-card__player">
          <span className="dashboard-card__disc dashboard-card__disc--black" aria-hidden="true" />
          {game.black_name}
        </div>
      </div>

      {(game.opening_name || game.eco) && (
        <div className="dashboard-card__opening">
          {game.eco ? `${game.eco} ` : ''}
          {game.opening_name ?? ''}
        </div>
      )}

      <div className="dashboard-card__foot">
        <span className="dashboard-card__foot-meta">
          <span className="dashboard-card__meta">{formatTimeAgo(game.played_at ?? game.created_at)}</span>
          <AccuracyBadge game={game} />
        </span>
        {isReviewed ? (
          <div className="dashboard-card__reviewed-actions">
            <button
              className="button dashboard-card__reanalyse"
              type="button"
              onClick={onAnalyse}
              disabled={analysing}
              title="Re-analyse with the latest engine settings"
              aria-label="Re-analyse this game"
            >
              <IconRefresh className={analysing ? 'dashboard-card__reanalyse-icon--spinning' : undefined} />
            </button>
            <button className="button" type="button" onClick={onReview}>
              Reviewed
            </button>
          </div>
        ) : (
          <button className="button button--primary" type="button" onClick={onAnalyse} disabled={analysing}>
            {analysing ? 'Starting…' : 'Analyze'}
          </button>
        )}
      </div>
    </div>
  );
}

function BotGameCard({ botGame, onOpen }: { botGame: BotGameSummary; onOpen: () => void }) {
  const isLive = botGame.status === 'in_progress';
  const badgeLabel = isLive ? 'LIVE' : (botGame.result ?? botGame.status).toUpperCase();

  return (
    <div className="panel dashboard-card">
      <div className="dashboard-card__head">
        <span className="dashboard-card__source">Bot game</span>
        <ResultBadge label={badgeLabel} variant={isLive ? 'live' : 'neutral'} />
      </div>

      <div className="dashboard-card__players">
        <div className="dashboard-card__player">
          <span className="dashboard-card__disc dashboard-card__disc--black" aria-hidden="true" />
          Tal bot ({isGrandmasterElo(botGame.bot_elo) ? 'Grandmaster' : botGame.bot_elo})
        </div>
        <div className="dashboard-card__player">
          <span
            className={`dashboard-card__disc dashboard-card__disc--${botGame.player_color}`}
            aria-hidden="true"
          />
          You
        </div>
      </div>

      {(botGame.opening_name || botGame.opening_eco) && (
        <div className="dashboard-card__opening">
          {botGame.opening_eco ? `${botGame.opening_eco} ` : ''}
          {botGame.opening_name ?? ''}
        </div>
      )}

      <div className="dashboard-card__foot">
        <span className="dashboard-card__meta">
          {botGame.move_count} moves · {formatTimeAgo(botGame.updated_at)}
        </span>
        <button className="button" type="button" onClick={onOpen}>
          {isLive ? 'Continue' : 'View'}
        </button>
      </div>
    </div>
  );
}

/**
 * `/` — the chessiro-style home once at least one account is connected (see
 * `App.tsx`'s route guard). Renders `<ImportProgress>` inline whenever
 * `?import_job=` is present — the Lichess OAuth callback and the Chess.com
 * connect form both land here with that param set, right after triggering a
 * full-history import (see `routers/auth.py`).
 */
export function DashboardPage({ account }: { account: UseAccountStatusResult }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { status } = account;

  const [tab, setTab] = useState<Tab>('all');
  const [offset, setOffset] = useState(0);
  const [games, setGames] = useState<Game[]>([]);
  const [botGames, setBotGames] = useState<BotGameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [inProgressBotGame, setInProgressBotGame] = useState<BotGameSummary | null>(null);
  // Chess.com/Lichess never push new games to us — the library is only ever
  // as fresh as the last import. `syncQueue` drives the "Sync latest games"
  // button through one `ImportProgress` job per connected account in turn
  // (the same rendering path the OAuth/connect-form imports already use),
  // rather than trying to run both accounts' jobs at once.
  const [syncQueue, setSyncQueue] = useState<SyncTarget[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const importJobId = searchParams.get('import_job');

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const setImportJobId = useCallback(
    (jobId: string) => {
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          next.set('import_job', jobId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const startNextSync = useCallback(
    async (queue: SyncTarget[]) => {
      const [next, ...rest] = queue;
      if (!next) {
        setSyncing(false);
        return;
      }
      setSyncQueue(rest);
      try {
        // Only pull what's newer than the most recent game we already have
        // for this source, instead of re-walking the player's entire
        // archive history every time the button is pressed.
        const latest = await listGames({ limit: 1, offset: 0, source: next.source });
        const latestPlayedAt = latest.games[0]?.played_at ?? latest.games[0]?.created_at;
        const since = latestPlayedAt ? Date.parse(latestPlayedAt) : undefined;
        const response = await createImportJob({
          source: next.source,
          username: next.username,
          since,
        });
        setImportJobId(response.job.id);
      } catch (err) {
        setSyncError(errorMessage(err));
        setSyncing(false);
        setSyncQueue([]);
      }
    },
    [setImportJobId],
  );

  const handleSync = () => {
    const queue: SyncTarget[] = [];
    if (status?.chess_com) queue.push({ source: 'chess_com', username: status.chess_com.username });
    if (status?.lichess) queue.push({ source: 'lichess', username: status.lichess.username });
    if (queue.length === 0) return;
    setSyncing(true);
    setSyncError(null);
    void startNextSync(queue);
  };

  const changeTab = useCallback((next: Tab) => {
    setTab(next);
    setOffset(0); // A new tab is a different filtered set — page 1 of it.
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    const request =
      tab === 'bots'
        ? listBotGames({ limit: PAGE_SIZE, offset }, controller.signal).then((response) => {
            if (!active) return;
            setBotGames(response.bot_games);
            setTotal(response.total);
          })
        : listGames(
            { limit: PAGE_SIZE, offset, source: sourceForTab(tab) },
            controller.signal,
          ).then((response) => {
            if (!active) return;
            setGames(response.games);
            setTotal(response.total);
          });

    request
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
  }, [tab, offset, reloadToken]);

  // The "game in progress" banner is independent of the active tab, so it
  // fetches on its own rather than piggybacking on the tab-scoped effect.
  useEffect(() => {
    const controller = new AbortController();
    listBotGames({ limit: 5 }, controller.signal)
      .then((response) => {
        setInProgressBotGame(response.bot_games.find((g) => g.status === 'in_progress') ?? null);
      })
      .catch(() => {
        // Non-critical — the banner just stays hidden.
      });
    return () => controller.abort();
  }, [reloadToken]);

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

  const handleImportComplete = useCallback(() => {
    setOffset(0); // Freshly imported games land at the top now that it's sorted by play date.
    reload();
  }, [reload]);

  const handleImportDone = useCallback(() => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete('import_job');
        return next;
      },
      { replace: true },
    );
    // A sync-triggered job clearing out is the cue to start the next queued
    // account, if any — this is the only place both the OAuth/connect-form
    // import path and the Sync button's queue path rejoin.
    setSyncQueue((queue) => {
      if (queue.length > 0) void startNextSync(queue);
      else setSyncing(false);
      return queue;
    });
  }, [setSearchParams, startNextSync]);

  const displayName = status?.lichess?.username ?? status?.chess_com?.username ?? 'there';
  // Lichess has no avatar feature at all, so this is Chess.com-or-nothing —
  // `null` falls back to the plain coloured-initial circle below.
  const avatarUrl = status?.chess_com?.avatar_url ?? null;

  return (
    <div className="dashboard">
      <div className="dashboard__greeting">
        {avatarUrl ? (
          <img className="dashboard__avatar dashboard__avatar--photo" src={avatarUrl} alt="" />
        ) : (
          <div className="dashboard__avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <div className="dashboard__greeting-label">{greeting()},</div>
          <h2 className="dashboard__name">{displayName}</h2>
        </div>
      </div>

      <DashboardStats />

      {importJobId && (
        <ImportProgress
          jobId={importJobId}
          label="Fetching your games"
          onComplete={handleImportComplete}
          onDone={handleImportDone}
        />
      )}

      {inProgressBotGame && (
        <div className="dashboard__banner">
          <div>
            <strong>Game in progress</strong>
            <span className="dashboard__banner-meta">
              {' '}
              vs Tal bot —{' '}
              {isGrandmasterElo(inProgressBotGame.bot_elo) ? 'Grandmaster' : inProgressBotGame.bot_elo}
            </span>
          </div>
          <button
            className="button button--primary"
            type="button"
            onClick={() => navigate(`/play/${inProgressBotGame.id}`)}
          >
            Join
          </button>
        </div>
      )}

      <div className="dashboard__section-head">
        <h3 className="dashboard__section-title">Analyze Your Games</h3>
        {(status?.chess_com || status?.lichess) && (
          <button
            className="button dashboard__sync"
            type="button"
            onClick={handleSync}
            disabled={syncing || importJobId !== null}
            title="Pull any games played since your last import"
          >
            {syncing
              ? syncQueue.length > 0
                ? `Syncing… (${syncQueue.length} more)`
                : 'Syncing…'
              : '⟳ Sync latest games'}
          </button>
        )}
      </div>

      {syncError && <div className="alert alert--error">{syncError}</div>}

      <div className="dashboard__tabs" role="tablist" aria-label="Filter games">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`dashboard__tab${tab === item.id ? ' dashboard__tab--active' : ''}`}
            onClick={() => changeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {startError && <div className="alert alert--error">{startError}</div>}

      {loading && <DashboardGridSkeleton />}

      {!loading && !error && tab === 'bots' && botGames.length === 0 && (
        <div className="panel dashboard--empty">No bot games yet — play one from Play Bot.</div>
      )}

      {!loading && !error && tab !== 'bots' && games.length === 0 && (
        <div className="panel dashboard--empty">
          Nothing here yet. Connect another account from the login page, or upload a PGN from
          the Analyze tab.
        </div>
      )}

      {!loading && !error && (
        <div className="dashboard__grid">
          {tab === 'bots'
            ? botGames.map((botGame) => (
                <BotGameCard
                  key={botGame.id}
                  botGame={botGame}
                  onOpen={() => navigate(`/play/${botGame.id}`)}
                />
              ))
            : games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  analysing={startingId === game.id}
                  onAnalyse={() => void handleAnalyse(game)}
                  onReview={() => navigate(`/analysis/${game.latest_completed_job_id}`)}
                />
              ))}
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE && (
        <div className="controls dashboard__pager">
          <button
            className="button"
            type="button"
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            disabled={offset === 0}
          >
            ◀ Previous
          </button>
          <span className="controls__counter">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            className="button"
            type="button"
            onClick={() => setOffset((value) => value + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
          >
            Next ▶
          </button>
        </div>
      )}
    </div>
  );
}
