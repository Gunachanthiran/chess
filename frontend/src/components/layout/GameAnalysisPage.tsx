import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import type { PieceDropHandlerArgs } from 'react-chessboard';
import { ChessBoard } from '../board/ChessBoard';
import { BoardThemePicker } from '../board/BoardThemePicker';
import { PieceSetPicker } from '../board/PieceSetPicker';
import { EvalBar } from '../board/EvalBar';
import { CapturedPieces } from '../common/CapturedPieces';
import { MoveList } from '../moves/MoveList';
import { EvalGraph } from '../moves/EvalGraph';
import { AccuracyPanel } from '../analysis/AccuracyPanel';
import { MoveSummaryPanel } from '../analysis/MoveSummaryPanel';
import { RecommendationsPanel } from '../analysis/RecommendationsPanel';
import { CoachPanel } from '../analysis/CoachPanel';
import { useGameNavigation } from '../../hooks/useGameNavigation';
import { useSoundEffects } from '../../hooks/useSoundEffects';
import { useCoachVoice } from '../../lib/coachVoice';
import { commentaryForAnalysisMove, isNotableMove } from '../../lib/coach';
import { estimatePerformanceRating } from '../../lib/performanceRating';
import { formatEval } from '../../lib/evaluation';
import { explorePosition } from '../../api/analysis';
import { accuracyColor, classificationColor, classificationLabel } from '../../styles/classification-colors';
import { IconRefresh } from '../common/Icons';
import type { ExplorePositionResult, Game, LegalMoveTarget, MoveAnalysis } from '../../types';

type GameAnalysisPageProps = {
  game: Game | null;
  moves: MoveAnalysis[];
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  onAnalyseAnother: () => void;
  /** Runs a fresh analysis job for this same game — `undefined` while the
   * game itself hasn't loaded yet, since there's nothing to re-analyse. */
  onReanalyse?: () => void;
  reanalysing?: boolean;
};

type Side = 'white' | 'black';

/**
 * Estimated rating now lives inline in the player bar rather than its own
 * sidebar panel — same figure chess.com shows right next to a player's name.
 * `accuracy` (not the rating itself) drives the colour so it stays on the same
 * scale as `AccuracyPanel`'s rings instead of introducing a second one.
 */
function PlayerBar({
  side,
  name,
  elo,
  accuracy,
  fen,
}: {
  side: Side;
  name: string;
  elo: number | null;
  accuracy: number | null;
  fen: string;
}) {
  const rating = accuracy === null ? null : estimatePerformanceRating(accuracy);
  const ratingColor = accuracy === null ? undefined : accuracyColor(accuracy);

  return (
    <div className="player-bar">
      <span className={`player-bar__disc player-bar__disc--${side}`} aria-hidden="true" />
      <span className="player-bar__name">{name}</span>
      {elo !== null && <span className="player-bar__meta">({elo})</span>}
      {rating !== null && (
        <span className="player-bar__rating" style={{ color: ratingColor }} title="Estimated rating — a rough estimate from this game's accuracy, not a tracked rating">
          Est. {rating}
        </span>
      )}
      <CapturedPieces fen={fen} side={side} />
    </div>
  );
}

