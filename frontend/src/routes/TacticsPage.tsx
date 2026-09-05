import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import type { PieceDropHandlerArgs } from 'react-chessboard';
import { ChessBoard, capturedPieceFromMove } from '../components/board/ChessBoard';
import type { CapturedPiece } from '../components/board/ChessBoard';
import { PromotionPicker } from '../components/board/PromotionPicker';
import type { PromotionChoice } from '../components/board/PromotionPicker';
import { PanelSkeleton } from '../components/common/Skeleton';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { getPuzzles } from '../api/puzzles';
import { errorMessage } from '../api/client';
import { classificationColor, classificationLabel } from '../styles/classification-colors';
import type { LegalMoveTarget, Puzzle } from '../types';

/** How many puzzles to fetch per batch. Shuffled server-side (see
 * `puzzles_service.select_puzzles`), so re-fetching after exhausting a batch
 * naturally serves a fresh random order rather than repeating one. */
const BATCH_SIZE = 20;

type Verdict = 'playing' | 'correct' | 'wrong';

/**
 * Tactics trainer: replay your own real Mistakes/Blunders as puzzles.
 *
 * Deliberately client-side only, no server round-trip per attempt: unlike
 * `PlayBotPage` (where the server is the authority on the position, since a
 * bot replies), a puzzle's position and correct answer are both already
 * fully known up front — chess.js alone can judge every attempt instantly.
 */
