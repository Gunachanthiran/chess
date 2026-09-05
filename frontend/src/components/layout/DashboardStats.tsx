import type { ReactElement } from 'react';
import { IconGames, IconStreak, IconTarget } from '../common/Icons';
import type { GameStats } from '../../types';

type IconComponent = (props: { className?: string }) => ReactElement;

function StatCard({
  Icon,
  value,
  label,
}: {
  Icon: IconComponent;
  value: string;
  label: string;
}) {
  return (
    <div className="panel stats-card">
      <span className="stats-card__icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="stats-card__body">
        <div className="stats-card__value">{value}</div>
        <div className="stats-card__label">{label}</div>
      </div>
    </div>
  );
}

/**
 * Dashboard-only stats strip: current streak, how much of the library has
 * actually been analysed, and recent-form accuracy — everything real,
 * computed server-side from the *whole* game history (`GET /api/games/stats`,
 * see `game_stats.py`), not just the page of games currently on screen.
 *
 * Takes `stats` as a prop rather than fetching its own copy: `/stats` scans
 * every game in the account, and `DashboardPage` also feeds the same
 * response to `AccuracyTrendChart` — fetching once and sharing it avoids
 * running that query twice on every dashboard load. `null` (still loading,
 * or the fetch failed) and an empty account both render nothing, the same
 * degrade-gracefully contract `RecommendationsPanel` uses for its own
 * optional data.
 */
export function DashboardStats({ stats }: { stats: GameStats | null }) {
  if (!stats || stats.total_games === 0) return null;

  const streakLabel = stats.current_streak_days === 1 ? 'day streak' : 'day streak';
  const accuracyValue =
    stats.recent_accuracy !== null ? `${Math.round(stats.recent_accuracy)}%` : '—';

  return (
    <div className="dashboard__stats">
      <StatCard Icon={IconStreak} value={String(stats.current_streak_days)} label={streakLabel} />
      <StatCard
        Icon={IconGames}
        value={String(stats.analyzed_games)}
        label={`of ${stats.total_games} analysed`}
      />
      <StatCard Icon={IconTarget} value={accuracyValue} label="recent accuracy" />
    </div>
  );
}
