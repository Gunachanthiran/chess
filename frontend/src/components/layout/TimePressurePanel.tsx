import { useEffect, useState } from 'react';
import { getTimePressure } from '../../api/games';
import { classificationColor } from '../../styles/classification-colors';
import type { TimeBucket, TimeBucketList } from '../../types';

const BUCKET_LABEL: Record<TimeBucket['bucket'], string> = {
  plenty: 'Plenty of time',
  low: 'Running low',
  critical: 'Critical (≤30s)',
};

function errorRateColor(pct: number): string {
  if (pct <= 10) return '#96bc4b';
  if (pct <= 20) return '#f7c631';
  return '#ca3431';
}

function BucketRow({ bucket }: { bucket: TimeBucket }) {
  const { inaccuracies, mistakes, blunders, total_moves: totalMoves } = bucket;
  const goodMoves = Math.max(0, totalMoves - inaccuracies - mistakes - blunders);
  const segments: { count: number; color: string }[] = [
    { count: goodMoves, color: 'var(--border)' },
    { count: inaccuracies, color: classificationColor('inaccuracy') },
    { count: mistakes, color: classificationColor('mistake') },
    { count: blunders, color: classificationColor('blunder') },
  ];

  return (
    <div className="phase-breakdown__row">
      <div className="phase-breakdown__row-head">
        <span className="phase-breakdown__phase">{BUCKET_LABEL[bucket.bucket]}</span>
        <span className="phase-breakdown__count">{totalMoves} moves</span>
        <span
          className="phase-breakdown__rate"
          style={{ color: errorRateColor(bucket.error_rate_pct) }}
        >
          {Math.round(bucket.error_rate_pct)}% errors
        </span>
      </div>
      <div className="phase-breakdown__bar">
        {totalMoves === 0 ? (
          <div className="phase-breakdown__segment" style={{ width: '100%', background: 'var(--bg-sunken)' }} />
        ) : (
          segments.map(
            (segment, index) =>
              segment.count > 0 && (
                <div
                  key={index}
                  className="phase-breakdown__segment"
                  style={{ width: `${(100 * segment.count) / totalMoves}%`, background: segment.color }}
                />
              ),
          )
        )}
      </div>
    </div>
  );
}

/**
 * "Do your real errors cluster when you're low on time" — every analysed
 * move with a parseable `%clk` PGN annotation, bucketed by clock remaining
 * (see `time_pressure_stats.py`). Same visual language as
 * `PhaseBreakdownPanel` (reuses its `.phase-breakdown__*` classes) since
 * it's the same shape of report - a stacked bar and an error rate per
 * bucket - just bucketed by clock instead of by game phase.
 *
 * Renders nothing when every bucket is empty: an account with no Chess.com/
 * Lichess games analysed yet (bot games and uploads generally carry no
 * clock data at all) has nothing to show here.
 */
export function TimePressurePanel() {
  const [buckets, setBuckets] = useState<TimeBucketList | null>(null);

  useEffect(() => {
    let active = true;
    getTimePressure()
      .then((data) => {
        if (active) setBuckets(data);
      })
      .catch(() => {
        // Non-fatal — the panel just doesn't render.
      });
    return () => {
      active = false;
    };
  }, []);

  const totalMoves = buckets?.reduce((sum, bucket) => sum + bucket.total_moves, 0) ?? 0;
  if (!buckets || totalMoves === 0) return null;

  return (
    <div className="panel phase-breakdown">
      <div className="library__header">
        <h3 className="library__title">Time pressure</h3>
        <span className="library__count">error rate by clock remaining</span>
      </div>

      <div className="phase-breakdown__rows">
        {buckets.map((bucket) => (
          <BucketRow key={bucket.bucket} bucket={bucket} />
        ))}
      </div>
    </div>
  );
}
