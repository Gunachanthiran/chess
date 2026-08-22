import { classificationLabel } from '../styles/classification-colors';
import { mySide } from './gameDisplay';
import { detailForAnalysisMove } from './coach';
import type { Game, MoveAnalysis } from '../types';

/**
 * Rule-based "ask the coach a question" — deliberately not an LLM call. No
 * API key, no per-token cost, no network round trip: every answer is derived
 * from data the analysis pipeline already computed and that's already on
 * screen (`MoveAnalysis`, `Game`, accuracy). A small ordered list of
 * keyword/regex rules against the lowercased question; the first match wins.
 * When nothing matches, the fallback is honest about what it *can* answer
 * rather than fabricating a response to a question it didn't understand.
 */

export type QAContext = {
  /** The move currently on the board, or `null` at the starting position. */
  move: MoveAnalysis | null;
  moves: MoveAnalysis[];
  game: Game | null;
  accuracy: { white: number | null; black: number | null };
};

type Rule = {
  test: (question: string) => boolean;
  answer: (context: QAContext) => string;
};

const RULES: Rule[] = [
  {
    // "why did I blunder", "why was that a mistake"
    test: (q) => /\bwhy\b/.test(q) && /(blunder|mistake|bad|wrong|worse)/.test(q),
    answer: ({ move }) => {
      if (!move) return "Step to a move first and I'll walk you through it.";
      if (move.classification !== 'mistake' && move.classification !== 'blunder') {
        return `This one wasn't actually shaky — it graded as ${classificationLabel(move.classification).toLowerCase()}. Try stepping to a move flagged as a mistake or blunder and ask again.`;
      }
      return detailForAnalysisMove(move);
    },
  },
  {
    // "what was the best move", "should I have played something else"
    test: (q) => /(best move|should (i|you) have played|what.*better|what.*should)/.test(q),
    answer: ({ move }) => {
      if (!move) return "Step to a move first and I'll tell you the engine's pick there.";
      return detailForAnalysisMove(move);
    },
  },
  {
    // "how am I doing", "what's my accuracy"
    test: (q) => /(accuracy|how am i doing|how('m| am) i playing)/.test(q),
    answer: ({ game, accuracy }) => {
      const side = game ? mySide(game) : null;
      if (side && accuracy[side] !== null) {
        return `You're at ${Math.round(accuracy[side]!)}% accuracy for this game so far.`;
      }
      const w = accuracy.white !== null ? `${Math.round(accuracy.white)}%` : 'not available yet';
      const b = accuracy.black !== null ? `${Math.round(accuracy.black)}%` : 'not available yet';
      return `White's accuracy is ${w}, Black's is ${b}.`;
    },
  },
  {
    // "what opening is this", "what's this called"
    test: (q) => /(opening|what.*(this|it).*call)/.test(q),
    answer: ({ game }) => {
      if (!game?.opening_name) {
        return "No opening name on record for this game — might be an unusual line the database doesn't tag.";
      }
      return `You're in the ${game.eco ? `${game.eco} — ` : ''}${game.opening_name}.`;
    },
  },
  {
    // "who's winning", "winning chances"
    test: (q) => /(who.*(winning|ahead)|winning chances|who.*better)/.test(q),
    answer: ({ move }) => {
      if (!move) return "It's the start of the game — dead even, nobody's ahead yet.";
      const pct = Math.round(move.win_pct_after);
      const margin = Math.abs(pct - 50) * 2;
      if (margin < 10) return "It's roughly balanced right now — no real edge either way.";
      const leader = pct >= 50 ? 'White' : 'Black';
      const leaderPct = leader === 'White' ? pct : 100 - pct;
      return `${leader} is doing better here, holding around ${leaderPct}% winning chances.`;
    },
  },
];

const FALLBACK =
  "I can only answer from the numbers this analysis already has — try asking why a move graded the way it did, what the best move was, your accuracy, the opening, or who's ahead right now.";

export function answerCoachQuestion(question: string, context: QAContext): string {
  const q = question.trim().toLowerCase();
  if (!q) return FALLBACK;
  const rule = RULES.find((r) => r.test(q));
  return rule ? rule.answer(context) : FALLBACK;
}
