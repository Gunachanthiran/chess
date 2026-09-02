import { useEffect, useRef } from 'react';
import type { PieceDropHandlerArgs } from 'react-chessboard';
import { ChessBoard } from '../board/ChessBoard';
import { BoardThemePicker } from '../board/BoardThemePicker';
import { PieceSetPicker } from '../board/PieceSetPicker';
import { CapturedPieces } from '../common/CapturedPieces';
import { useSoundEffects } from '../../hooks/useSoundEffects';
import { PanelSkeleton } from '../common/Skeleton';
import type { BotGameHook } from '../../hooks/useBotGame';
import { isGrandmasterElo } from '../../lib/botConstants';
import type { BotGame, BotGameMove, GambitStatus } from '../../types';

type PlayBotPageProps = {
  bot: BotGameHook;
  /** Back to the setup form to start a different game. */
  onNewGame: () => void;
  /** Back to the upload/import screen. */
  onExit: () => void;
};

/** Gap between the player's move sound and the bot's reply, in ms. */
const REPLY_SOUND_DELAY_MS = 180;

const STATUS_TEXT: Record<Exclude<BotGame['status'], 'in_progress'>, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw: 'Draw',
  resigned: 'Resigned',
};

const GAMBIT_STATUS_TEXT: Record<GambitStatus, string> = {
  no_gambit: 'Free play',
  active: 'Gambit Active',
  extended: 'Gambit Line Complete',
  deviated: 'Opening Line Deviated',
};

/**
 * "Opening / Status / Opponent Style / Bot Strategy" — makes it visible why
 * the bot changed its behaviour, rather than the personality shift being a
 * silent black box. Only rendered once a gambit was actually selected; plain
 * free-play games look exactly as they did before this existed.
 */
function BotStrategyPanel({ botGame }: { botGame: BotGame }) {
  if (!botGame.gambit_name) return null;

  return (
    <div className="panel bot-strategy">
      <div className="panel__header">Strategy</div>
      <div className="bot-strategy__row">
        <span className="bot-strategy__label">Opening</span>
        <span className="bot-strategy__value">{botGame.gambit_name}</span>
      </div>
      <div className="bot-strategy__row">
        <span className="bot-strategy__label">Status</span>
        <span className={`bot-strategy__value bot-strategy__value--${botGame.gambit_status}`}>
          {GAMBIT_STATUS_TEXT[botGame.gambit_status]}
        </span>
      </div>
      {botGame.opponent_style.length > 0 && (
        <div className="bot-strategy__row">
          <span className="bot-strategy__label">Opponent Style</span>
          <span className="bot-strategy__value">{botGame.opponent_style.join(', ')}</span>
        </div>
      )}
      {botGame.bot_strategy_summary && (
        <p className="bot-strategy__summary">{botGame.bot_strategy_summary}</p>
      )}
    </div>
  );
}

type BotMoveRow = {
  moveNumber: number;
  white: BotGameMove | null;
  black: BotGameMove | null;
};

/** Groups the flat ply list into `1. e4 e5` rows. */
function buildRows(moves: BotGameMove[]): BotMoveRow[] {
  const rows: BotMoveRow[] = [];

  moves.forEach((move) => {
    const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const slotIsFree =
      last !== undefined && (move.side === 'white' ? last.white === null : last.black === null);

    const row: BotMoveRow = slotIsFree
      ? last
      : // Ply 1 is White's first move, so plies pair up 1+2, 3+4, ...
        { moveNumber: Math.floor((move.ply - 1) / 2) + 1, white: null, black: null };
    if (!slotIsFree) rows.push(row);

    if (move.side === 'white') {
      row.white = move;
    } else {
      row.black = move;
    }
  });

  return rows;
}

