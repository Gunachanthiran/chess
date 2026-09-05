import { useEffect, useState } from 'react';
import { getPhaseBreakdown } from '../../api/games';
import { classificationColor } from '../../styles/classification-colors';
import type { PhaseBreakdown, PhaseBreakdownList } from '../../types';

const PHASE_LABEL: Record<PhaseBreakdown['phase'], string> = {
  opening: 'Opening',
  middlegame: 'Middlegame',
  endgame: 'Endgame',
};

function errorRateColor(pct: number): string {
  if (pct <= 10) return '#96bc4b';
  if (pct <= 20) return '#f7c631';
  return '#ca3431';
}

function PhaseRow({ phase }: { phase: PhaseBreakdown }) {
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
 * "Where do your real errors actually happen" — every analysed move you've
 * played, bucketed by game phase (see `phase_stats.py`'s material-based
 * split) and coloured by classification, same best-effort contract as
 * `OpeningPerformancePanel`/`DashboardStats`.
 */
export function PhaseBreakdownPanel() {
  const [phases, setPhases] = useState<PhaseBreakdownList | null>(null);

  useEffect(() => {
    let active = true;
    getPhaseBreakdown()
      .then((data) => {
        if (active) setPhases(data);
      })
      .catch(() => {
        // Non-fatal — the panel just doesn't render.
      });
    return () => {
      active = false;
    };
  }, []);

  const totalMoves = phases?.reduce((sum, phase) => sum + phase.total_moves, 0) ?? 0;
  if (!phases || totalMoves === 0) return null;

  return (
    <div className="panel phase-breakdown">
      <div className="library__header">
        <h3 className="library__title">Where your errors happen</h3>
        <span className="library__count">by game phase</span>
      </div>

      <div className="phase-breakdown__rows">
        {phases.map((phase) => (
          <PhaseRow key={phase.phase} phase={phase} />
        ))}
      </div>
    </div>
  );
}
