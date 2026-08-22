import { Chess } from 'chess.js';
import type { Classification, MoveAnalysis, Side } from '../types';

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
 * Voice: hyped, slangy chess-YouTuber energy — "chat", "brilliant", "book
 * move", overreacting to blunders — a personal, self-hosted homage to that
 * style of commentary rather than any specific person's actual words, and
 * not affiliated with or endorsed by anyone it evokes.
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
  "{san}?! Chat, that is ABSOLUTE FILTH. We do not deserve this move.",
  "Okay {san} is disgusting — in the best way. This is why I love this game.",
  "STOP. {san}. That's not just brilliant, that's a certified banger. Screenshot this one.",
  "{san}!! Everybody watching needs to understand how good that is. We are so back.",
];

const GREAT_LINES = [
  "{san} — that's rook-lift energy right there. Beautiful, beautiful stuff.",
  "Chat, {san} is exactly the kind of move that separates good players from great ones.",
  "{san}?! Okay, I see you. Objectively one of the better moves on this board.",
  "That's clean. {san}. Textbook — but the good kind of textbook.",
];

const BEST_LINES = [
  '{san} — the engine is happy, I am happy. Book move energy.',
  'Straight-up the best move on the board. {san}. Keep it going.',
  "{san}. Can't ask for more than that, chat.",
];

const EXCELLENT_LINES = [
  '{san} is excellent — a hair off perfect, but nobody is counting.',
  'Strong stuff. {san} barely gives the engine anything to smile about.',
  '{san}. Top-tier human move right there.',
];

const GOOD_LINES = [
  '{san} — solid. Not flashy, just solid. Respect it.',
  'Steady as she goes with {san}.',
  '{san} keeps the position under control. Nothing crazy, nothing bad.',
];

const BOOK_LINES = [
  'Still book here. {san} — theory as old as time.',
  '{san}. Straight out of the database, nothing to see yet.',
  "Yep, {san} is well-known theory. Chat's seen this a thousand times.",
];

const INACCURACY_LINES = [
  '{san} — eh. A little loose. Not the end of the world though.',
  "That's an inaccuracy. {san} gives back a touch of the advantage.",
  'Not the sharpest tool in the shed, but {san} is survivable.',
];

const MISTAKE_LINES = [
  "{san}?? Chat... we do not do that. We simply do not.",
  "Oh, {san}. I've seen this movie before and it never ends well.",
  "That's a real mistake. {san} — objectively not the move.",
  'And there goes some of that advantage. {san}. Painful to watch.',
];

const BLUNDER_LINES = [
  '{san}?!?! NO NO NO NO NO. What was that.',
  "Chat, {san} just happened and I need a minute. It's so over.",
  '{san} — somewhere, a grandmaster just felt a disturbance.',
  'And... it\'s over. {san} basically hands the game away. We love to see it. (We do not.)',
];

const FORCED_LINES = [
  '{san} was forced, chat — no real choice here.',
  'Only one move that does not lose on the spot: {san}.',
  '{san}, out of pure necessity. Nothing else works.',
];

/** {@link commentaryForAnalysisMove}'s flourish for a rook move landing in the
 * brilliant/great tier — a nod to how often "the rook lift" gets talked up as
 * the fancy, underrated maneuver in hyped chess commentary. */
const ROOK_LINES = [
  '{san} — chat, THE ROOK LIFT. My favorite move in chess, no contest.',
  'Rook takes the stage. {san}. This is the move I bring up in every single video.',
  'Say it with me: the rook lift. {san}. Criminally underrated.',
  'There it is — {san}, a rook doing rook things. Chef\'s kiss.',
];

/** First letter of a SAN move's piece (`P` for pawn moves, `K` for castling). */
function pieceOf(san: string): string {
  if (san.startsWith('O-O')) return 'K';
  return /^[KQRBN]/.exec(san)?.[0] ?? 'P';
}

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


