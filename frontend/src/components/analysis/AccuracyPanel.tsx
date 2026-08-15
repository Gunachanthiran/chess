import { accuracyColor } from '../../styles/classification-colors';
import type { Game } from '../../types';

type AccuracyPanelProps = {
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  game: Game | null;
};

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function AccuracyRing({
  label,
  accuracy,
}: {
  label: string;
  accuracy: number | null;
}) {
  const value = accuracy ?? 0;
  const color = accuracy === null ? '#4a4f57' : accuracyColor(value);
  const dash = (Math.max(0, Math.min(100, value)) / 100) * CIRCUMFERENCE;

  return (
    <div className="accuracy__item">
      <svg className="accuracy__ring" viewBox="0 0 64 64" role="img" aria-label={`${label} accuracy`}>
        <circle cx="32" cy="32" r={RADIUS} fill="none" stroke="#2a2d33" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" textAnchor="middle" className="accuracy__value" fill={color}>
          {accuracy === null ? '--' : accuracy.toFixed(1)}
        </text>
      </svg>
      <div className="accuracy__label">{label}</div>
    </div>
  );
}

/** Side-by-side accuracy rings, colour-banded 90+/75+/60+/below. */
export function AccuracyPanel({ whiteAccuracy, blackAccuracy, game }: AccuracyPanelProps) {
  return (
    <div className="panel-section accuracy">
      <div className="panel__header">Accuracy</div>
      <div className="accuracy__grid">
        <AccuracyRing label={game?.white_name ?? 'White'} accuracy={whiteAccuracy} />
        <AccuracyRing label={game?.black_name ?? 'Black'} accuracy={blackAccuracy} />
      </div>
    </div>
  );
}
