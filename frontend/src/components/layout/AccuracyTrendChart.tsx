import { useMemo } from 'react';
import { accuracyColor } from '../../styles/classification-colors';
import type { AccuracyTrendPoint } from '../../types';

type AccuracyTrendChartProps = {
  points: AccuracyTrendPoint[];
};

// Internal drawing units — same convention as `EvalGraph`: the SVG scales to
// its container via `viewBox`, so these are arbitrary but fixed.
const WIDTH = 1000;
const HEIGHT = 160;
const PAD = 10;

/**
 * Recent-form accuracy, one point per analysed game, oldest to newest —
 * hand-rolled SVG like `EvalGraph` rather than a charting dependency, for
 * the same reason: a single series with no interaction to speak of doesn't
 * need one.
 *
 * Takes `points` as a prop (`GET /api/games/stats`'s `accuracy_trend`
 * field) rather than fetching its own copy — `DashboardStats` already
 * fetches that same endpoint for the stat cards, and `/stats` scans every
 * game in the account (see `game_stats.py`), so a second independent call
 * from this component would double a real, non-trivial query on every
 * dashboard load for nothing.
 */
export function AccuracyTrendChart({ points }: AccuracyTrendChartProps) {
  const { linePath, dots, average } = useMemo(() => {
    const count = points.length;
    if (count === 0) return { linePath: '', dots: [], average: 0 };

    // A single point has nothing to draw a line between — still shown as one
    // dot, centred, rather than an empty chart.
    const xFor = (index: number) => (count === 1 ? WIDTH / 2 : (index / (count - 1)) * WIDTH);
    const yFor = (accuracy: number) => PAD + (1 - accuracy / 100) * (HEIGHT - 2 * PAD);

    const computed = points.map((point, index) => ({
      x: xFor(index),
      y: yFor(point.accuracy),
      accuracy: point.accuracy,
    }));

    const line = computed
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');

    const mean = points.reduce((sum, point) => sum + point.accuracy, 0) / count;

    return { linePath: line, dots: computed, average: mean };
  }, [points]);

  if (points.length === 0) return null;

  return (
    <div className="panel accuracy-trend">
      <div className="library__header">
        <h3 className="library__title">Accuracy trend</h3>
        <span className="library__count">last {points.length} games</span>
      </div>

      <svg
        className="accuracy-trend__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Accuracy over your last ${points.length} analysed games, averaging ${Math.round(average)}%`}
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} style={{ fill: 'var(--bg-sunken)' }} />

        {/* Reference lines at 100/75/50/25/0% accuracy. */}
        {[0, 25, 50, 75, 100].map((mark) => {
          const y = PAD + (1 - mark / 100) * (HEIGHT - 2 * PAD);
          return (
            <line
              key={mark}
              x1="0"
              y1={y}
              x2={WIDTH}
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />

        {dots.map((dot, index) => (
          <circle
            key={index}
            cx={dot.x}
            cy={dot.y}
            r="4"
            style={{ fill: accuracyColor(dot.accuracy) }}
          />
        ))}
      </svg>
    </div>
  );
}