export function GameAnalysisPage({
  game,
  moves,
  whiteAccuracy,
  blackAccuracy,
  onAnalyseAnother,
  onReanalyse,
  reanalysing,
}: GameAnalysisPageProps) {
  const {
    currentMoveIndex,
    setCurrentMoveIndex,
    displayFen,
    lastMoveUci,
    goToStart,
    goToEnd,
    goToPrev,
    goToNext,
  } = useGameNavigation(moves);

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  // "Play this line" from the Stockfish recommendations panel — a purely
  // hypothetical continuation shown on the board, independent of
  // `currentMoveIndex`, so exploring a suggestion never touches the real
  // game's own navigation state. `baseFen` is captured at the moment the
  // preview starts (the position it branches off from), never recomputed,
  // so stepping through the hypothetical line can't drift if the real game
  // position it launched from changes underneath it for any reason.
  const [preview, setPreview] = useState<{ baseFen: string; sans: string[] } | null>(null);
  const [previewStep, setPreviewStep] = useState(0);

  // Real navigation always wins: moving to a different actual position exits
  // whatever hypothetical line was on screen, rather than leaving the board
  // showing a line branched off a position the user has since left.
  useEffect(() => {
    setPreview(null);
  }, [currentMoveIndex]);

  const handlePreview = (sans: string[]) => {
    setPreview({ baseFen: displayFen, sans });
    setPreviewStep(sans.length);
  };

  const previewPosition = useMemo(() => {
    if (!preview) return null;
    const chess = new Chess(preview.baseFen);
    let lastMoveUci: string | null = null;
    for (let i = 0; i < previewStep; i += 1) {
      let move;
      try {
        move = chess.move(preview.sans[i]);
      } catch {
        // A malformed SAN this far into a 10-ply engine line would be a real
        // bug, not a user error — stop replaying rather than throw, and keep
        // whatever position was reached up to that point.
        break;
      }
      lastMoveUci = move.lan;
    }
    return { fen: chess.fen(), lastMoveUci };
  }, [preview, previewStep]);

  /** Whatever position is actually on the board right now — the real game's,
   * or a hypothetical one being explored. Every "try a move here" and
   * "what does the engine think of this" concern below reads from this, not
   * from `displayFen` directly, so exploring stays correct however many
   * moves deep the user has dragged. */
  const boardFen = previewPosition ? previewPosition.fen : displayFen;

  // Dragging a piece on the board — trying *any* move, not just one of the
  // "Stockfish recommends" lines. Starts a preview from the real position if
  // none is active yet; extends the current one otherwise, truncating any
  // steps the user had stepped back past (a new move here replaces whatever
  // hypothetical future existed) exactly like undoing and replaying a
  // variation in a real analysis board would.
  const legalMovesFor = useCallback(
    (square: string): LegalMoveTarget[] => {
      let candidateMoves;
      try {
        candidateMoves = new Chess(boardFen).moves({ square: square as Square, verbose: true });
      } catch {
        return [];
      }
      const targets = new Map<string, LegalMoveTarget>();
      candidateMoves.forEach((candidate) => {
        const existing = targets.get(candidate.to);
        const capture = candidate.captured !== undefined;
        if (existing) {
          existing.capture = existing.capture || capture;
        } else {
          targets.set(candidate.to, { to: candidate.to, capture });
        }
      });
      return [...targets.values()];
    },
    [boardFen],
  );

  const handleBoardDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      if (targetSquare === null) return false;
      const chess = new Chess(boardFen);
      let candidates;
      try {
        candidates = chess
          .moves({ square: sourceSquare as Square, verbose: true })
          .filter((candidate) => candidate.to === targetSquare);
      } catch {
        return false;
      }
      if (candidates.length === 0) return false;

      // Auto-queens on a promoting drop, same as Play Bot — no separate
      // picker dialog in either place.
      const promotions = candidates.filter((candidate) => candidate.promotion !== undefined);
      const chosen =
        promotions.length > 0
          ? (promotions.find((candidate) => candidate.promotion === 'q') ?? promotions[0])
          : candidates[0];

      const baseFen = preview?.baseFen ?? displayFen;
      const priorSans = preview ? preview.sans.slice(0, previewStep) : [];
      const nextSans = [...priorSans, chosen.san];

      setPreview({ baseFen, sans: nextSans });
      setPreviewStep(nextSans.length);
      return true;
    },
    [boardFen, displayFen, preview, previewStep],
  );

  // "What happens if I play this" — an on-demand engine read of whatever
  // position preview/dragging landed on, since arbitrary moves aren't in the
  // game's own stored analysis. Only runs while actually previewing; the
  // real game's positions already have real stored evaluations and need no
  // live call. Keyed on the FEN string rather than `previewPosition` itself,
  // since the latter is a fresh object every render.
  const [exploreEval, setExploreEval] = useState<ExplorePositionResult | null>(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  useEffect(() => {
    if (!previewPosition) {
      setExploreEval(null);
      setExploreLoading(false);
      return;
    }
    let active = true;
    setExploreLoading(true);
    explorePosition(previewPosition.fen)
      .then((result) => {
        if (active) setExploreEval(result);
      })
      .catch(() => {
        if (active) setExploreEval(null);
      })
      .finally(() => {
        if (active) setExploreLoading(false);
      });
    return () => {
      active = false;
    };
  }, [previewPosition?.fen]);

  const { muted, toggleMuted, playForMove } = useSoundEffects();
  const { muted: coachMuted, toggleMuted: toggleCoachMuted, speak } = useCoachVoice();

  // Sound + coach commentary on navigation. Every navigation path in the app
  // — prev/next buttons, move-row clicks, arrow keys, Home/End, eval-graph
  // clicks — can only move `currentMoveIndex`, so watching that one value
  // covers all of them.
  //
  // `playedRef` records the (move list, index) whose sound already played. It
  // starts null so mount is silent, and re-running the effect with unchanged
  // values is a no-op — which is what keeps StrictMode's double-invoke in dev
  // from double-playing. Tracking the move list alongside the index means a
  // newly loaded game resyncs silently instead of sounding a stale move.
  const playedRef = useRef<{ moves: MoveAnalysis[]; index: number } | null>(null);
  useEffect(() => {
    const previous = playedRef.current;
    playedRef.current = { moves, index: currentMoveIndex };

    if (previous === null) return; // First render for this page.
    if (previous.moves !== moves) return; // A different game just loaded.
    if (previous.index === currentMoveIndex) return; // Effect re-ran, nothing moved.
    if (currentMoveIndex <= 0) return; // Starting position — no move to sound.

    const move = moves[currentMoveIndex - 1];
    if (!move) return;
    playForMove(move.san);
    if (isNotableMove(move.classification)) {
      speak(commentaryForAnalysisMove(move), move.classification);
    }
  }, [currentMoveIndex, moves, playForMove, speak]);

  // Keyboard navigation. Bound at the document so the board is reachable
  // without focusing it first, but skipped while the user is typing.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goToPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goToNext();
          break;
        case 'Home':
          event.preventDefault();
          goToStart();
          break;
        case 'End':
          event.preventDefault();
          goToEnd();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [goToPrev, goToNext, goToStart, goToEnd]);

  const currentMove = currentMoveIndex > 0 ? moves[currentMoveIndex - 1] : null;
  // The move about to be played *from* the position currently on the board —
  // distinct from `currentMove` (the one just played to reach it). Feeds
  // `RecommendationsPanel`; `null` once navigation reaches the final recorded
  // position, since there is no "next move" left to recommend one for.
  const upcomingMove = currentMoveIndex < moves.length ? moves[currentMoveIndex] : null;

  // Classification bubble floated over the square the current move landed on.
  // `lastMoveUci` is already the current move's UCI, so characters 2-4 are its
  // destination square for normal moves and promotions alike. Null at the
  // starting position, where there is no move to grade. `ChessBoard` owns the
  // orientation-aware positioning; this only decides *what* to mark.
  const moveBadge =
    currentMove && lastMoveUci && lastMoveUci.length >= 4
      ? { square: lastMoveUci.slice(2, 4), classification: currentMove.classification }
      : null;

  // Chess.com-style flanking bars instead of a name row in the page header:
  // whichever side sits at the bottom of the board (`orientation`) gets the
  // bottom bar, the other side gets the top bar. Flipping the board swaps them.
  const white = {
    side: 'white' as const,
    name: game?.white_name ?? 'White',
    elo: game?.white_elo ?? null,
    accuracy: whiteAccuracy,
  };
  const black = {
    side: 'black' as const,
    name: game?.black_name ?? 'Black',
    elo: game?.black_elo ?? null,
    accuracy: blackAccuracy,
  };
  const topPlayer = orientation === 'white' ? black : white;
  const bottomPlayer = orientation === 'white' ? white : black;

  return (
    <div className="analysis">
      <header className="analysis__header">
        <div className="analysis__opening">
          {game?.result ?? '*'}
          {game?.opening_name && (
            <span className="analysis__opening-name">
              {' · '}
              {game.eco ? `${game.eco} — ` : ''}
              {game.opening_name}
            </span>
          )}
        </div>
        <div className="analysis__header-actions">
          {onReanalyse && (
            <button
              className="button dashboard-card__reanalyse"
              type="button"
              onClick={onReanalyse}
              disabled={reanalysing}
              title="Re-analyse with the latest engine settings"
              aria-label="Re-analyse this game"
            >
              <IconRefresh
                className={reanalysing ? 'dashboard-card__reanalyse-icon--spinning' : undefined}
              />
            </button>
          )}
          <button className="button" type="button" onClick={onAnalyseAnother}>
            Analyse another game
          </button>
        </div>
      </header>

      <div className="analysis__body analysis__body--with-recommendations">
        <section className="analysis__board-column">
          <PlayerBar
            side={topPlayer.side}
            name={topPlayer.name}
            elo={topPlayer.elo}
            accuracy={topPlayer.accuracy}
            fen={boardFen}
          />

          {preview && previewPosition && (
            <div className="preview-banner">
              <div className="preview-banner__top">
                <span className="preview-banner__label">
                  🔎 Exploring — drag any move to try it, not part of the real game
                </span>
                <span className="preview-banner__eval">
                  {exploreLoading
                    ? 'Thinking…'
                    : exploreEval
                      ? `Eval: ${formatEval({ cp: exploreEval.cp, mate: exploreEval.mate })}`
                      : null}
                </span>
              </div>
              {!exploreLoading && exploreEval && exploreEval.top_moves.length > 0 && (
                <span className="preview-banner__best">
                  Stockfish would play {exploreEval.top_moves[0].sans[0]} here
                </span>
              )}
              <div className="preview-banner__controls">
                <button
                  className="button"
                  type="button"
                  onClick={() => setPreviewStep((step) => Math.max(0, step - 1))}
                  disabled={previewStep === 0}
                  title="Step back within this line"
                >
                  ◀
                </button>
                <span className="controls__counter">
                  {previewStep} / {preview.sans.length}
                </span>
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    setPreviewStep((step) => Math.min(preview.sans.length, step + 1))
                  }
                  disabled={previewStep === preview.sans.length}
                  title="Step forward within this line"
                >
                  ▶
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  Back to game
                </button>
              </div>
            </div>
          )}

          <div className="board-with-bar">
            <EvalBar moves={moves} currentMoveIndex={currentMoveIndex} orientation={orientation} />
            <ChessBoard
              displayFen={boardFen}
              lastMoveUci={previewPosition ? previewPosition.lastMoveUci : lastMoveUci}
              boardOrientation={orientation}
              moveBadge={previewPosition ? null : moveBadge}
              allowDragging
              onPieceDrop={handleBoardDrop}
              legalMovesFor={legalMovesFor}
            />
          </div>

          <PlayerBar
            side={bottomPlayer.side}
            name={bottomPlayer.name}
            elo={bottomPlayer.elo}
            accuracy={bottomPlayer.accuracy}
            fen={boardFen}
          />

          <div className="controls">
            <button className="button" type="button" onClick={goToStart} title="Home">
              ⏮
            </button>
            <button className="button" type="button" onClick={goToPrev} title="Left arrow">
              ◀
            </button>
            <span className="controls__counter">
              {currentMoveIndex} / {moves.length}
            </span>
            <button className="button" type="button" onClick={goToNext} title="Right arrow">
              ▶
            </button>
            <button className="button" type="button" onClick={goToEnd} title="End">
              ⏭
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setOrientation((side) => (side === 'white' ? 'black' : 'white'))}
            >
              Flip
            </button>
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
          </div>

          <div className="current-move">
            {currentMove ? (
              <>
                <span
                  className="current-move__badge"
                  style={{ backgroundColor: classificationColor(currentMove.classification) }}
                />
                <strong>
                  {currentMove.move_number}
                  {currentMove.side === 'white' ? '.' : '...'} {currentMove.san}
                </strong>
                <span>{classificationLabel(currentMove.classification)}</span>
                {currentMove.best_move_uci &&
                  currentMove.best_move_uci !== currentMove.uci && (
                    <span className="current-move__best">
                      Best: {currentMove.best_move_uci}
                    </span>
                  )}
              </>
            ) : (
              <span>Starting position — use ← → Home End to navigate</span>
            )}
          </div>
        </section>

        {/*
          DOM order is board, then recommendations, then accuracy/moves — the
          board comes first on purpose so a narrow (single-column) viewport
          stacks it above the text panels instead of making the user scroll
          past commentary to reach it. Desktop's three-column layout still
          puts this one visually on the *left* via an explicit `grid-column`
          in App.css, independent of this source order.
        */}
        <aside className="analysis__recommendations-column">
          <RecommendationsPanel upcomingMove={upcomingMove} onPreview={handlePreview} />
          <CoachPanel move={currentMove} muted={coachMuted} onToggleMute={toggleCoachMuted} />
        </aside>

        <aside className="analysis__side-column">
          {/* Accuracy, move breakdown and the move list share one card instead
              of three, with `.panel-section` dividers standing in for the
              gaps that used to separate them. */}
          <div className="panel combined-panel">
            <AccuracyPanel
              whiteAccuracy={whiteAccuracy}
              blackAccuracy={blackAccuracy}
              game={game}
            />
            <MoveSummaryPanel moves={moves} />
            <MoveList
              moves={moves}
              currentMoveIndex={currentMoveIndex}
              onSelect={setCurrentMoveIndex}
            />
          </div>

          <EvalGraph
            moves={moves}
            currentMoveIndex={currentMoveIndex}
            onSelect={setCurrentMoveIndex}
          />
        </aside>
      </div>
    </div>
  );
}
