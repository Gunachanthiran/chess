import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { getGameStats } from '../../api/games';
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
 * A best-effort widget, not a critical one: renders nothing while loading
 * and nothing on failure or an empty account, the same degrade-gracefully
 * contract `RecommendationsPanel` uses for its own optional data.
 */
export function DashboardStats() {
  const [stats, setStats] = useState<GameStats | null>(null);

  useEffect(() => {
    let active = true;
    getGameStats()
      .then((data) => {
        if (active) setStats(data);
      })
      .catch(() => {
        // Non-fatal — the widget just doesn't render (see below).
      });
    return () => {
      active = false;
    };
  }, []);

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
