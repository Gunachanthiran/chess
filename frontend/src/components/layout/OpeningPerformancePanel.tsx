import { useEffect, useState } from 'react';
import { getOpeningPerformance } from '../../api/games';
import { accuracyColor } from '../../styles/classification-colors';
import type { OpeningPerformanceList } from '../../types';

/** How many rows to show before truncating — the dashboard is an overview,
 * not the full report; a very active account can have 50+ distinct opening
 * names (see opening_stats.py), which would otherwise dwarf every other
 * panel on the page. */
const MAX_ROWS = 8;

function scoreColor(scorePct: number): string {
  if (scorePct >= 60) return '#96bc4b';
  if (scorePct >= 45) return '#f7c631';
  return '#ca3431';
}

/**
 * "Which openings should I stop playing" — every analysed game grouped by
 * opening name, sorted by how often it's actually been played (see
 * `opening_stats.compute_opening_performance`). Same best-effort, degrade-
 * to-nothing contract as `DashboardStats`: a personal analysis tool with no
 * games yet, or a backend hiccup, should never show a broken panel.
 */
export function OpeningPerformancePanel() {
  const [openings, setOpenings] = useState<OpeningPerformanceList | null>(null);

  useEffect(() => {
    let active = true;
    getOpeningPerformance()
      .then((data) => {
        if (active) setOpenings(data);
      })
      .catch(() => {
        // Non-fatal — the panel just doesn't render.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!openings || openings.length === 0) return null;

  const rows = openings.slice(0, MAX_ROWS);

  return (
    <div className="panel opening-performance">
      <div className="library__header">
        <h3 className="library__title">Opening performance</h3>
        <span className="library__count">
          {openings.length} opening{openings.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="library__table-wrap">
        <table className="library__table">
          <thead>
            <tr>
              <th>Opening</th>
              <th>Record</th>
              <th>Score</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((opening) => (
              <tr key={opening.opening_name}>
                <td>
                  <div className="library__matchup">{opening.opening_name}</div>
                  {opening.eco && <span className="library__count">{opening.eco}</span>}
                </td>
                <td>
                  {opening.wins}W {opening.losses}L {opening.draws}D
                </td>
                <td style={{ color: scoreColor(opening.score_pct), fontWeight: 700 }}>
                  {Math.round(opening.score_pct)}%
                </td>
                <td>
                  {opening.avg_accuracy !== null ? (
                    <span style={{ color: accuracyColor(opening.avg_accuracy), fontWeight: 600 }}>
                      {Math.round(opening.avg_accuracy)}%
                    </span>
                  ) : (
                    <span className="library__count">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
