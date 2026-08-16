/**
 * Hand-rolled line icons (24x24, stroke=currentColor) for the sidebar nav and
 * stats widget — a small fixed set, not worth a whole icon-library dependency
 * for five glyphs that never change.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconDashboard(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.5" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.5" />
    </svg>
  );
}

export function IconAnalyze(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.2 15.2 20.5 20.5" />
      <path d="M8 10.5h5M10.5 8v5" />
    </svg>
  );
}

export function IconLibrary(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5v15l4-2 4 2 4-2 4 2v-15" />
      <path d="M4 4.5c1.2-1 2.8-1 4 0s2.8 1 4 0 2.8-1 4 0" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 5 8v3c0 5 3 8.5 7 9.5 4-1 7-4.5 7-9.5V8z" />
      <path d="M9.5 12 11 13.5 14.5 10" />
    </svg>
  );
}

export function IconPlayers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.2c2.3.3 4.3 2.4 4.3 5.8" />
    </svg>
  );
}

export function IconStreak(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.5c1.5 3 .5 4.7-1 6.3-1.7 1.9-2.5 3.6-2.5 5.5A5.5 5.5 0 0 0 14 20l.2-.02A4.5 4.5 0 0 0 17 15c1.6 1.2 2 2.7 2 4A6.5 6.5 0 0 1 6 19c0-3.5 1.6-5.6 3.3-7.6 1.5-1.8 2.2-3.4 1.7-5.4-.2-.9-.2-2.3 1-3.5Z" />
    </svg>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5L19.5 8.5" />
      <path d="M19.5 4.5v4.5H15" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.6 5.5L4.5 15.5" />
      <path d="M4.5 19.5V15H9" />
    </svg>
  );
}

export function IconGames(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 4.5 7v5c0 5 3 8 7.5 9.5C16.5 20 19.5 17 19.5 12V7Z" />
      <path d="M9 12h6M12 9v6" />
    </svg>
  );
}
