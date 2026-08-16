import { Chess } from 'chess.js';
import type { Classification, MoveAnalysis } from '../types';

/**
 * Template-based coaching commentary for the analysis page only — no LLM
 * call, no per-move Stockfish re-evaluation. Built entirely from data the
 * existing analysis pipeline already computed (`classification`,
 * `win_pct_before/after`, `best_move_uci`), so it costs nothing extra to
 * generate. Deliberately not offered during live bot games: grading the
 * player's move quality in real time would need its own Stockfish search per
 * move, and this app's free-tier host is already CPU-starved enough (see
 * `tal_bot.py`/`ANALYSIS_TIME_LIMIT_S`) that adding a second concurrent
 * engine workload to every move of a live game was never going to be
 * affordable there.
 *
 * Each tier has a few interchangeable lines rather than one fixed sentence,
 * picked deterministically from `ply` so revisiting the same move in the
 * analysis page always says the same thing (stable, not randomly different
 * on every click) while different moves in the same game still vary.
 */

function pick(lines: string[], seed: number): string {
  return lines[((seed % lines.length) + lines.length) % lines.length];
}

/** UCI (`e7e8q`) to SAN (`e8=Q`) for one move, given the position it's played from. */
function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
    const move = chess.move({ from, to, promotion });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

const BRILLIANT_LINES = [
  "Brilliant! {san} gives up material, but it's completely sound.",
  '{san} — a real sacrifice, and it works. Beautiful find.',
  "That's a brilliant shot: {san}.",
];

const GREAT_LINES = [
  'Great move — {san} was the one move that held this together.',
  'Sharp position, and {san} finds the only real path through it.',
  "{san} — exactly what this position demanded. Hard to find, well played.",
];

const BEST_LINES = [
  '{san} is the top engine choice.',
  'Right on the best line with {san}.',
  "{san}. Can't ask for more than that.",
];

const EXCELLENT_LINES = [
  '{san} is excellent — just a hair off the very best.',
  'Strong move — {san} barely gives anything away.',
  '{san}, nearly perfect.',
];

const GOOD_LINES = [
  '{san} is a solid, reasonable move.',
  'Steady choice with {san}.',
  '{san} keeps things on track.',
];

const BOOK_LINES = [
  'Still in book here — {san} follows known theory.',
  '{san} is well-trodden opening theory.',
  'Textbook so far: {san}.',
];

const INACCURACY_LINES = [
  '{san} is a slight inaccuracy.',
  'Not quite the sharpest — {san} loosens your grip a little.',
  'That gives back a touch of the advantage.',
];

const MISTAKE_LINES = [
  "{san} is a mistake — that's a real problem.",
  'That gives something real back. {san} was not the move here.',
  "That's a slip.",
];

const BLUNDER_LINES = [
  "{san} is a blunder — that's a serious problem.",
  'Ouch — that throws away a big chunk of the position.',
  "That's a serious error.",
];

const FORCED_LINES = [
  '{san} was forced — no real alternative existed.',
  'Only one legal try here: {san}.',
  '{san}, out of necessity.',
];

/**
 * A standalone trailing sentence naming the engine's actual recommendation —
 * the explicit "what would have been the best move" half of the commentary,
 * separate from the "what's wrong" half the tier's own template line covers.
 * '' when there is nothing to add (the move played *was* the engine's pick,
 * or the position/UCI didn't resolve to a SAN).
 */
function bestMoveSentence(move: MoveAnalysis): string {
  const bestSan =
    move.best_move_uci && move.best_move_uci !== move.uci
      ? uciToSan(move.fen_before, move.best_move_uci)
      : null;
  if (!bestSan) return '';
  const drop = Math.round(move.win_pct_before - move.win_pct_after);
  if (drop > 0) return ` The best move was ${bestSan}, keeping ${drop} more points of winning chances.`;
  return ` The best move was ${bestSan}.`;
}

const TEMPLATES: Record<Classification, string[]> = {
  brilliant: BRILLIANT_LINES,
  great: GREAT_LINES,
  best: BEST_LINES,
  excellent: EXCELLENT_LINES,
  good: GOOD_LINES,
  book: BOOK_LINES,
  inaccuracy: INACCURACY_LINES,
  mistake: MISTAKE_LINES,
  blunder: BLUNDER_LINES,
  forced: FORCED_LINES,
};

/** Tiers where the move actually gave something up — worth naming the alternative. */
const SUBOPTIMAL_TIERS = new Set<Classification>(['inaccuracy', 'mistake', 'blunder']);

/**
 * One coaching sentence for a single analysed move: the tier's own line
 * covers *what's wrong* (or what's notable), and for the tiers where
 * something genuinely was wrong, `bestMoveSentence` appends the explicit
 * *what would have been better* half. Skipped for the good-to-brilliant
 * tiers even when the engine's literal top pick differed by a fraction of a
 * point — "great move! ...but actually X was better" reads as contradicting
 * itself over a gap too small to matter.
 */
export function commentaryForAnalysisMove(move: MoveAnalysis): string {
  const template = pick(TEMPLATES[move.classification] ?? BEST_LINES, move.ply);
  const suffix = SUBOPTIMAL_TIERS.has(move.classification) ? bestMoveSentence(move) : '';
  return template.replace('{san}', move.san) + suffix;
}
