import { useId, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { EVAL_CLAMP_PAWNS, evalAtIndex, evalToClampedPawns } from '../../lib/evaluation';
import { classificationColor } from '../../styles/classification-colors';
import type { MoveAnalysis } from '../../types';

type EvalGraphProps = {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  onSelect: (index: number) => void;
};

// Internal drawing units. The SVG scales to its container via viewBox, and
// strokes use `vector-effect: non-scaling-stroke` so they stay crisp.
const WIDTH = 1000;
const HEIGHT = 220;
const MID_Y = HEIGHT / 2;

/** Classifications worth flagging as dots on the curve. */
const NOTABLE = new Set(['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great']);

/**
 * Evaluation over the whole game, one point per navigation index (0 = start).
 *
 * Hand-rolled SVG rather than a charting dependency: it is a single series with
 * click-to-navigate, and the shaded above/below-zero fill is easier to express
 * directly than to configure.
 */
export function EvalGraph({ moves, currentMoveIndex, onSelect }: EvalGraphProps) {
  const clipId = useId();

  const { points, linePath, areaPath, markers } = useMemo(() => {
    const count = moves.length;
    if (count === 0) {
      return { points: [], linePath: '', areaPath: '', markers: [] };
    }

    const xFor = (index: number) => (count === 0 ? 0 : (index / count) * WIDTH);
    const yFor = (pawns: number) => MID_Y - (pawns / EVAL_CLAMP_PAWNS) * MID_Y;

    const computed: { x: number; y: number; index: number }[] = [];
    for (let index = 0; index <= count; index += 1) {
      const pawns = evalToClampedPawns(evalAtIndex(moves, index));
      computed.push({ x: xFor(index), y: yFor(pawns), index });
    }

    const line = computed
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');

    const area =
      `${line} L${WIDTH.toFixed(2)},${MID_Y.toFixed(2)} L0,${MID_Y.toFixed(2)} Z`;

    const notable = moves
      .map((move, position) => ({ move, index: position + 1 }))
      .filter(({ move }) => NOTABLE.has(move.classification))
      .map(({ move, index }) => ({
        index,
        x: computed[index].x,
        y: computed[index].y,
        color: classificationColor(move.classification),
      }));

    return { points: computed, linePath: line, areaPath: area, markers: notable };
  }, [moves]);

  if (moves.length === 0) {
    return <div className="panel eval-graph eval-graph--empty">No evaluation data.</div>;
  }

  const selectNearest = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const nearest = Math.round(ratio * moves.length);
    onSelect(Math.max(0, Math.min(moves.length, nearest)));
  };

  const cursor = points[Math.min(currentMoveIndex, points.length - 1)];

  return (
    <div className="panel eval-graph">
      <div className="panel__header">Evaluation</div>
      <svg
        className="eval-graph__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        onClick={selectNearest}
        role="presentation"
      >
        <defs>
          {/* Everything above the zero line is White's advantage... */}
          <clipPath id={`${clipId}-white`}>
            <rect x="0" y="0" width={WIDTH} height={MID_Y} />
          </clipPath>
          {/* ...and everything below it is Black's. */}
          <clipPath id={`${clipId}-black`}>
            <rect x="0" y={MID_Y} width={WIDTH} height={MID_Y} />
          </clipPath>
        </defs>

        {/* Plot ground. `fill` as a presentation attribute cannot read a custom
            property, so the token is applied through `style` instead. */}
        <rect
          x="0"
          y="0"
          width={WIDTH}
          height={HEIGHT}
          style={{ fill: 'var(--bg-sunken)' }}
        />

        <path d={areaPath} fill="#e8e9ea" opacity="0.92" clipPath={`url(#${clipId}-white)`} />
        <path d={areaPath} fill="#4a4f57" opacity="0.95" clipPath={`url(#${clipId}-black)`} />

        <line
          x1="0"
          y1={MID_Y}
          x2={WIDTH}
          y2={MID_Y}
          stroke="#8a8f98"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={linePath}
          fill="none"
          stroke="#9aa0a8"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        {markers.map((marker) => (
          <circle
            key={marker.index}
            cx={marker.x}
            cy={marker.y}
            r="6"
            fill={marker.color}
            stroke="#14161a"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {cursor && (
          <line
            x1={cursor.x}
            y1="0"
            x2={cursor.x}
            y2={HEIGHT}
            stroke="#f0b429"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="eval-graph__hint">Click the graph to jump to a move</div>
    </div>
  );
}