/** A few interchangeable ways to say "nothing worth interrupting for here" —
 * picked deterministically from `ply` (see the module docstring above), so
 * the routine stretches of a game don't all show the exact same sentence. */
const QUIET_LINES = [
  "Nothing to flag here, chat — keeping quiet through the routine moves.",
  "Nice and steady. Saving my reactions for when they actually mean something.",
  "All good — I'll pipe up the moment something's worth stopping for.",
  'Business as usual. Onward.',
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
export const NOTABLE_CLASSIFICATIONS: Classification[] = ['brilliant', 'great', 'mistake', 'blunder'];
const NOTABLE_TIERS = new Set<Classification>(NOTABLE_CLASSIFICATIONS);

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
const ROOK_FLOURISH_TIERS = new Set<Classification>(['brilliant', 'great']);

/** The line pool `commentaryForAnalysisMove`/`buildGameNarrative` both pick
 * from for one move — factored out so the two stay in sync on the
 * rook-flourish special case rather than duplicating it. A user-authored
 * `customLine` (see `lib/coachProfile.ts`) short-circuits to a single-element
 * pool: no variety needed for a line the user wrote themselves, and `pick`/
 * `pickAvoiding` degenerately always return it. */
function templatesForMove(move: MoveAnalysis, customLine?: string): string[] {
  if (customLine) return [customLine];
  const isRookFlourish = ROOK_FLOURISH_TIERS.has(move.classification) && pieceOf(move.san) === 'R';
  return isRookFlourish ? ROOK_LINES : (TEMPLATES[move.classification] ?? BEST_LINES);
}

export function commentaryForAnalysisMove(move: MoveAnalysis, customLine?: string): string {
  const template = pick(templatesForMove(move, customLine), move.ply);
  const suffix = SUBOPTIMAL_TIERS.has(move.classification) ? bestMoveSentence(move) : '';
  return template.replace('{san}', naturalizeSan(move.san)) + suffix;
}

/**
 * The "Explain" button's longer read on a move: the win% swing in plain
 * terms, plus the engine's actual alternative when there was a better one
 * (reusing `bestMoveSentence`, which already no-ops when the move played
 * *was* the engine's own pick). Unlike `commentaryForAnalysisMove` this
 * isn't gated to the suboptimal tiers — a brilliant or great move still gets
 * a real "here's the swing" line, just without a "the best move was..."
 * clause it doesn't need.
 */
export function detailForAnalysisMove(move: MoveAnalysis): string {
  const swing = Math.round(move.win_pct_before - move.win_pct_after);
  const swingLine =
    swing > 0
      ? `Gave up about ${swing} percentage point${swing === 1 ? '' : 's'} of winning chances.`
      : swing < 0
        ? `Actually gained winning chances — up about ${-swing} percentage point${swing === -1 ? '' : 's'}.`
        : "No change in winning chances — right on the engine's own line.";
  const best = bestMoveSentence(move);
  return best ? `${swingLine}${best}` : swingLine;
}

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** A cheap phase estimate from data already on `MoveAnalysis` — no chess.js
 * board needed, just the move number plus a piece count off `fen_before`'s
 * own placement field. Good enough for "is this early enough to still
 * mention the opening name" / "few enough pieces left to call this an
 * endgame", not a rigorous phase detector. */
export function gamePhase(move: MoveAnalysis): GamePhase {
  const pieceField = move.fen_before.split(' ')[0];
  const pieceCount = (pieceField.match(/[kqrbnp]/gi) ?? []).length;
  if (move.move_number <= 10) return 'opening';
  if (move.move_number >= 30 || pieceCount <= 12) return 'endgame';
  return 'middlegame';
}

/** Like `pick`, but re-rolls once (to the next line, wrapping) when the
 * deterministic seed would repeat whatever line index was used last time for
 * this tier — avoids two notable moves in a row reading the exact same
 * template. No-ops (keeps the seeded pick) when there's only one line to
 * choose from. */
function pickAvoiding(
  lines: string[],
  seed: number,
  avoidIndex: number | undefined,
): { text: string; index: number } {
  const primary = ((seed % lines.length) + lines.length) % lines.length;
  const index = lines.length > 1 && primary === avoidIndex ? (primary + 1) % lines.length : primary;
  return { text: lines[index], index };
}

function capitalizeSide(side: Side): string {
  return side === 'white' ? 'White' : 'Black';
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export type NarrativeContext = {
  game: { opening_name: string | null; eco: string | null } | null;
  accuracy: { white: number | null; black: number | null };
  /** User-authored replacement lines per tier (see `lib/coachProfile.ts`) —
   * absent/empty behaves exactly as before this existed. */
  customLines?: Partial<Record<Classification, string>>;
};

/**
 * One deterministic pass over the whole game (ply order), producing enriched
 * commentary for every NOTABLE move (same set `isNotableMove` already
 * defines) — non-notable plies are simply absent from the returned map, and
 * callers keep falling back to `quietCoachLine`/`commentaryForAnalysisMove`
 * as before. All "memory" (last template index per tier, per-side streaks,
 * whether the opening's been mentioned yet) is a local variable scoped to
 * this one call — never module state — so a single upfront pass keyed purely
 * on ply order stays stable regardless of how the user actually navigates
 * (notable-move nav, arrow keys, and the move list can all jump around
 * non-linearly; a ref incremented during navigation would not).
 */
export function buildGameNarrative(moves: MoveAnalysis[], context: NarrativeContext): Map<string, string> {
  const result = new Map<string, string>();
  const lastTemplateIndexByTier: Partial<Record<Classification, number>> = {};
  const sideStreak: Record<Side, { tier: Classification | null; count: number }> = {
    white: { tier: null, count: 0 },
    black: { tier: null, count: 0 },
  };
  let openingMentioned = false;

  const notableIndices: number[] = [];
  moves.forEach((move, index) => {
    if (isNotableMove(move.classification)) notableIndices.push(index);
  });
  const lastNotableIndex = notableIndices.length > 0 ? notableIndices[notableIndices.length - 1] : -1;

  moves.forEach((move, index) => {
    if (!isNotableMove(move.classification)) return;

    const { text: template, index: usedIndex } = pickAvoiding(
      templatesForMove(move, context.customLines?.[move.classification]),
      move.ply,
      lastTemplateIndexByTier[move.classification],
    );
    lastTemplateIndexByTier[move.classification] = usedIndex;

    let text = template.replace('{san}', naturalizeSan(move.san));
    if (SUBOPTIMAL_TIERS.has(move.classification)) text += bestMoveSentence(move);

    const streak = sideStreak[move.side];
    if (streak.tier === move.classification) {
      streak.count += 1;
    } else {
      streak.tier = move.classification;
      streak.count = 1;
    }
    if (streak.count >= 2 && (move.classification === 'blunder' || move.classification === 'mistake')) {
      text += ` That's ${capitalizeSide(move.side)}'s ${ordinal(streak.count)} ${move.classification} in a row.`;
    }
    if (streak.count >= 2 && (move.classification === 'brilliant' || move.classification === 'great')) {
      text += ` ${capitalizeSide(move.side)} is on fire — back-to-back ${move.classification} moves.`;
    }

    if (!openingMentioned && gamePhase(move) === 'opening' && context.game?.opening_name) {
      const ecoPrefix = context.game.eco ? `${context.game.eco} — ` : '';
      text += ` And this is happening in the ${ecoPrefix}${context.game.opening_name}.`;
      openingMentioned = true;
    }

    if (index === lastNotableIndex) {
      const acc = context.accuracy[move.side];
      if (acc !== null) {
        text += ` Final ${capitalizeSide(move.side).toLowerCase()} accuracy for the game: ${Math.round(acc)}%.`;
      }
    }

    result.set(move.id, text);
  });

  return result;
}