export function TacticsPage() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [index, setIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [verdict, setVerdict] = useState<Verdict>('playing');
  // The move actually attempted this puzzle, if any — `null` means "show the
  // puzzle's own starting position". Deliberately *not* a `boardFen` state
  // variable kept in sync via an effect: an effect only runs after a render
  // has already committed, so the first render where `puzzles` has just
  // loaded (but a "which puzzle is this" sync effect hasn't fired yet) would
  // hand `ChessBoard` a stale or placeholder FEN — which is exactly what
  // crashed `react-chessboard` here during development. Deriving the FEN
  // fresh from `puzzle` on every render (below) closes that gap entirely:
  // there is no separate piece of state that can lag behind.
  const [playedMove, setPlayedMove] = useState<{
    fen: string;
    uci: string;
    capture: CapturedPiece | null;
  } | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [solved, setSolved] = useState(0);
  const [attempted, setAttempted] = useState(0);

  const { playForMove, playIllegal } = useSoundEffects();

  // The puzzle's own position, replayed move-by-move as the player attempts
  // it — a fresh instance per puzzle (reset in the effect below), never the
  // shared `chess.js` instance a multi-move game would need, since a puzzle
  // is exactly one move deep.
  const chessRef = useRef(new Chess());
  const puzzle: Puzzle | null = puzzles && puzzles.length > 0 ? puzzles[index] : null;

  const loadBatch = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getPuzzles(BATCH_SIZE)
      .then((data) => {
        setPuzzles(data.puzzles);
        setTotalAvailable(data.total_available);
        setIndex(0);
      })
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadBatch();
  }, [loadBatch]);

  // Reset to the puzzle's own starting position whenever it changes (a new
  // puzzle, or the batch just loaded) — mirrors `ChessBoard`'s own
  // `displayFen`-driven sync, just without a server in the loop.
  useEffect(() => {
    if (!puzzle) return;
    chessRef.current = new Chess(puzzle.fen);
    setPlayedMove(null);
    setVerdict('playing');
    setPendingPromotion(null);
  }, [puzzle]);

  // Referentially stable (empty deps), reading the live puzzle/verdict via
  // refs rather than closing over them directly — the same contract
  // `ChessBoard`'s `legalMovesFor` prop documents, since it feeds that
  // component's own `squareStyles` memo.
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;

  const legalMovesFor = useCallback((square: string): LegalMoveTarget[] => {
    if (verdictRef.current !== 'playing') return [];
    let moves: Move[];
    try {
      moves = chessRef.current.moves({ square: square as Square, verbose: true });
    } catch {
      return [];
    }
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

  const isPromotion = (from: string, to: string): boolean => {
    try {
      return chessRef.current
        .moves({ square: from as Square, verbose: true })
        .some((move) => move.to === to && move.promotion !== undefined);
    } catch {
      return false;
    }
  };

  const resolveMove = useCallback(
    (from: string, to: string, promotion?: PromotionChoice) => {
      if (!puzzle) return;
      let move: Move | null;
      try {
        move = chessRef.current.move({ from, to, promotion });
      } catch {
        move = null;
      }
      if (!move) {
        playIllegal();
        return;
      }

      playForMove(move.san);
      const playedUci = `${move.from}${move.to}${move.promotion ?? ''}`;
      setPlayedMove({
        fen: chessRef.current.fen(),
        uci: playedUci,
        capture: capturedPieceFromMove(move),
      });

      const correct = playedUci.toLowerCase() === puzzle.correct_uci.toLowerCase();
      setVerdict(correct ? 'correct' : 'wrong');
      setAttempted((count) => count + 1);
      if (correct) setSolved((count) => count + 1);
    },
    [puzzle, playForMove, playIllegal],
  );

  const handlePieceDrop = ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
    if (targetSquare === null || verdict !== 'playing') return false;
    if (isPromotion(sourceSquare, targetSquare)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      return false;
    }
    resolveMove(sourceSquare, targetSquare);
    return true;
  };

  const handlePromotionChoice = (piece: PromotionChoice) => {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    resolveMove(from, to, piece);
  };

  const goNext = () => {
    if (!puzzles) return;
    if (index + 1 < puzzles.length) {
      setIndex((current) => current + 1);
    } else {
      // Batch exhausted — fetch a fresh (re-shuffled) one rather than
      // looping the same puzzles in the same order.
      loadBatch();
    }
  };

  const boardOrientation = puzzle?.side_to_move ?? 'white';
  // Derived, not stored — see `playedMove`'s own comment above for why.
  const boardFen = playedMove?.fen ?? puzzle?.fen ?? new Chess().fen();
  const lastMoveUci = playedMove?.uci ?? null;
  const lastCapture = playedMove?.capture ?? null;

  const progressLabel = useMemo(() => {
    if (!puzzles || puzzles.length === 0) return null;
    return `Puzzle ${index + 1} of ${puzzles.length} · ${totalAvailable} available`;
  }, [puzzles, index, totalAvailable]);

  if (loading && !puzzles) {
    return (
      <div className="analysis">
        <PanelSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="analysis">
        <div className="alert alert--error">{loadError}</div>
      </div>
    );
  }

  if (!puzzles || puzzles.length === 0) {
    return (
      <div className="analysis">
        <div className="panel">
          <h2>Tactics Trainer</h2>
          <p>
            No Mistakes or Blunders on your side yet across your analysed games — nothing to
            drill. Analyse a few more games, or come back after your next one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis">
      <h2>Tactics Trainer</h2>
      <p className="tactics__subtitle">
        Find the move Stockfish says you missed. Every puzzle is a real position from one of your
        own games.
      </p>

      <div className="analysis__body">
        <section className="analysis__board-column">
          <ChessBoard
            displayFen={boardFen}
            lastMoveUci={lastMoveUci}
            lastCapture={lastCapture}
            boardOrientation={boardOrientation}
            allowDragging={verdict === 'playing'}
            onPieceDrop={handlePieceDrop}
            legalMovesFor={legalMovesFor}
          />
          {pendingPromotion && (
            <PromotionPicker
              color={boardOrientation === 'white' ? 'w' : 'b'}
              onChoose={handlePromotionChoice}
              onCancel={() => setPendingPromotion(null)}
            />
          )}
        </section>

        <section className="analysis__side-column">
          <div className="panel tactics__panel">
            {progressLabel && <div className="tactics__progress">{progressLabel}</div>}
            {puzzle && (
              <div className="tactics__meta">
                {puzzle.white_name} vs {puzzle.black_name}
                {puzzle.opening_name && ` · ${puzzle.opening_name}`}
              </div>
            )}

            {verdict === 'playing' && (
              <p className="tactics__prompt">
                {boardOrientation === 'white' ? 'White' : 'Black'} to move — find the best move.
              </p>
            )}

            {verdict === 'correct' && puzzle && (
              <div className="tactics__result tactics__result--correct">
                <strong>Correct — {puzzle.correct_san} was the best move.</strong>
                <p>
                  In the actual game you played{' '}
                  <span
                    className="tactics__tag"
                    style={{ backgroundColor: classificationColor(puzzle.classification) }}
                  >
                    {classificationLabel(puzzle.classification)}
                  </span>{' '}
                  {puzzle.played_san} instead.
                </p>
              </div>
            )}

            {verdict === 'wrong' && puzzle && (
              <div className="tactics__result tactics__result--wrong">
                <strong>Not the best move.</strong>
                <p>
                  The best move was <strong>{puzzle.correct_san}</strong>. In the actual game you
                  played{' '}
                  <span
                    className="tactics__tag"
                    style={{ backgroundColor: classificationColor(puzzle.classification) }}
                  >
                    {classificationLabel(puzzle.classification)}
                  </span>{' '}
                  {puzzle.played_san}.
                </p>
              </div>
            )}

            {verdict !== 'playing' && (
              <button type="button" className="button button--primary" onClick={goNext}>
                Next puzzle
              </button>
            )}

            <div className="tactics__score">
              Solved {solved} / {attempted}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
