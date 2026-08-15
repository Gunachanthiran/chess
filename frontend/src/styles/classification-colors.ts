import type { Classification } from '../types';

/**
 * Move classification palette, matched to chess.com's review colours so the
 * move list reads the way players already expect.
 */
export const CLASSIFICATION_COLORS: Record<Classification, string> = {
  brilliant: '#1baaa6',
  best: '#96bc4b',
  excellent: '#96bc4b',
  good: '#95b776',
  book: '#a88865',
  inaccuracy: '#f7c631',
  mistake: '#e58f2a',
  blunder: '#ca3431',
  forced: '#97af8b',
};

/** Compact glyph rendered next to the SAN in the move list. */
export const CLASSIFICATION_ICONS: Record<Classification, string> = {
  brilliant: '!!',
  best: '★',
  excellent: '!',
  good: '✓',
  book: '▤',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
  forced: '→',
};

/** Human label used in tooltips and the detail strip under the board. */
export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  brilliant: 'Brilliant',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  forced: 'Forced',
};

/**
 * The backend contract is frozen, but a future classification value should
 * degrade to a neutral grey rather than crash the move list.
 */
const FALLBACK_COLOR = '#8a8f98';

export function classificationColor(classification: Classification): string {
  return CLASSIFICATION_COLORS[classification] ?? FALLBACK_COLOR;
}

export function classificationIcon(classification: Classification): string {
  return CLASSIFICATION_ICONS[classification] ?? '•';
}

export function classificationLabel(classification: Classification): string {
  return CLASSIFICATION_LABELS[classification] ?? classification;
}

/** Accuracy bands: >=90 green, 75-89 yellow, 60-74 orange, <60 red. */
export function accuracyColor(accuracy: number): string {
  if (accuracy >= 90) return '#96bc4b';
  if (accuracy >= 75) return '#f7c631';
  if (accuracy >= 60) return '#e58f2a';
  return '#ca3431';
}
