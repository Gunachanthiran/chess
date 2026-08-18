import {
  COACH_IDLE_EXPRESSION,
  coachExpression,
  commentaryForAnalysisMove,
  isNotableMove,
  quietCoachLine,
} from '../../lib/coach';
import type { MoveAnalysis } from '../../types';

type CoachPanelProps = {
  /** The move just played — same one `GameAnalysisPage`'s speak-on-navigation
   * effect reacts to. `null` at the starting position. */
  move: MoveAnalysis | null;
  muted: boolean;
  onToggleMute: () => void;
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
 * A face for the coach: an avatar/name card plus the *visible* text of
 * whatever it's currently saying — previously spoken-only, so muting it (or
 * a browser with no speech synthesis at all) meant losing the commentary
 * entirely. `commentaryForAnalysisMove` is a pure function of `move`, so this
 * renders directly from it rather than trying to stay in sync with the
 * separate speak-on-navigation effect's own timing.
 *
 * The avatar itself reacts to move quality (see `coachExpression`) rather
 * than staying a fixed glyph throughout — mind-blown for a brilliancy,
 * horrified for a blunder, same personality the commentary text already had,
 * just visible at a glance without reading a word of it.
 */
export function CoachPanel({ move, muted, onToggleMute }: CoachPanelProps) {
  const text = !move
    ? "Step through the game and I'll walk you through it."
    : isNotableMove(move.classification)
      ? commentaryForAnalysisMove(move)
      : quietCoachLine(move.ply);

  const expression = move ? coachExpression(move.classification) : COACH_IDLE_EXPRESSION;
  // Re-keying on the move restarts the reaction animation every time — a
  // step back to a move already reacted to should still play it again,
  // rather than only firing the first time each position is visited.
  const avatarKey = move ? `${move.id}-${move.classification}` : 'idle';

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
        <span className="coach__name">Coach</span>
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
      <p className="coach__text">{text}</p>
    </div>
  );
}
