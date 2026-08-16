import { myAccuracy } from '../../lib/gameDisplay';
import type { Game } from '../../types';

type Band = 'great' | 'ok' | 'low';

function band(accuracy: number): Band {
  if (accuracy >= 85) return 'great';
  if (accuracy >= 60) return 'ok';
  return 'low';
}

/**
 * My-side accuracy for one game, colour-banded — `null` (renders nothing)
 * until a job has actually completed for it, same as every other
 * per-game analysis output in this app.
 */
export function AccuracyBadge({ game }: { game: Game }) {
  const accuracy = myAccuracy(game);
  if (accuracy === null) return null;

  return (
    <span
      className={`accuracy-badge accuracy-badge--${band(accuracy)}`}
      title={`${accuracy.toFixed(1)}% accuracy`}
    >
      {Math.round(accuracy)}%
    </span>
  );
}
