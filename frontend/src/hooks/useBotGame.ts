import { useCallback, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { claimBotDraw, createBotGame, getBotGame, submitBotMove, undoBotMove } from '../api/botGame';
import { ApiError, errorMessage } from '../api/client';
import type { BotColor, BotGame, BotGameMove, LegalMoveTarget } from '../types';

export type BotGameHook = {
  /** Server-authoritative game state. Replaced wholesale, never patched. */
  botGame: BotGame | null;
  /** FEN to render. Derived from `botGame.moves`, never stored per move. */
  displayFen: string;
  /** UCI of the last move played, for the board highlight. */
  lastMoveUci: string | null;
  /** True while POST /moves is in flight — covers "accepted?" and "bot replying". */
  botThinking: boolean;
  /** True while POST /api/bot-games is in flight. */
  creating: boolean;
  /** True while POST /undo is in flight. */
  undoing: boolean;
  /** True while POST /claim-draw is in flight. */
  claimingDraw: boolean;
  /** Whether there is a player move on the board for `undoMove` to roll back. */
  canUndo: boolean;
  /** Best-effort hint for enabling the "Claim Draw" button — see `claimDraw`. */
  canClaimDraw: boolean;
  /** Last error message, already narrowed to a string via `errorMessage`. */
  error: string | null;
  /** Resolves the new game's id on success, `null` on failure (see `error`). */
  createGame: (
    playerColor: BotColor,
    elo: number,
    aggression: number,
    gambitId: string | null,
    adaptToOpponent: boolean,
  ) => Promise<string | null>;
  /**
   * Re-fetches an existing game by id and adopts it as current — used to
   * restore an in-progress game after a full page reload (e.g. the tab was
   * discarded while the screen was off). Resolves `true` on success; `false`
   * means the game is gone or unreachable, and the caller should fall back to
   * a fresh screen rather than get stuck on a game that can never load.
   */
  loadGame: (id: string) => Promise<boolean>;
  /**
   * Submits a player move. Resolves `true` once the server has confirmed it (and
   * the bot's reply is already in state), `false` if it was rejected.
   */
  attemptMove: (
    sourceSquare: string,
    targetSquare: string,
    promotion?: string,
  ) => Promise<boolean>;
  /** Synchronous legality check — no network, no mutation. */
  isLegalMove: (sourceSquare: string, targetSquare: string, promotion?: string) => boolean;
  /**
   * SAN of the legal move matching a drag, or `null` if there isn't one.
   * Synchronous, no network — lets the caller play the move sound *inside*
   * the drop handler itself, in the same real user gesture that started the
   * drag, rather than later from an effect reacting to the server's reply.
   * That distinction is what makes the sound reliable: a browser's autoplay
   * policy is about being in a trusted gesture's call stack, and an
   * effect firing after an async round trip no longer is.
   */
  sanForMove: (sourceSquare: string, targetSquare: string, promotion?: string) => string | null;
  /**
   * Every square a piece on `square` may legally move to right now, for the
   * board's move markers. Synchronous, no network, no mutation; returns an
   * empty list whenever a move would be refused anyway (game over, request in
   * flight, not that side's turn).
   */
  legalMovesFrom: (square: string) => LegalMoveTarget[];
  /**
   * Rolls back to the player's own turn: undoes the bot's last reply and the
   * player move before it together. Resolves `true` on success, `false` if
   * there was nothing to undo or the request failed (see `error`).
   */
  undoMove: () => Promise<boolean>;
  /**
   * Claims a draw by threefold repetition or the fifty-move rule. Resolves
   * `true` on success, `false` if the server refused it (see `error`) — the
   * position's own eligibility is decided server-side, not guessed here.
   */
  claimDraw: () => Promise<boolean>;
  /** Drops the current game so the setup form can start a fresh one. */
  reset: () => void;
};

/**
 * Rebuilds a board from scratch by replaying every move in the list.
 *
 * Mirrors `useGameNavigation`'s `buildFen`: UCI first, SAN as a fallback, and if
 * both fail the server's own recorded FEN wins — rendering a position that
 * silently disagrees with the move list is the failure mode worth avoiding.
 */
function buildBoard(moves: BotGameMove[]): Chess {
  const chess = new Chess();

  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    try {
      // UCI is the canonical form: `e2e4`, or `e7e8q` when promoting.
      const promotion = move.uci.length > 4 ? move.uci.slice(4, 5) : undefined;
      chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion });
    } catch {
      try {
        chess.move(move.san);
      } catch {
        console.warn(
          `[useBotGame] could not replay ply ${move.ply} (${move.san} / ${move.uci});` +
            ' falling back to the recorded FEN.',
        );
        try {
          chess.load(move.fen_after);
        } catch {
          // Even the recorded FEN is unusable; keep whatever replayed cleanly.
        }
        return chess;
      }
    }
  }

  return chess;
}

