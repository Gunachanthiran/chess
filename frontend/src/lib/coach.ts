import { Chess } from 'chess.js';
import type { Classification, MoveAnalysis } from '../types';

/**
 * Template-based coaching commentary — no LLM call, no per-move Stockfish
 * re-evaluation. Analysis-page commentary is built entirely from data the
 * existing analysis pipeline already computed (`classification`,
 * `win_pct_before/after`, `best_move_uci`); play-mode commentary is built
 * from the SAN string alone (capture/check/castle/promotion/mate), the same
 * facts `useSoundEffects` already reads to pick a sound. Neither path adds a
 * single extra engine call — this app's free-tier host is CPU-starved enough
 * already (see `tal_bot.py`/`ANALYSIS_TIME_LIMIT_S`) that a coach voice
 * grading the player's move live, in real time, during a bot game was never
 * going to be affordable there.
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
  '{san} is a slight inaccuracy{bestClause}.',
  'Not quite the sharpest{bestClause} — {san} loosens your grip a little.',
  "{san} gives back a touch of the advantage{bestClause}.",
];

const MISTAKE_LINES = [
  '{san} is a mistake{bestClause}.',
  'That gives something real back{bestClause} — {san} was not the move.',
  '{san} slips{bestClause}.',
];

const BLUNDER_LINES = [
  '{san} is a blunder{bestClause}!',
  'Ouch — {san} throws away a big chunk of the position{bestClause}.',
  "That's a serious error{bestClause}: {san}.",
];

const FORCED_LINES = [
  '{san} was forced — no real alternative existed.',
  'Only one legal try here: {san}.',
  '{san}, out of necessity.',
];

/** Formats a win%-drop as a short spoken clause, or '' when there's nothing to add. */
function bestClause(move: MoveAnalysis): string {
  const bestSan =
    move.best_move_uci && move.best_move_uci !== move.uci
      ? uciToSan(move.fen_before, move.best_move_uci)
      : null;
  const drop = Math.round(move.win_pct_before - move.win_pct_after);
  if (bestSan && drop > 0) return `; ${bestSan} kept ${drop} more points of winning chances`;
  if (bestSan) return `; ${bestSan} was the engine's pick`;
  return '';
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

/** One coaching sentence for a single analysed move — the "why" behind its classification. */
export function commentaryForAnalysisMove(move: MoveAnalysis): string {
  const template = pick(TEMPLATES[move.classification] ?? BEST_LINES, move.ply);
  return template.replace('{san}', move.san).replace('{bestClause}', bestClause(move));
}

// --- Play mode: SAN-fact commentary, no engine call ------------------------

const PLAYER_CAPTURE = ['Nice, that wins some material.', 'Good trade there.', 'That grabs a piece.'];
const PLAYER_CHECK = ['Check! Keep the pressure on.', 'Good — check keeps the king honest.'];
const PLAYER_CASTLE = ["Castled — your king's tucked away safely now.", 'Good, your king is safer now.'];
const PLAYER_PROMOTE = ['Promotion! A brand new piece joins the fight.', 'That pawn just became a whole new problem for the bot.'];
const PLAYER_MATE = ['Checkmate! That is the game.', 'Checkmate — well played.'];

const BOT_CAPTURE = ['Tal bot pounces with {san}.', 'The bot grabs material: {san}.'];
const BOT_CHECK = ['Tal bot brings the king into it — check.', 'Check from the bot with {san}.'];
const BOT_CASTLE = ["The bot tucks its king away with {san}.", 'Tal bot castles.'];
const BOT_PROMOTE = ['The bot promotes — {san}.', 'A new piece for the bot: {san}.'];
const BOT_MATE = ['Checkmate — the bot gets there first.', 'That is checkmate. Tough one.'];

/**
 * A short remark for one just-played move in a live bot game, or `null` for
 * a quiet move that is not worth interrupting play to narrate — the coach
 * speaks up for notable events, not every single move.
 */
export function commentaryForPlayMove(san: string, isBotMove: boolean, ply: number): string | null {
  const filled = (lines: string[]) => pick(lines, ply).replace('{san}', san);

  if (san.includes('#')) return filled(isBotMove ? BOT_MATE : PLAYER_MATE);
  if (san.includes('+')) return filled(isBotMove ? BOT_CHECK : PLAYER_CHECK);
  if (san.startsWith('O-O')) return filled(isBotMove ? BOT_CASTLE : PLAYER_CASTLE);
  if (san.includes('=')) return filled(isBotMove ? BOT_PROMOTE : PLAYER_PROMOTE);
  if (san.includes('x')) return filled(isBotMove ? BOT_CAPTURE : PLAYER_CAPTURE);
  return null;
}
