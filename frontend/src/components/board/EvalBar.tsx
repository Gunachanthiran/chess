import { evalAtIndex, evalToWhitePercent, formatEval } from '../../lib/evaluation';
import type { MoveAnalysis } from '../../types';

type EvalBarProps = {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  /** Flips the bar so the side at the bottom of the board is at the bottom. */
  orientation?: 'white' | 'black';
};

/**
 * Vertical evaluation bar, always White-POV in value terms: the white portion
 * grows as White's advantage grows. Mates read as `M3` / `M-5`.
 */
export function EvalBar({ moves, currentMoveIndex, orientation = 'white' }: EvalBarProps) {
  const evaluation = evalAtIndex(moves, currentMoveIndex);
  const whitePercent = evalToWhitePercent(evaluation);
  const label = formatEval(evaluation);

  const whiteIsWinning = whitePercent >= 50;
  // The label sits on the winning side's block so it stays readable.
  const labelOnTop = orientation === 'white' ? !whiteIsWinning : whiteIsWinning;

  return (
    <div
      className={`eval-bar eval-bar--${orientation}`}
      role="img"
      aria-label={`Evaluation ${label} for white`}
      title={`Evaluation: ${label}`}
    >
      <div className="eval-bar__white" style={{ height: `${whitePercent}%` }} />
      <span
        className={`eval-bar__label ${
          labelOnTop ? 'eval-bar__label--top' : 'eval-bar__label--bottom'
        } ${whiteIsWinning ? 'eval-bar__label--white' : 'eval-bar__label--black'}`}
      >
        {label}
      </span>
    </div>
  );
}
