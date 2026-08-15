import { useState } from 'react';
import type { FormEvent } from 'react';
import type { BotColor } from '../../types';
import {
  BOT_ELO_FLOOR,
  BOT_ELO_MIN,
  BOT_ELO_STEP,
  BOT_ELO_TUNABLE_MAX,
  DEFAULT_PRACTICE_ELO,
  GRANDMASTER_ELO,
} from '../../lib/botConstants';

type PlayBotSetupFormProps = {
  onStart: (playerColor: BotColor, elo: number, aggression: number) => void;
  /** True while the create request is in flight. */
  busy?: boolean;
  /** Failure from a previous start attempt, surfaced next to the button. */
  error?: string | null;
  onCancel?: () => void;
};

const AGGRESSION_MIN = 1;
const AGGRESSION_MAX = 5;

const AGGRESSION_LABELS: Record<number, string> = {
  1: 'Precise — plays the objectively best move',
  2: 'Solid, with a taste for the initiative',
  3: 'Sharp — prefers attacking continuations',
  4: 'Very sharp — will burn material for an attack',
  5: 'Maximally sharp — sacrifices on principle',
};

/**
 * Setup screen for a game against the Tal-style bot. Purely a settings form: it
 * owns no game state, it just hands three numbers to the caller.
 */
export function PlayBotSetupForm({
  onStart,
  busy = false,
  error = null,
  onCancel,
}: PlayBotSetupFormProps) {
  const [playerColor, setPlayerColor] = useState<BotColor>('white');
  // Grandmaster is the default mode, not the far end of the strength slider:
  // the weakened tiers are a separate, opt-in practice thing.
  const [practice, setPractice] = useState(false);
  const [practiceElo, setPracticeElo] = useState(DEFAULT_PRACTICE_ELO);
  const [aggression, setAggression] = useState(3);

  const elo = practice ? practiceElo : GRANDMASTER_ELO;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    onStart(playerColor, elo, aggression);
  };

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <div className="panel__header">Play a Tal-style bot</div>

      <span className="form__label">Your colour</span>
      <div className="tabs" role="radiogroup" aria-label="Your colour">
        <button
          type="button"
          role="radio"
          aria-checked={playerColor === 'white'}
          className={`tabs__tab${playerColor === 'white' ? ' tabs__tab--active' : ''}`}
          onClick={() => setPlayerColor('white')}
          disabled={busy}
        >
          ♔ White
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={playerColor === 'black'}
          className={`tabs__tab${playerColor === 'black' ? ' tabs__tab--active' : ''}`}
          onClick={() => setPlayerColor('black')}
          disabled={busy}
        >
          ♚ Black
        </button>
      </div>
      <span className="form__hint">
        {playerColor === 'white'
          ? 'You move first.'
          : 'The bot opens; its first move is ready when the board loads.'}
      </span>

      <span className="form__label">Bot strength</span>
      <div className="tabs" role="radiogroup" aria-label="Bot strength">
        <button
          type="button"
          role="radio"
          aria-checked={!practice}
          className={`tabs__tab${!practice ? ' tabs__tab--active' : ''}`}
          onClick={() => setPractice(false)}
          disabled={busy}
        >
          Grandmaster — maximum strength
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={practice}
          className={`tabs__tab${practice ? ' tabs__tab--active' : ''}`}
          onClick={() => setPractice(true)}
          disabled={busy}
        >
          Practice — adjustable
        </button>
      </div>
      <span className="form__hint">
        {practice
          ? 'A deliberately weakened engine, so it will hand you real chances — and real blunders.'
          : 'Unrestricted Stockfish, searching deeper. No handicap, no blunders — expect to lose. Moves take a few seconds.'}
      </span>

      {practice && (
        <div className="slider">
          <label className="slider__label" htmlFor="bot-elo">
            <span>Practice strength</span>
            <span className="slider__value">{practiceElo} Elo</span>
          </label>
          <input
            id="bot-elo"
            className="slider__input"
            type="range"
            min={BOT_ELO_MIN}
            max={BOT_ELO_TUNABLE_MAX}
            step={BOT_ELO_STEP}
            value={practiceElo}
            onChange={(event) => setPracticeElo(Number(event.target.value))}
            disabled={busy}
          />
          <span className="form__hint">
            {practiceElo < BOT_ELO_FLOOR
              ? `Stockfish cannot be limited below ${BOT_ELO_FLOOR} Elo — anything under that plays at ${BOT_ELO_FLOOR}.`
              : `Values below ${BOT_ELO_FLOOR} all play the same (Stockfish's floor).`}
          </span>
        </div>
      )}

      <div className="slider">
        <label className="slider__label" htmlFor="bot-aggression">
          <span>Tal aggression</span>
          <span className="slider__value">{aggression} / {AGGRESSION_MAX}</span>
        </label>
        <input
          id="bot-aggression"
          className="slider__input"
          type="range"
          min={AGGRESSION_MIN}
          max={AGGRESSION_MAX}
          step={1}
          value={aggression}
          onChange={(event) => setAggression(Number(event.target.value))}
          disabled={busy}
        />
        <span className="form__hint">
          1 = precise, 5 = maximally sharp/sacrificial. {AGGRESSION_LABELS[aggression]}
        </span>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="form__row">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Setting up…' : 'Start game'}
        </button>
        {onCancel && (
          <button className="button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
