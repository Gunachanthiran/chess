import { useEffect, useState } from 'react';
import {
  COACH_IDLE_EXPRESSION,
  coachExpression,
  commentaryForAnalysisMove,
  detailForAnalysisMove,
  isNotableMove,
  quietCoachLine,
} from '../../lib/coach';
import { classificationColor, classificationIcon, classificationLabel } from '../../styles/classification-colors';
import type { MoveAnalysis } from '../../types';

type CoachPanelProps = {
  /** The move just played — same one `GameAnalysisPage`'s speak-on-navigation
   * effect reacts to. `null` at the starting position. */
  move: MoveAnalysis | null;
  muted: boolean;
  onToggleMute: () => void;
  /** Jump to the next/previous *notable* move (brilliant/great/mistake/
   * blunder) rather than one ply at a time — the review-style "skip to what
   * actually matters" flow. `undefined` hides the pair entirely. */
  onNextNotable?: () => void;
  onPreviousNotable?: () => void;
  hasNextNotable?: boolean;
  hasPreviousNotable?: boolean;
};

/** Tiers dramatic enough to earn the avatar's own reaction animation — a
 * bounce for the highs, a shake for the lows. Everything else just changes
 * face without the extra motion, so the panel doesn't jitter on every ply. */
function moodAnimationClass(move: MoveAnalysis | null): string {
  if (!move) return '';
  if (move.classification === 'brilliant' || move.classification === 'great') {
    return 'coach__avatar--hype';
  }
  if (move.classification === 'blunder' || move.classification === 'mistake') {
    return 'coach__avatar--yikes';
  }
  return '';
}

/**
 * A face for the coach: avatar/name card, a move-quality badge, the *visible*
 * text of whatever it's currently saying (so muting the voice, or a browser
 * with none, never loses the commentary), and an "Explain" toggle for the
 * longer win%-swing read on the same move — the chess.com Game Review
 * layout's shape, built from data this app already computes rather than a
 * per-move engine call.
 *
 * `commentaryForAnalysisMove`/`detailForAnalysisMove` are pure functions of
 * `move`, so this renders straight from them rather than staying in sync
 * with the separate speak-on-navigation effect's own timing.
 */
export function CoachPanel({
  move,
  muted,
  onToggleMute,
  onNextNotable,
  onPreviousNotable,
  hasNextNotable = false,
  hasPreviousNotable = false,
}: CoachPanelProps) {
  const [expanded, setExpanded] = useState(false);

  // A new move starts collapsed — "Explain" is an on-demand dig-deeper, not
  // a state that should carry over from whatever move was showing before.
  useEffect(() => {
    setExpanded(false);
  }, [move?.id]);

  const notable = move !== null && isNotableMove(move.classification);
  const text = !move
    ? "Step through the game, chat, and I'll walk you through it."
    : notable
      ? commentaryForAnalysisMove(move)
      : quietCoachLine(move.ply);

  const expression = move ? coachExpression(move.classification) : COACH_IDLE_EXPRESSION;
  // Re-keying on the move restarts the reaction animation every time — a
  // step back to a move already reacted to should still play it again,
  // rather than only firing the first time each position is visited.
  const avatarKey = move ? `${move.id}-${move.classification}` : 'idle';

  const showNotableNav = onNextNotable !== undefined || onPreviousNotable !== undefined;

  return (
    <div className="panel coach">
      <div className="coach__head">
        <span
          key={avatarKey}
          className={`coach__avatar ${moodAnimationClass(move)}`}
          aria-hidden="true"
        >
          {expression}
        </span>
        <div className="coach__head-text">
          <span className="coach__name">GothamChess</span>
          {move && (
            <span
              className="coach__move-badge"
              style={{ color: classificationColor(move.classification) }}
            >
              {classificationIcon(move.classification)} {move.san} is{' '}
              {classificationLabel(move.classification).toLowerCase()}
            </span>
          )}
        </div>
        <button
          type="button"
          className="button coach__mute"
          onClick={onToggleMute}
          title={muted ? 'Turn on coach commentary' : 'Turn off coach commentary'}
          aria-label={muted ? 'Turn on coach commentary' : 'Turn off coach commentary'}
          aria-pressed={!muted}
        >
          {muted ? '🎙️' : '🗣️'}
        </button>
      </div>

      <div className="coach__bubble">
        <p className="coach__text">{text}</p>
        {expanded && move && <p className="coach__detail">{detailForAnalysisMove(move)}</p>}
      </div>

      <div className="coach__controls">
        {move && (
          <button type="button" className="button coach__explain" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide detail' : 'Explain'}
          </button>
        )}
        {showNotableNav && (
          <div className="coach__nav">
            <button
              type="button"
              className="button"
              onClick={onPreviousNotable}
              disabled={!hasPreviousNotable}
              title="Previous notable move"
            >
              ◀
            </button>
            <button
              type="button"
              className="button"
              onClick={onNextNotable}
              disabled={!hasNextNotable}
              title="Next notable move"
            >
              Next ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
