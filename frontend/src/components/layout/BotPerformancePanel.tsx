import { useEffect, useState } from 'react';
import { getBotPerformance } from '../../api/botGames';
import { AccuracyTrendChart } from './AccuracyTrendChart';
import {
  classificationColor,
  classificationIcon,
  classificationLabel,
} from '../../styles/classification-colors';
import type { BotPerformance, BotPhaseBreakdown, Classification } from '../../types';

const PHASE_LABEL: Record<BotPhaseBreakdown['phase'], string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

/** Same display order as `MoveSummaryPanel` — most impressive first, worst
 * last, `forced` parked at the bottom as a neutral bookkeeping category. */
const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'blunder',
  'forced',
];

function errorRateColor(pct: number): string {
  if (pct <= 10) return '#96bc4b';
  if (pct <= 20) return '#f7c631';
  return '#ca3431';
}

function scoreColor(scorePct: number): string {
  if (scorePct >= 60) return '#96bc4b';
  if (scorePct >= 45) return '#f7c631';
  return '#ca3431';
}

function PhaseRow({ phase }: { phase: BotPhaseBreakdown }) {
  const { inaccuracies, mistakes, blunders, total_moves: totalMoves } = phase;
  const goodMoves = Math.max(0, totalMoves - inaccuracies - mistakes - blunders);
  const segments: { count: number; color: string }[] = [
    { count: goodMoves, color: 'var(--border)' },
    { count: inaccuracies, color: classificationColor('inaccuracy') },
    { count: mistakes, color: classificationColor('mistake') },
    { count: blunders, color: classificationColor('blunder') },
  ];

  return (
    <div className="phase-breakdown__row">
      <div className="phase-breakdown__row-head">
        <span className="phase-breakdown__phase">{PHASE_LABEL[phase.phase]}</span>
        <span className="phase-breakdown__count">{totalMoves} moves</span>
        <span
          className="phase-breakdown__rate"
          style={{ color: errorRateColor(phase.error_rate_pct) }}
        >
          {Math.round(phase.error_rate_pct)}% errors
        </span>
      </div>
      <div className="phase-breakdown__bar">
        {totalMoves === 0 ? (
          <div className="phase-breakdown__segment" style={{ width: '100%', background: 'var(--bg-sunken)' }} />
        ) : (
          segments.map(
            (segment, index) =>
              segment.count > 0 && (
                <div
                  key={index}
                  className="phase-breakdown__segment"
                  style={{ width: `${(100 * segment.count) / totalMoves}%`, background: segment.color }}
                />
              ),
          )
        )}
      </div>
    </div>
  );
}

/**
 * How the Tal bot itself is actually playing, across every analysed bot
 * game — reuses the exact reporting already built for your own games
 * (phase breakdown, accuracy trend), just pointed at the bot's own moves.
 * A report, not a control: nothing here changes how the bot plays. Shown
 * on the Play Bot setup screen, where "how has it been doing" is the
 * natural question before starting another game.
 */
export function BotPerformancePanel() {
  const [performance, setPerformance] = useState<BotPerformance | null>(null);

  useEffect(() => {
    let active = true;
    getBotPerformance()
      .then((data) => {
        if (active) setPerformance(data);
      })
      .catch(() => {
        // Non-fatal — the panel just doesn't render.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!performance || performance.games === 0) return null;

  return (
    // A fragment, not a single wrapping panel: `AccuracyTrendChart` renders
    // its own `.panel` card (it's shared with the main dashboard, where it
    // sits at the top level), so nesting it inside this one would draw a
    // panel-in-a-panel. Rendered as a sibling instead, immediately after.
    <>
    <div className="panel bot-performance">
      <div className="library__header">
        <h3 className="library__title">Bot performance</h3>
        <span className="library__count">
          {performance.games} analysed game{performance.games === 1 ? '' : 's'}
        </span>
      </div>

      <div className="head-to-head__stats">
        <div className="head-to-head__stat">
          <div className="head-to-head__stat-value">
            {performance.wins}W {performance.losses}L {performance.draws}D
          </div>
          <div className="head-to-head__stat-label">record</div>
        </div>
        <div className="head-to-head__stat">
          <div
            className="head-to-head__stat-value"
            style={{ color: scoreColor(performance.score_pct) }}
          >
            {Math.round(performance.score_pct)}%
          </div>
          <div className="head-to-head__stat-label">score</div>
        </div>
        <div className="head-to-head__stat">
          <div className="head-to-head__stat-value">
            {performance.avg_accuracy !== null ? `${Math.round(performance.avg_accuracy)}%` : '—'}
          </div>
          <div className="head-to-head__stat-label">avg accuracy</div>
        </div>
      </div>

      <div className="bot-performance__classifications">
        {CLASSIFICATION_ORDER.map((classification) => {
          const count = performance.classification_counts[classification] ?? 0;
          const color = classificationColor(classification);
          return (
            <div key={classification} className="bot-performance__classification">
              <span
                className={`bot-performance__count${count === 0 ? ' bot-performance__count--zero' : ''}`}
              >
                {count}
              </span>
              <span className="bot-performance__icon" style={{ color }} aria-hidden="true">
                {classificationIcon(classification)}
              </span>
              <span className="bot-performance__label" style={{ color }}>
                {classificationLabel(classification)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="phase-breakdown__rows">
        {performance.phases.map((phase) => (
          <PhaseRow key={phase.phase} phase={phase} />
        ))}
      </div>
    </div>

    {performance.accuracy_trend.length > 0 && (
      <AccuracyTrendChart points={performance.accuracy_trend} />
    )}
    </>
  );
}