/**
 * Finds the legal move matching a drag, without mutating `chess`.
 *
 * Using the engine's own legal-move list (rather than a speculative `.move()`)
 * means the caller's board object can never be left holding a move the server
 * has not confirmed. It also settles the promotion suffix correctly: the `q` in
 * `e7e8q` comes from the matched move, so a normal move never picks up a stray
 * suffix and a promotion never omits one.
 */
function findLegalMove(
  chess: Chess,
  from: string,
  to: string,
  promotion?: string,
): Move | null {
  const candidates = chess.moves({ verbose: true }).filter(
    (move) => move.from === from && move.to === to,
  );
  if (candidates.length === 0) return null;

  const promotions = candidates.filter((move) => move.promotion !== undefined);
  if (promotions.length > 0) {
    const wanted = promotion ?? 'q';
    return promotions.find((move) => move.promotion === wanted) ?? promotions[0];
  }

  return candidates[0];
}

/**
 * Owns one live game against the bot.
 *
 * The invariant, and the whole point of the design: **the server's `BotGame` is
 * the only source of truth**. Every successful call replaces local state with
 * the response object wholesale — no merging, no appending a move we think was
 * played. The board is then derived from that list by full replay, so the
 * position on screen cannot drift from the game the backend believes is being
 * played.
 *
 * The one concession to responsiveness is `optimistic`: after the *client-side*
 * legality check passes, the position the player just created is shown while the
 * request is in flight, so the piece does not visibly snap back for the length
 * of a round trip. It is display-only and is cleared unconditionally in the same
 * `finally` that clears `botThinking`, so it can never outlive the request or
 * become the state anything else reads.
 */
