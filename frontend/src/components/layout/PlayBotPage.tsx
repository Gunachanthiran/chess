import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { PieceDropHandlerArgs } from 'react-chessboard';
import { ChessBoard, capturedPieceFromMove } from '../board/ChessBoard';
import type { CapturedPiece } from '../board/ChessBoard';
import { BoardThemePicker } from '../board/BoardThemePicker';
import { PieceSetPicker } from '../board/PieceSetPicker';
import { PromotionPicker } from '../board/PromotionPicker';
import type { PromotionChoice } from '../board/PromotionPicker';
import { CapturedPieces } from '../common/CapturedPieces';
import { useSoundEffects } from '../../hooks/useSoundEffects';
import { PanelSkeleton } from '../common/Skeleton';
import type { BotGameHook } from '../../hooks/useBotGame';
import { isGrandmasterElo } from '../../lib/botConstants';
import { analyzeBotGame } from '../../api/botGame';
import { errorMessage } from '../../api/client';
import type { BotColor, BotGame, BotGameMove, GambitStatus } from '../../types';

type PlayBotPageProps = {
  bot: BotGameHook;
  /** Back to the setup form to start a different game. */
  onNewGame: () => void;
  /** Back to the upload/import screen. */
  onExit: () => void;
  /** A real analysis job now exists for this (finished) bot game — go look
   * at it, the same place any other analysed game's job lands. */
  onAnalyzed: (jobId: string) => void;
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
  if (!botGame.gambit_name && !botGame.full_attack_mode) return null;

  return (
    <div className="panel bot-strategy">
      <div className="panel__header">Strategy</div>
      {botGame.full_attack_mode && (
        <div className="bot-strategy__row">
          <span className="bot-strategy__label">Mode</span>
          <span className="bot-strategy__value bot-strategy__value--full-attack">
            🔥 Full Attack
          </span>
        </div>
      )}
      {botGame.gambit_name && (
        <>
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
        </>
      )}
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

/**
 * One move cell — a button when it can be reviewed, plain text when there's
 * nothing to click yet (an empty slot: black hasn't replied to the last row).
 * `reviewPly === null` means "showing the live position", which never
 * matches a real ply, so nothing reads as active while live.
 */
function BotMoveButton({
  move,
  reviewPly,
  onSelect,
}: {
  move: BotGameMove | null;
  reviewPly: number | null;
  onSelect: (ply: number) => void;
}) {
  if (!move) return <span className="move-list__cell move-list__cell--empty" />;

  const isActive = move.ply === reviewPly;
  return (
    <button
      type="button"
      className={`move-list__cell${isActive ? ' move-list__cell--active' : ''}`}
      onClick={() => onSelect(move.ply)}
      title={`Review the position after ${move.san}`}
      aria-current={isActive ? 'true' : undefined}
    >
      <span className="move-list__san">{move.san}</span>
    </button>
  );
}

/**
 * Move list — clickable, so a past position can be reviewed on the board
 * without disturbing the live game underneath it (see `reviewPly`/
 * `reviewPosition` in `PlayBotPage`). No classifications or evals here,
 * since nothing about this game has been analysed.
 */
function BotMoveList({
  moves,
  reviewPly,
  onSelectPly,
  onBackToLive,
}: {
  moves: BotGameMove[];
  reviewPly: number | null;
  onSelectPly: (ply: number) => void;
  onBackToLive: () => void;
}) {
  // A ref on the scroll box itself, not a sentinel child element: setting
  // this container's own `scrollTop` directly always scrolls exactly this
  // one box, regardless of how many other scrollable ancestors it happens
  // to sit inside (the page, `.analysis__side-column`, ...). A `scrollIntoView`
  // call on a child instead asks the browser to pick "the" scrollable
  // ancestor to move, which is exactly the ambiguity that caused this list
  // to scroll the whole mobile page to the top instead of itself.
  //
  // Only autoscrolls while live: once reviewing a past move, a new bot reply
  // arriving in the background should not yank the list (and the reader's
  // eye) away from the row they're actually looking at.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (reviewPly !== null) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [moves.length, reviewPly]);

  if (moves.length === 0) {
    return <div className="panel move-list move-list--empty">No moves yet.</div>;
  }

  return (
    <div className="panel move-list">
      <div className="move-list__header-row">
        <div className="panel__header">Moves</div>
        {reviewPly !== null && (
          <button type="button" className="move-list__live-button" onClick={onBackToLive}>
            ● Back to live
          </button>
        )}
      </div>
      <div className="move-list__scroll" ref={scrollRef}>
        {buildRows(moves).map((row) => (
          <div key={row.moveNumber} className="move-list__row">
            <span className="move-list__number">{row.moveNumber}.</span>
            <BotMoveButton move={row.white} reviewPly={reviewPly} onSelect={onSelectPly} />
            <BotMoveButton move={row.black} reviewPly={reviewPly} onSelect={onSelectPly} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Live game against the bot. Deliberately a sibling of `GameAnalysisPage` rather
 * than a mode inside it: there is no analysis here, so no eval bar, no
 * classifications and no accuracy panel. The move list can still be clicked
 * to review a past position (`reviewPly` below) — read-only, and independent
 * of the live game continuing underneath it — but that's the one navigation
 * concept this page borrows from the analysis board, not a full second copy
 * of it.
 */
export function PlayBotPage({ bot, onNewGame, onExit, onAnalyzed }: PlayBotPageProps) {
  const {
    botGame,
    displayFen,
    lastMoveUci,
    lastCapture,
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

  // Board orientation is independent of which colour the player is actually
  // playing — "flipped" just means "look at the board from the other side",
  // same as GameAnalysisPage's own Flip button. Reset on every new game (by
  // id, not just existence) so starting another game always opens with the
  // player's own pieces at the bottom, regardless of how the previous game
  // was left — this page's `PlayBotPage` instance is not guaranteed to
  // remount between games (only the URL's `:gameId` changes), so without
  // this a flip from a previous game would silently carry over.
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setFlipped(false);
  }, [botGame?.id]);

  // A drop that reaches the back rank but hasn't been told *which* piece to
  // become yet. Set by `handlePieceDrop` below instead of submitting
  // straight away with an assumed queen; cleared either by a real choice
  // (`handlePromotionChoice`) or by backing out (`PromotionPicker`'s
  // backdrop click). Reset alongside `flipped` on a new game for the same
  // reason — a stale pending prompt from a finished game has no move to
  // attach to any more.
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  useEffect(() => {
    setPendingPromotion(null);
  }, [botGame?.id]);

  // Which past position (by ply) is being reviewed on the board — `null`
  // means "show the live position". Deliberately does *not* reset when a
  // new move arrives (the bot's reply, or the player's own next move): the
  // live game keeps advancing in the background exactly as it would with a
  // browser tab open to a spot you're not looking at, and only resets on an
  // actual new game or an explicit "Back to live" click.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  useEffect(() => {
    setReviewPly(null);
  }, [botGame?.id]);

  // "Analyze this game" — POST /api/bot-games/{id}/analyze mints a real
  // `games` row + `AnalysisJob` from this finished game and hands the job id
  // to `onAnalyzed`, which navigates the same place any other analysed
  // game's job would. `analyzing` covers exactly the request itself, not the
  // analysis job running afterward — once the job exists the analysis page
  // owns showing its own progress, the same as the normal upload flow.
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  useEffect(() => {
    setAnalyzeError(null);
  }, [botGame?.id]);

  const handleAnalyze = async () => {
    if (!botGame) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const job = await analyzeBotGame(botGame.id);
      onAnalyzed(job.id);
    } catch (err) {
      setAnalyzeError(errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  };

  // The position `reviewPly` points at, replayed from scratch — mirrors
  // `useBotGame`'s own `buildBoard` (UCI first, SAN as a fallback) rather
  // than reaching into that hook's internals, since this is deliberately a
  // *second*, independent read of the same move list: the live board never
  // needs to know a review is happening.
  const reviewPosition = useMemo(() => {
    if (reviewPly === null || !botGame) return null;
    const chess = new Chess();
    let lastUci: string | null = null;
    let lastCapture: CapturedPiece | null = null;
    for (const move of botGame.moves) {
      if (move.ply > reviewPly) break;
      let played;
      try {
        const promotion = move.uci.length > 4 ? move.uci.slice(4, 5) : undefined;
        played = chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion });
      } catch {
        try {
          played = chess.move(move.san);
        } catch {
          break;
        }
      }
      lastUci = played.lan;
      lastCapture = capturedPieceFromMove(played);
    }
    return { fen: chess.fen(), lastMoveUci: lastUci, lastCapture };
  }, [reviewPly, botGame]);

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
  // Whatever is actually on the board right now — the live position, or a
  // past one being reviewed. Every board-facing value below reads from this
  // rather than `displayFen`/`lastMoveUci`/`lastCapture` directly, the same
  // "one derived source of truth" shape GameAnalysisPage's own
  // `boardFen`/`previewPosition` pairing uses.
  const boardFen = reviewPosition ? reviewPosition.fen : displayFen;
  const boardLastMoveUci = reviewPosition ? reviewPosition.lastMoveUci : lastMoveUci;
  const boardLastCapture = reviewPosition ? reviewPosition.lastCapture : lastCapture;
  // Which colour's pieces are drawn at the *bottom* of the board — the
  // player's own by default, the opponent's once flipped. Everything below
  // that lays the board out (which `PlayerBar` goes where, `ChessBoard`'s own
  // `boardOrientation`) reads from this rather than `playerColor` directly.
  const boardOrientation: BotColor = flipped ? opponentColor : playerColor;
  const topColor: BotColor = boardOrientation === 'white' ? 'black' : 'white';
  const bottomColor: BotColor = boardOrientation;

  // `react-chessboard` needs a synchronous verdict, so the client-side legality
  // check answers the board immediately and the network call runs behind it. A
  // `true` here only suppresses the snap-back animation — the piece is not
  // actually moved until the server's position comes back through `displayFen`.
  const handlePieceDrop = ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (targetSquare === null) return false;
    // Client-side, `sanForMove` picks a queen for any promotion by default
    // (`findLegalMove`'s own fallback) — `=` in the resulting SAN is what
    // tells us this drop landed on the back rank at all, queen or not. A
    // real choice is asked for below rather than trusting that default.
    const san = sanForMove(sourceSquare, targetSquare);
    if (san === null) {
      playIllegal();
      return false;
    }
    if (san.includes('=')) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      // Reject the drop itself — the board's own snap-back animation
      // returns the pawn to its origin square while the picker is up, so
      // there is no half-submitted state to unwind if the player backs out.
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

  // The player's actual choice, once `pendingPromotion` opened the picker.
  // Mirrors `handlePieceDrop`'s own drop-then-attempt shape exactly — the
  // only difference is the trusted gesture this now traces back to is the
  // picker button's own click, not the original drag.
  const handlePromotionChoice = (piece: PromotionChoice) => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    const san = sanForMove(from, to, piece);
    if (san === null) {
      playIllegal();
      return;
    }
    playForMove(san);
    justPlayedRef.current = true;
    void attemptMove(from, to, piece).then((accepted) => {
      if (!accepted) {
        justPlayedRef.current = false;
        playIllegal();
      }
    });
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
            Whichever colour sits at the bottom (`boardOrientation`, the
            player's own by default, swapped by the Flip button below) gets
            the bottom bar; the other colour gets the top one. Each bar's own
            content (name/meta/captured pieces) is keyed off *whose* colour it
            is, not fixed top/bottom roles, so the two bars swap places
            cleanly on flip instead of swapping content in place.
          */}
          <div className="player-bar">
            <span className={`player-bar__disc player-bar__disc--${topColor}`} aria-hidden="true" />
            <span className="player-bar__name">{topColor === playerColor ? 'You' : 'Tal bot'}</span>
            {topColor === opponentColor && (
              <span className="player-bar__meta">
                ({isGrandmasterElo(botGame.bot_elo) ? 'Grandmaster' : botGame.bot_elo}, aggression{' '}
                {botGame.bot_aggression})
              </span>
            )}
            <CapturedPieces fen={boardFen} side={topColor} />
          </div>

          <ChessBoard
            displayFen={boardFen}
            lastMoveUci={boardLastMoveUci}
            lastCapture={boardLastCapture}
            boardOrientation={boardOrientation}
            allowDragging={isLive && !botThinking && !pendingPromotion && reviewPly === null}
            onPieceDrop={handlePieceDrop}
            legalMovesFor={legalMovesFrom}
          />

          {reviewPly !== null && (
            <div className="review-banner">
              <span>👁 Reviewing move {reviewPly} — the live game continues in the background</span>
              <button type="button" className="button" onClick={() => setReviewPly(null)}>
                Back to live
              </button>
            </div>
          )}

          <div className="player-bar">
            <span className={`player-bar__disc player-bar__disc--${bottomColor}`} aria-hidden="true" />
            <span className="player-bar__name">{bottomColor === playerColor ? 'You' : 'Tal bot'}</span>
            {bottomColor === opponentColor && (
              <span className="player-bar__meta">
                ({isGrandmasterElo(botGame.bot_elo) ? 'Grandmaster' : botGame.bot_elo}, aggression{' '}
                {botGame.bot_aggression})
              </span>
            )}
            <CapturedPieces fen={boardFen} side={bottomColor} />
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
            <button
              className="button"
              type="button"
              onClick={() => setFlipped((current) => !current)}
              title="Flip the board"
            >
              Flip
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
              <button
                className="button"
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={analyzing}
                title="Run a real Stockfish analysis on this game — accuracy, move classifications, everything an uploaded game gets"
              >
                {analyzing ? 'Starting analysis…' : '🔎 Analyze this game'}
              </button>
            </div>
          )}

          {analyzeError && <div className="alert alert--error">{analyzeError}</div>}
          {error && <div className="alert alert--error">{error}</div>}
        </section>

        <aside className="analysis__side-column">
          <BotStrategyPanel botGame={botGame} />
          <BotMoveList
            moves={botGame.moves}
            reviewPly={reviewPly}
            onSelectPly={(ply) => setReviewPly((current) => (current === ply ? null : ply))}
            onBackToLive={() => setReviewPly(null)}
          />
        </aside>
      </div>

      {pendingPromotion && (
        <PromotionPicker
          color={playerColor === 'white' ? 'w' : 'b'}
          onChoose={handlePromotionChoice}
          onCancel={() => setPendingPromotion(null)}
        />
      )}
    </div>
  );
}
