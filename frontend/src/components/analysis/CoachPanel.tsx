import { commentaryForAnalysisMove } from '../../lib/coach';
import type { MoveAnalysis } from '../../types';

type CoachPanelProps = {
  /** The move just played — same one `GameAnalysisPage`'s speak-on-navigation
   * effect reacts to. `null` at the starting position. */
  move: MoveAnalysis | null;
  muted: boolean;
  onToggleMute: () => void;
};

/**
 * A face for the coach: an avatar/name card plus the *visible* text of
 * whatever it's currently saying — previously spoken-only, so muting it (or
 * a browser with no speech synthesis at all) meant losing the commentary
 * entirely. `commentaryForAnalysisMove` is a pure function of `move`, so this
 * renders directly from it rather than trying to stay in sync with the
 * separate speak-on-navigation effect's own timing.
 */
export function CoachPanel({ move, muted, onToggleMute }: CoachPanelProps) {
  const text = move
    ? commentaryForAnalysisMove(move)
    : "Step through the game and I'll walk you through it.";

  return (
    <div className="panel coach">
      <div className="coach__head">
        <span className="coach__avatar" aria-hidden="true">
          ♞
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
