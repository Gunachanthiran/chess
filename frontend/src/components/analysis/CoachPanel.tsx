import { useEffect, useState } from 'react';
import { CoachMascot } from './CoachMascot';
import { CoachPersonalize } from './CoachPersonalize';
import { commentaryForAnalysisMove, detailForAnalysisMove, isNotableMove, quietCoachLine } from '../../lib/coach';
import { scoreVoice } from '../../lib/coachVoice';
import type { CoachProfileHook } from '../../lib/coachProfile';
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
  /** The game-arc-aware line for a notable move (see `buildGameNarrative`),
   * when the caller has one — falls back to the per-move-isolated
   * `commentaryForAnalysisMove` when omitted, so this component still works
   * standalone. */
  narrativeText?: string;
  voices?: SpeechSynthesisVoice[];
  selectedVoiceURI?: string | null;
  onSelectVoice?: (voiceURI: string | null) => void;
  /** Answers a free-text question from data already on screen — see
   * `answerCoachQuestion`. `undefined` hides the "Ask a question" control. */
  onAsk?: (question: string) => string;
  /** The user's own photo/voice/reaction-line customization (see
   * `lib/coachProfile.ts`). `undefined` hides the "Personalize" control
   * entirely, leaving the panel exactly as it was before this existed. */
  profile?: CoachProfileHook;
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

/** English-first, best-scored-first ordering for the voice picker — falls
 * back to the full list if the browser exposes no English voices at all. */
function rankedVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const english = voices.filter((v) => /^en/i.test(v.lang));
  const pool = english.length > 0 ? english : voices;
  return [...pool].sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

/**
 * A face for the coach: avatar/name card, a move-quality badge, the *visible*
 * text of whatever it's currently saying (so muting the voice, or a browser
 * with none, never loses the commentary), an "Explain" toggle for the longer
 * win%-swing read on the same move, and an optional "Ask a question" form —
 * the chess.com Game Review layout's shape, built from data this app already
 * computes rather than a per-move engine call or any LLM.
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
  narrativeText,
  voices = [],
  selectedVoiceURI = null,
  onSelectVoice,
  onAsk,
  profile,
}: CoachPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [personalizeOpen, setPersonalizeOpen] = useState(false);

  // A new move starts collapsed — "Explain" is an on-demand dig-deeper, not
  // a state that should carry over from whatever move was showing before.
  useEffect(() => {
    setExpanded(false);
  }, [move?.id]);

  const notable = move !== null && isNotableMove(move.classification);
  const text = !move
    ? "Step through the game, chat, and I'll walk you through it."
    : notable
      ? (narrativeText ?? commentaryForAnalysisMove(move))
      : quietCoachLine(move.ply);

  // Re-keying on the move restarts the reaction animation every time — a
  // step back to a move already reacted to should still play it again,
  // rather than only firing the first time each position is visited.
  const avatarKey = move ? `${move.id}-${move.classification}` : 'idle';

  const showNotableNav = onNextNotable !== undefined || onPreviousNotable !== undefined;
  const voiceOptions = rankedVoices(voices);

  return (
    <div className="panel coach">
      <div className="coach__head">
        <CoachMascot
          key={avatarKey}
          classification={move?.classification ?? null}
          className={`coach__avatar ${moodAnimationClass(move)}`}
          photoUrl={profile?.avatarUrl}
        />
        <div className="coach__head-text">
          <span className="coach__name">{profile?.displayName || 'Rook'}</span>
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
        {voiceOptions.length > 0 && onSelectVoice && (
          <select
            className="form__input coach__voice-select"
            value={selectedVoiceURI ?? ''}
            onChange={(e) => onSelectVoice(e.target.value || null)}
            aria-label="Coach voice"
          >
            <option value="">Auto (recommended)</option>
            {voiceOptions.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        )}
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
        {onAsk && (
          <button type="button" className="button coach__ask-toggle" onClick={() => setAskOpen((v) => !v)}>
            {askOpen ? 'Hide questions' : 'Ask a question'}
          </button>
        )}
        {profile && (
          <button
            type="button"
            className="button coach__personalize-toggle"
            onClick={() => setPersonalizeOpen((v) => !v)}
          >
            {personalizeOpen ? 'Hide personalize' : 'Personalize'}
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

      {askOpen && onAsk && (
        <form
          className="coach__ask"
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            if (!q) return;
            setAnswer(onAsk(q));
          }}
        >
          <label className="form__label" htmlFor="coach-question">
            Ask the coach
          </label>
          <div className="form__row">
            <input
              id="coach-question"
              className="form__input coach__ask-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. why was that a blunder?"
            />
            <button
              type="submit"
              className="button coach__ask-submit"
              disabled={question.trim().length === 0}
            >
              Ask
            </button>
          </div>
          {answer && <p className="coach__text coach__answer">{answer}</p>}
        </form>
      )}

      {personalizeOpen && profile && <CoachPersonalize profile={profile} />}
    </div>
  );
}