/** Plain move list — no classifications or evals, since nothing is analysed here. */
function BotMoveList({ moves }: { moves: BotGameMove[] }) {
  // A ref on the scroll box itself, not a sentinel child element: setting
  // this container's own `scrollTop` directly always scrolls exactly this
  // one box, regardless of how many other scrollable ancestors it happens
  // to sit inside (the page, `.analysis__side-column`, ...). A `scrollIntoView`
  // call on a child instead asks the browser to pick "the" scrollable
  // ancestor to move, which is exactly the ambiguity that caused this list
  // to scroll the whole mobile page to the top instead of itself.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [moves.length]);

  if (moves.length === 0) {
    return <div className="panel move-list move-list--empty">No moves yet.</div>;
  }

  return (
    <div className="panel move-list">
      <div className="panel__header">Moves</div>
      <div className="move-list__scroll" ref={scrollRef}>
        {buildRows(moves).map((row) => (
          <div key={row.moveNumber} className="move-list__row">
            <span className="move-list__number">{row.moveNumber}.</span>
            <span className="move-list__cell move-list__cell--static">
              <span className="move-list__san">{row.white?.san ?? ''}</span>
            </span>
            <span className="move-list__cell move-list__cell--static">
              <span className="move-list__san">{row.black?.san ?? ''}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Live game against the bot. Deliberately a sibling of `GameAnalysisPage` rather
 * than a mode inside it: there is no analysis here, so no eval bar, no
 * classifications and no accuracy panel — and the move list grows instead of
 * being navigated.
 */
export function PlayBotPage({ bot, onNewGame, onExit }: PlayBotPageProps) {
  const {
    botGame,
    displayFen,
    lastMoveUci,
    lastMoveIsCapture,
    botThinking,
    creating,
    undoing,
    canUndo,
    claimingDraw,
    canClaimDraw,
    resigning,
    error,
    attemptMove,
    sanForMove,
    legalMovesFrom,
    undoMove,
    claimDraw,
    resign,
  } = bot;
  const { muted, toggleMuted, playForMove, playIllegal } = useSoundEffects();

  // True for exactly one server response: the one following a move the
  // player just made in this tab. Set synchronously in `handlePieceDrop`
  // (see below), consumed by the effect below, then cleared.
  //
  // The player's own move is sounded *there*, synchronously inside the drop
  // handler, not here — playing it from an effect means waiting for the
  // server's response first, which puts it outside the original drag
  // gesture's call stack. A browser's autoplay policy cares about exactly
  // that: whether audio playback traces back to a trusted gesture still on
  // the stack, not merely "did a gesture happen at some point." An effect
  // firing after a network round trip no longer qualifies, no matter how
  // carefully the AudioContext itself is kept warm — which is why the
  // straightforward version of this (sound the whole newly-arrived batch from
  // one effect) kept being unreliable for the player's move specifically,
  // while the bot's reply — already one async hop removed either way — was
  // never worse off for it.
  const justPlayedRef = useRef(false);

  // Sound for the bot's reply (and anything else that lands without a local
  // drop causing it — the bot's opening move when the player is Black, or a
  // move set restored after a page reload).
  //
  // `soundedRef` records the (game, ply count) already sounded. It starts null
  // so mount is silent, and re-running with unchanged values is a no-op,
  // which is what stops StrictMode's double-invoke from double-playing.
  const soundedRef = useRef<{ gameId: string; count: number } | null>(null);
  useEffect(() => {
    if (!botGame) {
      soundedRef.current = null;
      justPlayedRef.current = false;
      return;
    }

    const previous = soundedRef.current;
    soundedRef.current = { gameId: botGame.id, count: botGame.moves.length };

    if (previous === null) return; // First render for this page.
    if (previous.gameId !== botGame.id) {
      justPlayedRef.current = false; // A different game just started.
      return;
    }
    if (botGame.moves.length <= previous.count) return; // Nothing new.

    const fresh = botGame.moves.slice(previous.count);
    // Consume the flag once, for this batch only.
    const skipFirst = justPlayedRef.current;
    justPlayedRef.current = false;

    const timers: number[] = [];
    fresh.forEach((move, position) => {
      if (skipFirst && position === 0) return; // Already sounded on drop.
      if (!skipFirst && position === 0) {
        playForMove(move.san);
      } else {
        timers.push(
          window.setTimeout(() => playForMove(move.san), position * REPLY_SOUND_DELAY_MS),
        );
      }
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [botGame, playForMove]);

  if (!botGame) {
    // A direct visit or reload lands here first while `PlayBotRoute` loads the
    // game by id — genuinely still loading, not failed, so it gets a neutral
    // message rather than the error framing below.
    if (creating && !error) {
      return <PanelSkeleton />;
    }
    return (
      <div className="panel form">
        <div className="panel__header">Play a Tal-style bot</div>
        <div className="alert alert--error">{error ?? 'Could not start a game against the bot.'}</div>
        <div className="form__row">
          <button className="button button--primary" type="button" onClick={onNewGame}>
            Back to settings
          </button>
          <button className="button" type="button" onClick={onExit}>
            Analyse a game instead
          </button>
        </div>
      </div>
    );
  }

  const isLive = botGame.status === 'in_progress';
  const playerColor = botGame.player_color;
  const opponentColor = playerColor === 'white' ? 'black' : 'white';

  // `react-chessboard` needs a synchronous verdict, so the client-side legality
  // check answers the board immediately and the network call runs behind it. A
  // `true` here only suppresses the snap-back animation — the piece is not
  // actually moved until the server's position comes back through `displayFen`.
  const handlePieceDrop = ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (targetSquare === null) return false;
    const san = sanForMove(sourceSquare, targetSquare);
    if (san === null) {
      playIllegal();
      return false;
    }
    // Play now, synchronously, inside the drop — the one point in this whole
    // flow that is still directly on the stack of a real user gesture. See
    // `justPlayedRef`'s comment above for why this matters.
    playForMove(san);
    justPlayedRef.current = true;
    void attemptMove(sourceSquare, targetSquare).then((accepted) => {
      if (!accepted) {
        // The move never actually landed, so there is no server-confirmed
        // move for the effect to (correctly) skip — reset the flag so a
        // later real move doesn't lose its own sound to this one's leftover
        // "already played" flag.
        justPlayedRef.current = false;
        playIllegal();
      }
    });
    return true;
  };

  return (
    <div className="analysis">
      {/*
        The two players are no longer named up here: they sit in slim bars
        directly above and below the board (see below), which is the layout
        convention every online board uses. The header keeps only what belongs
        to the game as a whole — which colour is being played, the live opening,
        and the "new game" escape hatch.
      */}
      <header className="analysis__header">
        <div className="analysis__opening">
          Playing {playerColor === 'white' ? 'White' : 'Black'}
          {botGame.opening_name && (
            // Mirrors GameAnalysisPage's `{eco} — {name}` line. Rendered only
            // while the game is still in book: once theory runs out the server
            // sends nulls and this disappears rather than freezing on a stale
            // name.
            <span className="analysis__opening-name">
              {' · '}
              {botGame.opening_eco ? `${botGame.opening_eco} — ` : ''}
              {botGame.opening_name}
            </span>
          )}
        </div>
        <button className="button" type="button" onClick={onNewGame}>
          New game
        </button>
      </header>

      <div className="analysis__body">
        <section className="analysis__board-column">
          {/*
            Opponent above the board, player below. The board is drawn from the
            player's own perspective (`boardOrientation={playerColor}`) and is
            never flipped here — there is no Flip button on this page — so the
            bot's pieces are always the ones at the top of the board and this
            pairing is fixed rather than orientation-dependent.
          */}
          <div className="player-bar">
            <span
              className={`player-bar__disc player-bar__disc--${opponentColor}`}
              aria-hidden="true"
            />
            <span className="player-bar__name">Tal bot</span>
            <span className="player-bar__meta">
              ({isGrandmasterElo(botGame.bot_elo) ? 'Grandmaster' : botGame.bot_elo}, aggression{' '}
              {botGame.bot_aggression})
            </span>
            <CapturedPieces fen={displayFen} side={opponentColor} />
          </div>

          <ChessBoard
            displayFen={displayFen}
            lastMoveUci={lastMoveUci}
            lastMoveIsCapture={lastMoveIsCapture}
            boardOrientation={playerColor}
            allowDragging={isLive && !botThinking}
            onPieceDrop={handlePieceDrop}
            legalMovesFor={legalMovesFrom}
          />

          <div className="player-bar">
            <span
              className={`player-bar__disc player-bar__disc--${playerColor}`}
              aria-hidden="true"
            />
            <span className="player-bar__name">You</span>
            <CapturedPieces fen={displayFen} side={playerColor} />
          </div>

          <div className="controls">
            <span className="bot-status" aria-live="polite">
              {!isLive ? (
                'Game over'
              ) : botThinking ? (
                <>
                  <span className="bot-status__dot" aria-hidden="true" />
                  Bot is thinking…
                </>
              ) : (
                'Your move — drag a piece'
              )}
            </span>
            <button
              className="button"
              type="button"
              onClick={() => void undoMove()}
              disabled={!canUndo || botThinking || undoing}
              title="Take back your last move and the bot's reply"
            >
              {undoing ? 'Undoing…' : '↩ Undo'}
            </button>
            {isLive && (
              <button
                className="button"
                type="button"
                onClick={() => void claimDraw()}
                disabled={!canClaimDraw || botThinking || claimingDraw}
                title={
                  canClaimDraw
                    ? 'Claim a draw — threefold repetition or the fifty-move rule'
                    : 'Only claimable on a threefold repetition or after fifty moves without a capture or pawn move'
                }
              >
                {claimingDraw ? 'Claiming…' : '½ Claim Draw'}
              </button>
            )}
            {isLive && (
              <button
                className="button"
                type="button"
                onClick={() => {
                  if (window.confirm('Resign this game? It counts as a loss.')) {
                    void resign();
                  }
                }}
                disabled={botThinking || resigning}
                title="Resign the game"
              >
                {resigning ? 'Resigning…' : '⚑ Resign'}
              </button>
            )}
            <button
              className="button"
              type="button"
              onClick={toggleMuted}
              title={muted ? 'Unmute move sounds' : 'Mute move sounds'}
              aria-label={muted ? 'Unmute move sounds' : 'Mute move sounds'}
              aria-pressed={muted}
            >
              {muted ? '🔇' : '🔊'}
            </button>
            <BoardThemePicker />
            <PieceSetPicker />
            <button className="button" type="button" onClick={onExit}>
              Analyse a game
            </button>
          </div>

          {botGame.status !== 'in_progress' && (
            <div className="bot-result">
              <strong>{STATUS_TEXT[botGame.status]}</strong>
              {botGame.result && <span className="bot-result__score">{botGame.result}</span>}
              <button className="button button--primary" type="button" onClick={onNewGame}>
                Play again
              </button>
            </div>
          )}

          {error && <div className="alert alert--error">{error}</div>}

          <span className="form__hint">Promotions are automatically queened.</span>
        </section>

        <aside className="analysis__side-column">
          <BotStrategyPanel botGame={botGame} />
          <BotMoveList moves={botGame.moves} />
        </aside>
      </div>
    </div>
  );
}
