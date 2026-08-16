/**
 * Shimmering placeholders shown while data is in flight, instead of a plain
 * "Loading…" string — shaped like the content they stand in for so the page
 * doesn't visibly jump once the real data lands.
 */

type SkeletonLineProps = {
  width?: string;
  height?: string;
};

export function SkeletonLine({ width, height }: SkeletonLineProps) {
  return (
    <span
      className="skeleton skeleton--line"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** One placeholder card, shaped like `.dashboard-card`. */
function DashboardCardSkeleton() {
  return (
    <div className="panel dashboard-card dashboard-card--skeleton" aria-hidden="true">
      <div className="dashboard-card__head">
        <SkeletonLine width="38%" />
        <span className="skeleton skeleton--pill" />
      </div>
      <div className="dashboard-card__players">
        <SkeletonLine width="72%" />
        <SkeletonLine width="54%" />
      </div>
      <SkeletonLine width="42%" height="0.78em" />
    </div>
  );
}

export function DashboardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="dashboard__grid" aria-busy="true" aria-label="Loading games">
      {Array.from({ length: count }, (_, index) => (
        <DashboardCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function LibraryRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <tbody aria-busy="true" aria-label="Loading games">
      {Array.from({ length: count }, (_, index) => (
        <tr key={index} className="library__row--skeleton" aria-hidden="true">
          <td>
            <SkeletonLine width="80%" />
          </td>
          <td className="library__result">
            <SkeletonLine width="60%" />
          </td>
          <td className="library__accuracy">
            <SkeletonLine width="42px" height="1.4em" />
          </td>
          <td className="library__date">
            <SkeletonLine width="70%" />
          </td>
          <td className="library__opening">
            <SkeletonLine width="85%" />
          </td>
          <td className="library__col-action">
            <SkeletonLine width="60px" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** Generic stand-in for a panel that's still loading — a title bar plus a
 * few body lines of decreasing width, used anywhere a bespoke skeleton isn't
 * worth building for a state that's on screen only briefly. */
export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="panel skeleton-panel" aria-busy="true" aria-label="Loading">
      <SkeletonLine width="45%" height="1.1em" />
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonLine key={index} width={`${88 - index * 14}%`} />
      ))}
    </div>
  );
}
