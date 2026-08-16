import { useEffect, useRef, useState } from 'react';
import { ChessBoard } from '../board/ChessBoard';
import { BoardThemePicker } from '../board/BoardThemePicker';
import { EvalBar } from '../board/EvalBar';
import { MoveList } from '../moves/MoveList';
import { EvalGraph } from '../moves/EvalGraph';
import { AccuracyPanel } from '../analysis/AccuracyPanel';
import { MoveSummaryPanel } from '../analysis/MoveSummaryPanel';
import { RecommendationsPanel } from '../analysis/RecommendationsPanel';
import { useGameNavigation } from '../../hooks/useGameNavigation';
import { useSoundEffects } from '../../hooks/useSoundEffects';
import { useCoachVoice } from '../../lib/coachVoice';
import { commentaryForAnalysisMove } from '../../lib/coach';
import { estimatePerformanceRating } from '../../lib/performanceRating';
import { accuracyColor, classificationColor, classificationLabel } from '../../styles/classification-colors';
import type { Game, MoveAnalysis } from '../../types';

type GameAnalysisPageProps = {
  game: Game | null;
  moves: MoveAnalysis[];
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  onAnalyseAnother: () => void;
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
}: {
  side: Side;
  name: string;
  elo: number | null;
  accuracy: number | null;
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
    </div>
  );
}

export function GameAnalysisPage({
  game,
  moves,
  whiteAccuracy,
  blackAccuracy,
  onAnalyseAnother,
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
    speak(commentaryForAnalysisMove(move));
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
        <button className="button" type="button" onClick={onAnalyseAnother}>
          Analyse another game
        </button>
      </header>

      <div className="analysis__body">
        <section className="analysis__board-column">
          <PlayerBar
            side={topPlayer.side}
            name={topPlayer.name}
            elo={topPlayer.elo}
            accuracy={topPlayer.accuracy}
          />

          <div className="board-with-bar">
            <EvalBar moves={moves} currentMoveIndex={currentMoveIndex} orientation={orientation} />
            <ChessBoard
              displayFen={displayFen}
              lastMoveUci={lastMoveUci}
              boardOrientation={orientation}
              moveBadge={moveBadge}
            />
          </div>

          <PlayerBar
            side={bottomPlayer.side}
            name={bottomPlayer.name}
            elo={bottomPlayer.elo}
            accuracy={bottomPlayer.accuracy}
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
            <button
              className="button"
              type="button"
              onClick={toggleCoachMuted}
              title={coachMuted ? 'Turn on coach commentary' : 'Turn off coach commentary'}
              aria-label={coachMuted ? 'Turn on coach commentary' : 'Turn off coach commentary'}
              aria-pressed={!coachMuted}
            >
              {coachMuted ? '🎙️' : '🗣️'}
            </button>
            <BoardThemePicker />
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

          <RecommendationsPanel upcomingMove={upcomingMove} />
        </section>

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
