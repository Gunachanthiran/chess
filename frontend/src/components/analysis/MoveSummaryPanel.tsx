import { useMemo } from 'react';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import type { Classification, MoveAnalysis } from '../../types';

type MoveSummaryPanelProps = {
  /** The whole game — both sides mixed, exactly as the API returns it. */
  moves: MoveAnalysis[];
};

/**
 * Display order: most impressive first, worst last, with `forced` parked at the
 * bottom since it is a neutral bookkeeping category rather than a grade.
 */
const DISPLAY_ORDER: Classification[] = [
  'brilliant',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
  'forced',
];

type Tally = Record<Classification, { white: number; black: number }>;

function emptyTally(): Tally {
  return DISPLAY_ORDER.reduce((acc, classification) => {
    acc[classification] = { white: 0, black: 0 };
    return acc;
  }, {} as Tally);
}

/**
 * Per-classification move counts for each side, chess.com/chessiro style.
 *
 * Every row is rendered even at zero, so the panel keeps a fixed height and the
 * eye can compare the same row position between games.
 */
export function MoveSummaryPanel({ moves }: MoveSummaryPanelProps) {
  const tally = useMemo(() => {
    const counts = emptyTally();
    moves.forEach((move) => {
      // A classification outside the known union would have no row to land in;
      // skip it rather than crash the panel.
      const row = counts[move.classification];
      if (!row) return;
      if (move.side === 'white') row.white += 1;
      else row.black += 1;
    });
    return counts;
  }, [moves]);

  return (
    <div className="panel-section move-summary">
      <div className="panel__header">Move breakdown</div>

      <div className="move-summary__head" aria-hidden="true">
        <span className="move-summary__side move-summary__side--white">White</span>
        <span />
        <span className="move-summary__side move-summary__side--black">Black</span>
      </div>

      <ul className="move-summary__list">
        {DISPLAY_ORDER.map((classification) => {
          const { white, black } = tally[classification];
          const color = classificationColor(classification);
          const label = classificationLabel(classification);

          return (
            <li key={classification} className="move-summary__row">
              <span
                className={`move-summary__count${white === 0 ? ' move-summary__count--zero' : ''}`}
                aria-label={`White ${white} ${label}`}
              >
                {white}
              </span>
              <span className="move-summary__label">
                <span className="move-summary__icon" style={{ color }} aria-hidden="true">
                  {classificationIcon(classification)}
                </span>
                <span className="move-summary__name" style={{ color }}>
                  {label}
                </span>
              </span>
              <span
                className={`move-summary__count${black === 0 ? ' move-summary__count--zero' : ''}`}
                aria-label={`Black ${black} ${label}`}
              >
                {black}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
