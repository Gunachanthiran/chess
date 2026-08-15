import { useEffect, useRef } from 'react';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import type { MoveAnalysis } from '../../types';

type MoveListProps = {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  onSelect: (index: number) => void;
};

type MoveCell = {
  move: MoveAnalysis;
  /** Navigation index for this move: the position *after* it has been played. */
  index: number;
};

type MoveRow = {
  moveNumber: number;
  white: MoveCell | null;
  black: MoveCell | null;
};

/**
 * Groups the flat ply list into `1. e4 e5` style rows.
 *
 * A row is reused only when the move number matches *and* the slot for that
 * side is still free, so a game resuming from a FEN (black to move first) and
 * any duplicate-numbered data both render every move instead of dropping one.
 */
function buildRows(moves: MoveAnalysis[]): MoveRow[] {
  const rows: MoveRow[] = [];

  moves.forEach((move, position) => {
    const cell: MoveCell = { move, index: position + 1 };
    const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const slotIsFree =
      last !== undefined &&
      last.moveNumber === move.move_number &&
      (move.side === 'white' ? last.white === null : last.black === null);

    const row: MoveRow = slotIsFree
      ? last
      : { moveNumber: move.move_number, white: null, black: null };
    if (!slotIsFree) rows.push(row);

    if (move.side === 'white') {
      row.white = cell;
    } else {
      row.black = cell;
    }
  });

  return rows;
}

function MoveButton({
  cell,
  isActive,
  onSelect,
}: {
  cell: MoveCell | null;
  isActive: boolean;
  onSelect: (index: number) => void;
}) {
  if (!cell) return <span className="move-list__cell move-list__cell--empty" />;

  const { move, index } = cell;
  const color = classificationColor(move.classification);

  return (
    <button
      type="button"
      className={`move-list__cell${isActive ? ' move-list__cell--active' : ''}`}
      onClick={() => onSelect(index)}
      title={`${move.san} — ${classificationLabel(move.classification)}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span className="move-list__san" style={{ color }}>
        {move.san}
      </span>
      <span className="move-list__icon" style={{ color }} aria-hidden="true">
        {classificationIcon(move.classification)}
      </span>
    </button>
  );
}

/**
 * Scrollable move list. Clicking a move only ever sets the navigation index —
 * the board position is derived from it, so the two cannot drift apart.
 */
export function MoveList({ moves, currentMoveIndex, onSelect }: MoveListProps) {
  const rows = buildRows(moves);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentMoveIndex]);

  if (moves.length === 0) {
    return <div className="panel-section move-list move-list--empty">No moves analysed.</div>;
  }

  return (
    <div className="panel-section move-list">
      <div className="panel__header">Moves</div>
      <div className="move-list__scroll">
        {rows.map((row) => {
          const isActiveRow =
            row.white?.index === currentMoveIndex || row.black?.index === currentMoveIndex;
          return (
            <div
              key={`${row.moveNumber}-${row.white?.move.id ?? row.black?.move.id ?? 'row'}`}
              className="move-list__row"
              ref={isActiveRow ? activeRef : undefined}
            >
              <span className="move-list__number">{row.moveNumber}.</span>
              <MoveButton
                cell={row.white}
                isActive={row.white?.index === currentMoveIndex}
                onSelect={onSelect}
              />
              <MoveButton
                cell={row.black}
                isActive={row.black?.index === currentMoveIndex}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
