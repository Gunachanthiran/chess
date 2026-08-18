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

const PIECE_NAMES: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

/**
 * SAN (`Nd3`, `Qxf7+`, `e8=Q`, `O-O`) to plain spoken English (`Knight on
 * d3`, `Queen takes on f7, check`, `Pawn on e8 promoting to Queen`, `Castles
 * kingside`) — coordinate algebraic notation reads fine on a screen but is
 * exactly the kind of thing that sounds like noise spoken aloud, and is no
 * clearer written out in a comment either. SAN self-encodes everything this
 * needs (piece letter, capture, destination, promotion, check/mate) without
 * requiring the board position, so this is a pure string transform.
 */
export function naturalizeSan(san: string): string {
  if (san.startsWith('O-O-O')) return `Castles queenside${checkSuffix(san)}`;
  if (san.startsWith('O-O')) return `Castles kingside${checkSuffix(san)}`;

  const body = san.replace(/[+#]$/, '');
  const promotionMatch = body.match(/=([QRBN])$/);
  const promotion = promotionMatch ? ` promoting to ${PIECE_NAMES[promotionMatch[1]]}` : '';
  const withoutPromotion = promotionMatch ? body.slice(0, -promotionMatch[0].length) : body;

  const pieceLetter = /^[KQRBN]/.exec(withoutPromotion)?.[0];
  const pieceName = pieceLetter ? PIECE_NAMES[pieceLetter] : 'Pawn';

  const destMatch = /[a-h][1-8]$/.exec(withoutPromotion);
  const dest = destMatch ? destMatch[0] : withoutPromotion;
  const verb = withoutPromotion.includes('x') ? 'takes on' : 'on';

  return `${pieceName} ${verb} ${dest}${promotion}${checkSuffix(san)}`;
}

function checkSuffix(san: string): string {
  if (san.endsWith('#')) return ', checkmate';
  if (san.endsWith('+')) return ', check';
  return '';
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
  "!!! {san} — I did NOT see that coming. Somebody get this player a trophy.",
  "Ho ho ho. {san}?! That's not just good, that's borderline unfair.",
  "{san}. I need a minute. Genuinely gorgeous — chills.",
  "STOP EVERYTHING. {san} just happened and it's completely sound. Bravo.",
];

const GREAT_LINES = [
  '{san} — the one move that saves this, and you found it. I have chills.',
  'Everyone else misses {san} here. You did not. Take a bow.',
  "Sharp position, sharper mind. {san} was the only door out, and you walked right through it.",
  "{san}?! In THIS position?! Okay, I see you.",
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
  "{san}?? Buddy. Bud. We talked about this.",
  "I'm going to pretend I did not just watch {san} happen.",
  '{san} — bold choice. Wrong, but bold.',
  'And there it goes — some of that advantage, waving goodbye after {san}.',
];

const BLUNDER_LINES = [
  "{san}?!?! Okay. Okay. I need to sit down for a second.",
  'Oh no. Oh NO. {san} just happened and I am not okay.',
  "{san} — somewhere, a chess engine is laughing at us right now.",
  'And... that was the game. {san} just handed it over on a silver platter.',
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
  const bestPhrase = naturalizeSan(bestSan);
  const drop = Math.round(move.win_pct_before - move.win_pct_after);
  if (drop > 0) return ` The best move was ${bestPhrase}, keeping ${drop} more points of winning chances.`;
  return ` The best move was ${bestPhrase}.`;
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

/**
 * The coach's face for one move, dramatic swings for the tiers worth
 * reacting to (see `isNotableMove` below), calmer for the rest — plain
 * Unicode emoji only, no ZWJ sequences, for the same reason the figurine
 * glyphs elsewhere in this panel got an explicit font fallback: coverage for
 * anything fancier isn't guaranteed everywhere this renders.
 */
const COACH_EXPRESSIONS: Record<Classification, string> = {
  brilliant: '🤯',
  great: '🔥',
  best: '😌',
  excellent: '🙂',
  good: '🙂',
  book: '📖',
  inaccuracy: '😬',
  mistake: '😅',
  blunder: '😱',
  forced: '🙃',
};

/** Shown before any move has been played yet — no verdict to react to. */
export const COACH_IDLE_EXPRESSION = '🐴';

export function coachExpression(classification: Classification): string {
  return COACH_EXPRESSIONS[classification] ?? COACH_IDLE_EXPRESSION;
}

/** A few interchangeable ways to say "nothing worth interrupting for here" —
 * picked deterministically from `ply` (see the module docstring above), so
 * the routine stretches of a game don't all show the exact same sentence. */
const QUIET_LINES = [
  "Nothing to flag here — keeping quiet through the routine moves.",
  "Nice and steady. Saving my reactions for when they actually mean something.",
  "All good — I'll pipe up the moment something's worth stopping for.",
  "Business as usual. Carry on.",
];

export function quietCoachLine(ply: number): string {
  return pick(QUIET_LINES, ply);
}

/** Tiers where the move actually gave something up — worth naming the alternative. */
const SUBOPTIMAL_TIERS = new Set<Classification>(['inaccuracy', 'mistake', 'blunder']);

/**
 * Tiers worth the coach interrupting for. Routine moves (book/good/best/
 * excellent/inaccuracy/forced) happen on nearly every ply — narrating each
 * one is noise, not coaching. Only the moves a human commentator would
 * actually stop for get a line.
 */
const NOTABLE_TIERS = new Set<Classification>(['brilliant', 'great', 'mistake', 'blunder']);

export function isNotableMove(classification: Classification): boolean {
  return NOTABLE_TIERS.has(classification);
}

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
  return template.replace('{san}', naturalizeSan(move.san)) + suffix;
}
