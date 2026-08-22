import type { ReactElement } from 'react';
import type { Classification } from '../../types';

/**
 * The coach's face — an original illustrated rook character, not a photo or
 * likeness of any real person. One shared body (echoing the ♜ glyph this
 * panel used before this component existed, so it reads as "the same piece,
 * now illustrated") plus a small swappable face fragment per move-quality
 * tier, rather than ten separate full illustrations.
 *
 * `className` forwards straight onto the `<svg>` root so the panel's own
 * `coach__avatar`/`coach__avatar--hype`/`coach__avatar--yikes` classes keep
 * animating this element's `transform` exactly as they animated the emoji
 * span this replaced.
 */
export type CoachMascotProps = {
  /** `null`/`undefined` renders the idle face (no verdict yet). */
  classification?: Classification | null;
  className?: string;
};

const FACES: Record<Classification | 'idle', ReactElement> = {
  idle: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <circle cx={28} cy={38} r={1.4} fill="var(--accent-contrast)" stroke="none" />
      <circle cx={36} cy={38} r={1.4} fill="var(--accent-contrast)" stroke="none" />
      <path d="M28 43 Q32 44.5 36 43" />
    </g>
  ),
  brilliant: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <circle cx={28} cy={37} r={2.6} />
      <circle cx={36} cy={37} r={2.6} />
      <ellipse cx={32} cy={43.5} rx={3} ry={2.4} fill="var(--accent-contrast)" stroke="none" />
      <path d="M20 20 L21.5 23 L23 20 L21.5 17 Z" fill="var(--accent-contrast)" stroke="none" />
      <path d="M42 19 L43.2 21.5 L44.4 19 L43.2 16.5 Z" fill="var(--accent-contrast)" stroke="none" />
    </g>
  ),
  great: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.6} strokeLinecap="round" fill="none">
      <path d="M25.5 38 Q28 35.5 30.5 38" />
      <path d="M33.5 38 Q36 35.5 38.5 38" />
      <path d="M27 41 Q32 45.5 37 41" />
      <path d="M42 19 L43.2 21.5 L44.4 19 L43.2 16.5 Z" fill="var(--accent-contrast)" stroke="none" />
    </g>
  ),
  best: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <path d="M25.5 38 Q28 36.3 30.5 38" />
      <path d="M33.5 38 Q36 36.3 38.5 38" />
      <path d="M28 42.5 Q32 44.5 36 42.5" />
    </g>
  ),
  excellent: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <path d="M25.5 38 Q28 36.5 30.5 38" />
      <path d="M33.5 38 Q36 36.5 38.5 38" />
      <path d="M29 42.5 Q32 43.8 35 42.5" />
    </g>
  ),
  good: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <circle cx={28} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <circle cx={36} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <path d="M28.5 43 Q32 44 35.5 43" />
    </g>
  ),
  book: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.4} strokeLinecap="round" fill="none">
      <path d="M25.5 35.5 L30.5 35.5" />
      <path d="M33.5 35.5 L38.5 35.5" />
      <circle cx={28} cy={38.5} r={1.2} fill="var(--accent-contrast)" stroke="none" />
      <circle cx={36} cy={38.5} r={1.2} fill="var(--accent-contrast)" stroke="none" />
      <path d="M28.5 43 L35.5 43" />
    </g>
  ),
  inaccuracy: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <path d="M25.5 35.5 Q28 34 30.5 35.5" />
      <circle cx={28} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <circle cx={36} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <path d="M28 43 Q32 42.2 36 43.4" />
    </g>
  ),
  mistake: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <circle cx={28} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <circle cx={36} cy={38} r={1.3} fill="var(--accent-contrast)" stroke="none" />
      <path d="M28 44 Q32 41.5 36 44" />
    </g>
  ),
  blunder: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.6} strokeLinecap="round" fill="none">
      <path d="M26 36 L30 40 M30 36 L26 40" />
      <path d="M34 36 L38 40 M38 36 L34 40" />
      <path d="M27 45 Q29.5 42.5 32 45 Q34.5 47.5 37 45" />
      <path d="M39 40 Q40.5 42 39.5 44.5 Q38.5 46 40 46.5 Z" fill="var(--accent-contrast)" stroke="none" />
    </g>
  ),
  forced: (
    <g stroke="var(--accent-contrast)" strokeWidth={1.5} strokeLinecap="round" fill="none">
      <path d="M25.5 38 L30.5 38" />
      <path d="M33.5 38 L38.5 38" />
      <path d="M28.5 43 L35.5 43" />
    </g>
  ),
};

export function CoachMascot({ classification, className }: CoachMascotProps) {
  const face = FACES[classification ?? 'idle'];
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="coach-mascot-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent-soft)' }} />
        </linearGradient>
      </defs>
      {/* Rook silhouette: foot, shaft, three crenellations — deliberately
          simple, so the swappable face below reads clearly against it. */}
      <g
        fill="url(#coach-mascot-body)"
        stroke="var(--accent-strong)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      >
        <path d="M18 56 L20 46 L44 46 L46 56 Z" />
        <rect x={21} y={30} width={22} height={18} rx={3} />
        <rect x={19} y={16} width={7} height={16} rx={1.5} />
        <rect x={28.5} y={16} width={7} height={16} rx={1.5} />
        <rect x={38} y={16} width={7} height={16} rx={1.5} />
      </g>
      {face}
    </svg>
  );
}