export function useBotGame(): BotGameHook {
  const [botGame, setBotGame] = useState<BotGame | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [claimingDraw, setClaimingDraw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ fen: string; uci: string } | null>(null);

  // Board mirroring `botGame.moves`. Rebuilt from scratch whenever the game
  // changes, so it is structurally incapable of accumulating drift.
  const chessRef = useRef<Chess>(new Chess());

  // Refs let `attemptMove` be a stable callback that always reads current state.
  // `react-chessboard` captures the drop handler at drag start, so a handler
  // that closed over stale state would be a real (if narrow) desync path.
  const botGameRef = useRef<BotGame | null>(null);
  const inFlightRef = useRef(false);

  const serverBoard = useMemo(() => {
    const chess = buildBoard(botGame?.moves ?? []);
    chessRef.current = chess;
    botGameRef.current = botGame;
    const moves = botGame?.moves ?? [];
    return {
      fen: chess.fen(),
      lastUci: moves.length > 0 ? moves[moves.length - 1].uci : null,
      // A best-effort client-side hint for the "Claim Draw" button's enabled
      // state only — the server (bot_game_service.claim_draw) is still the
      // real arbiter on click. Threefold repetition and the fifty-move rule
      // are the only ways `isDraw()` can be true while the game is still
      // `in_progress`: stalemate/insufficient material/75-move already end
      // the game server-side before that status would ever be seen here.
      canClaimDraw: chess.isDraw(),
    };
  }, [botGame]);

  const displayFen = optimistic?.fen ?? serverBoard.fen;
  const lastMoveUci = optimistic?.uci ?? serverBoard.lastUci;

  const isLegalMove = useCallback(
    (sourceSquare: string, targetSquare: string, promotion?: string): boolean => {
      const game = botGameRef.current;
      if (!game || game.status !== 'in_progress') return false;
      if (inFlightRef.current) return false;
      return findLegalMove(chessRef.current, sourceSquare, targetSquare, promotion) !== null;
    },
    [],
  );

  const sanForMove = useCallback(
    (sourceSquare: string, targetSquare: string, promotion?: string): string | null => {
      const game = botGameRef.current;
      if (!game || game.status !== 'in_progress') return null;
      if (inFlightRef.current) return null;
      const match = findLegalMove(chessRef.current, sourceSquare, targetSquare, promotion);
      return match?.san ?? null;
    },
    [],
  );

  const legalMovesFrom = useCallback((square: string): LegalMoveTarget[] => {
    const game = botGameRef.current;
    // Same gating as `isLegalMove`: never advertise a move that would be
    // rejected on drop.
    if (!game || game.status !== 'in_progress') return [];
    if (inFlightRef.current) return [];

    let moves: Move[];
    try {
      // chess.js only lists moves for the side to move, so this is empty while
      // it is the bot's turn — no extra turn check needed.
      moves = chessRef.current.moves({ square: square as Square, verbose: true });
    } catch {
      // chess.js throws on a square it does not recognise.
      return [];
    }

    // A promotion yields four moves to the same square; the marker only cares
    // about the destination, so collapse them.
    const targets = new Map<string, LegalMoveTarget>();
    moves.forEach((move) => {
      const existing = targets.get(move.to);
      const capture = move.captured !== undefined;
      if (existing) {
        existing.capture = existing.capture || capture;
      } else {
        targets.set(move.to, { to: move.to, capture });
      }
    });

    return [...targets.values()];
  }, []);

  const createGame = useCallback(
    async (
      playerColor: BotColor,
      elo: number,
      aggression: number,
      gambitId: string | null,
      adaptToOpponent: boolean,
    ): Promise<string | null> => {
      setCreating(true);
      setError(null);
      setOptimistic(null);
      try {
        const data = await createBotGame({
          player_color: playerColor,
          bot_elo: elo,
          bot_aggression: aggression,
          gambit_id: gambitId,
          adapt_to_opponent: adaptToOpponent,
        });
        botGameRef.current = data.bot_game;
        setBotGame(data.bot_game);
        return data.bot_game.id;
      } catch (err) {
        botGameRef.current = null;
        setBotGame(null);
        setError(errorMessage(err));
        return null;
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  const loadGame = useCallback(async (id: string): Promise<boolean> => {
    setCreating(true);
    setError(null);
    setOptimistic(null);
    try {
      const data = await getBotGame(id);
      botGameRef.current = data.bot_game;
      setBotGame(data.bot_game);
      return true;
    } catch (err) {
      botGameRef.current = null;
      setBotGame(null);
      setError(errorMessage(err));
      return false;
    } finally {
      setCreating(false);
    }
  }, []);

  const attemptMove = useCallback(
    async (
      sourceSquare: string,
      targetSquare: string,
      promotion?: string,
    ): Promise<boolean> => {
      const game = botGameRef.current;
      if (!game) return false;
      if (game.status !== 'in_progress') {
        setError('This game is already over.');
        return false;
      }
      // One move at a time: a second drop while the bot is replying would race
      // two writes against the same game.
      if (inFlightRef.current) return false;

      // 1. Client-side pre-check. Rejected drags never touch the network.
      const legal = findLegalMove(chessRef.current, sourceSquare, targetSquare, promotion);
      if (!legal) return false;

      const uci = `${legal.from}${legal.to}${legal.promotion ?? ''}`;

      inFlightRef.current = true;
      setBotThinking(true);
      setError(null);
      // Display-only; discarded in `finally` whatever happens.
      setOptimistic({ fen: legal.after, uci });

      try {
        // 2 + 3. The response carries the player's move *and* the bot's reply.
        // Replace local state with it wholesale — never merge, never append.
        const data = await submitBotMove(game.id, { uci });
        botGameRef.current = data.bot_game;
        setBotGame(data.bot_game);
        return true;
      } catch (err) {
        // 4. Should be unreachable after the pre-check, but if the server and
        // chess.js ever disagree the server wins: surface it and leave state
        // untouched, so the next render snaps back to the server's position.
        if (err instanceof ApiError && err.code === 'ILLEGAL_MOVE') {
          setError(err.message);
          return false;
        }
        // 5. Anything else — including 409 GAME_OVER and network failures.
        setError(errorMessage(err));
        return false;
      } finally {
        // 6.
        inFlightRef.current = false;
        setBotThinking(false);
        setOptimistic(null);
      }
    },
    [],
  );

  const undoMove = useCallback(async (): Promise<boolean> => {
    const game = botGameRef.current;
    if (!game) return false;
    // Same single-flight guard as `attemptMove` — an undo racing a drop
    // (or a second undo click) would send two writes against one game.
    if (inFlightRef.current) return false;

    inFlightRef.current = true;
    setUndoing(true);
    setError(null);
    try {
      const data = await undoBotMove(game.id);
      botGameRef.current = data.bot_game;
      setBotGame(data.bot_game);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      inFlightRef.current = false;
      setUndoing(false);
    }
  }, []);

  const claimDraw = useCallback(async (): Promise<boolean> => {
    const game = botGameRef.current;
    if (!game) return false;
    // Same single-flight guard as `attemptMove`/`undoMove`.
    if (inFlightRef.current) return false;

    inFlightRef.current = true;
    setClaimingDraw(true);
    setError(null);
    try {
      const data = await claimBotDraw(game.id);
      botGameRef.current = data.bot_game;
      setBotGame(data.bot_game);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      inFlightRef.current = false;
      setClaimingDraw(false);
    }
  }, []);

  // At least one move the player actually chose is on the board — the bot's
  // opening move (as White, before the player has moved at all) does not
  // count, matching `undo_last_move`'s own "nothing to undo yet" guard.
  const canUndo = (botGame?.moves ?? []).some((move) => !move.is_bot_move);

  const reset = useCallback(() => {
    botGameRef.current = null;
    inFlightRef.current = false;
    setBotGame(null);
    setBotThinking(false);
    setUndoing(false);
    setClaimingDraw(false);
    setError(null);
    setOptimistic(null);
  }, []);

  return {
    botGame,
    displayFen,
    lastMoveUci,
    botThinking,
    creating,
    undoing,
    claimingDraw,
    canUndo,
    canClaimDraw: serverBoard.canClaimDraw,
    error,
    createGame,
    loadGame,
    attemptMove,
    isLegalMove,
    sanForMove,
    legalMovesFrom,
    undoMove,
    claimDraw,
    reset,
  };
}
