import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { listGambits } from '../../api/gambits';
import { errorMessage } from '../../api/client';
import type { BotColor, Gambit } from '../../types';
import {
  BOT_ELO_FLOOR,
  BOT_ELO_MIN,
  BOT_ELO_STEP,
  BOT_ELO_TUNABLE_MAX,
  DEFAULT_PRACTICE_ELO,
  GRANDMASTER_ELO,
} from '../../lib/botConstants';

type PlayBotSetupFormProps = {
  onStart: (
    playerColor: BotColor,
    elo: number,
    aggression: number,
    gambitId: string | null,
    adaptToOpponent: boolean,
    fullAttackMode: boolean,
  ) => void;
  /** True while the create request is in flight. */
  busy?: boolean;
  /** Failure from a previous start attempt, surfaced next to the button. */
  error?: string | null;
  onCancel?: () => void;
};

/** Sentinel `<select>` value for "pick one of the matching gambits at random
 * when the game starts" — resolved to a real id client-side in `handleSubmit`,
 * never sent to the server as-is. */
const RANDOM_GAMBIT_VALUE = '__random__';
const NO_GAMBIT_VALUE = '';

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
  // Maximally sharp by default, not the middle of the slider - "play a bot"
  // should mean a genuinely aggressive opponent out of the box, not a setting
  // someone has to go find. Still just one drag away from a quieter game.
  const [aggression, setAggression] = useState(5);

  const [gambits, setGambits] = useState<Gambit[]>([]);
  const [gambitsError, setGambitsError] = useState<string | null>(null);
  // Random, not "No Gambit", is the default selection for the same reason -
  // a fresh game should come out swinging with one of the library's
  // gambits/traps unless the player explicitly asks for plain engine play.
  const [selectedGambitValue, setSelectedGambitValue] = useState<string>(RANDOM_GAMBIT_VALUE);
  const [adaptToOpponent, setAdaptToOpponent] = useState(true);
  // Off by default - a deliberate "expect to lose more games" trade the
  // player opts into, not a safe default like adaptToOpponent above.
  const [fullAttackMode, setFullAttackMode] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listGambits(controller.signal)
      .then((data) => {
        setGambits(data.gambits);
        setGambitsError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setGambitsError(errorMessage(err));
      });
    return () => controller.abort();
  }, []);

  const elo = practice ? practiceElo : GRANDMASTER_ELO;

  // The full library, always — every gambit belongs to one colour or the
  // other, and picking one below auto-sets "Your colour" to whichever side
  // makes the *bot* the one playing it (see `handleGambitChange`), so there
  // is no reason to hide half the list depending on the colour tabs above.
  const whiteGambits = gambits.filter((gambit) => gambit.side === 'white');
  const blackGambits = gambits.filter((gambit) => gambit.side === 'black');

  const selectedGambit =
    selectedGambitValue === NO_GAMBIT_VALUE || selectedGambitValue === RANDOM_GAMBIT_VALUE
      ? null
      : (gambits.find((gambit) => gambit.id === selectedGambitValue) ?? null);

  const handleGambitChange = (value: string) => {
    setSelectedGambitValue(value);
    // Picking a specific gambit only means something if the bot is the one
    // playing it — flip "Your colour" to the opposite of the gambit's side
    // automatically, rather than silently hiding gambits that don't match
    // whatever colour happens to be selected already.
    const gambit = gambits.find((item) => item.id === value);
    if (gambit) {
      setPlayerColor(gambit.side === 'white' ? 'black' : 'white');
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    let gambitId: string | null;

    if (selectedGambitValue === NO_GAMBIT_VALUE) {
      gambitId = null;
    } else if (selectedGambitValue === RANDOM_GAMBIT_VALUE) {
      // Respect the colour the player actually clicked — pick randomly only
      // from gambits the *bot* can play on the opposite side, rather than
      // picking from the whole library and silently flipping "Your colour"
      // out from under a choice that's still showing on screen.
      const botSide = playerColor === 'white' ? 'black' : 'white';
      const pool = gambits.filter((gambit) => gambit.side === botSide);
      if (pool.length > 0) {
        gambitId = pool[Math.floor(Math.random() * pool.length)].id;
      } else {
        gambitId = null;
      }
    } else {
      gambitId = selectedGambitValue;
    }

    onStart(playerColor, elo, aggression, gambitId, adaptToOpponent, fullAttackMode);
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

      <span className="form__label">Choose Your Gambit</span>
      <select
        className="form__select"
        aria-label="Opening strategy"
        value={selectedGambitValue}
        onChange={(event) => handleGambitChange(event.target.value)}
        disabled={busy}
      >
        <option value={NO_GAMBIT_VALUE}>No Gambit / Free Play</option>
        <option value={RANDOM_GAMBIT_VALUE} disabled={gambits.length === 0}>
          Random Gambit
        </option>
        <optgroup label="Bot plays White">
          {whiteGambits.map((gambit) => (
            <option key={gambit.id} value={gambit.id}>
              {gambit.name} ({gambit.eco})
            </option>
          ))}
        </optgroup>
        <optgroup label="Bot plays Black">
          {blackGambits.map((gambit) => (
            <option key={gambit.id} value={gambit.id}>
              {gambit.name} ({gambit.eco})
            </option>
          ))}
        </optgroup>
      </select>
      {gambitsError && <span className="form__hint">Could not load gambits: {gambitsError}</span>}
      {selectedGambit ? (
        <div className="gambit-summary">
          <p className="gambit-summary__description">{selectedGambit.description}</p>
          <div className="gambit-summary__meta">
            <span>Style: {selectedGambit.style.join(' / ')}</span>
            <span>Aggression: {selectedGambit.aggression_level} / 5</span>
          </div>
          <span className="form__hint">
            Picking this set "Your colour" to {selectedGambit.side === 'white' ? 'Black' : 'White'}, so the bot is the one playing it.
          </span>
        </div>
      ) : (
        <span className="form__hint">
          {selectedGambitValue === RANDOM_GAMBIT_VALUE
            ? 'A gambit matching "Your colour" is picked at random for the bot when the game starts.'
            : 'The bot plays on its own merits, with no opening preference.'}
        </span>
      )}

      <span className="form__label">Adapt to Opponent</span>
      <div className="tabs" role="radiogroup" aria-label="Adapt to opponent">
        <button
          type="button"
          role="radio"
          aria-checked={adaptToOpponent}
          className={`tabs__tab${adaptToOpponent ? ' tabs__tab--active' : ''}`}
          onClick={() => setAdaptToOpponent(true)}
          disabled={busy}
        >
          On
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!adaptToOpponent}
          className={`tabs__tab${!adaptToOpponent ? ' tabs__tab--active' : ''}`}
          onClick={() => setAdaptToOpponent(false)}
          disabled={busy}
        >
          Off
        </button>
      </div>
      <span className="form__hint">
        {adaptToOpponent
          ? 'The bot reads your playing style during the game and nudges its own accordingly.'
          : 'The bot ignores your playing style and sticks to its own base personality.'}
      </span>

      <span className="form__label">Full Attack Mode</span>
      <div className="tabs" role="radiogroup" aria-label="Full attack mode">
        <button
          type="button"
          role="radio"
          aria-checked={fullAttackMode}
          className={`tabs__tab${fullAttackMode ? ' tabs__tab--active' : ''}`}
          onClick={() => setFullAttackMode(true)}
          disabled={busy}
        >
          On
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!fullAttackMode}
          className={`tabs__tab${!fullAttackMode ? ' tabs__tab--active' : ''}`}
          onClick={() => setFullAttackMode(false)}
          disabled={busy}
        >
          Off
        </button>
      </div>
      <span className="form__hint">
        {fullAttackMode
          ? 'No holds barred — the bot looks for real sacrifices, including a whole rook, for a direct attack. Expect a real chance of it losing games it would otherwise hold.'
          : "Sacrifices stay within the aggression slider's own, safer range."}
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
        {fullAttackMode && (
          <span className="form__hint">Aggression is overridden by Full Attack Mode.</span>
        )}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="form__row">
        <button
          className={`button button--primary${busy ? ' button--loading' : ''}`}
          type="submit"
          disabled={busy}
        >
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
