"""Tal-style bot move selection.

Two independent knobs, applied strictly in this order:

1. **Strength** is capped first, by opening `StockfishEngine(elo=...)`. That
   sets `UCI_LimitStrength`/`UCI_Elo` *and* - crucially - a matching node
   budget, because the UCI options alone do not weaken the multipv output this
   module reads (see `engine_pool.nodes_for_elo`). Every number here therefore
   comes out of an already-weakened search, so the personality bias can never
   smuggle in full-strength insight.
2. **Personality** is then applied by re-ranking that weakened engine's own
   candidate pool towards sacrifices, exposed enemy kings and sharp positions,
   within a modest centipawn tolerance of *its own* best move.

Keeping those in order is what makes the bot beatable: a 1400-rated bot picks
among 1400-rated moves, and aggression only ever reshuffles that short list.

One tier opts out of step 1 on purpose: `GRANDMASTER_ELO` runs unrestricted
Stockfish. It is now the **default** tier, because a genuinely weaker bot has to
blunder sometimes - that is the mechanism that makes it beatable - and a
blunder-free opponent is what this product is actually for. Every elo below it
is unchanged and remains available as explicit practice mode.

A third, smaller knob sits after both: candidates that would repeat a position
for the third time are filtered out of the pool when an alternative of
comparable strength exists (see `_prefer_non_repeating`), so the bot stops
drifting into draws by shuffling.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import chess

from app.errors import EngineError
from app.services import gambit_strategy
from app.services.classification import PIECE_VALUES, material_balance
from app.services.engine_pool import CandidateMove, StockfishEngine
from app.services.gambit_strategy import StrategyContext

# --- Tunables --------------------------------------------------------------

# Search depth for the bot's candidate pool. Deliberately shallower than the
# analysis pipeline's depth: the bot is elo-capped anyway, and this runs inside
# a synchronous HTTP request.
BOT_SEARCH_DEPTH = 12

# --- Grandmaster tier ------------------------------------------------------
#
# One explicitly-labelled tier that is *not* practice mode: full-strength,
# unrestricted Stockfish. Stockfish's own UCI_Elo mechanism stops at
# engine_pool.MAX_UCI_ELO (3190) by design, so "stronger than 3500" cannot be
# requested through it at all - the only way to get there is to stop limiting
# the engine. `StockfishEngine(elo=None)` does exactly that: no `configure()`
# call and no node budget, i.e. the same untouched engine the analysis
# pipeline uses, which is 3600+ strength in practice.
#
# GRANDMASTER_ELO is a sentinel, not a rating Stockfish is asked for. It sits
# above MAX_UCI_ELO so it can never collide with a real tunable value: every
# elo below it keeps the existing elo-capped, node-budgeted, beatable path.
GRANDMASTER_ELO = 3600

# Deeper than BOT_SEARCH_DEPTH: a maximum-strength tier should genuinely search
# deep. Slower moves are the accepted tradeoff here - this tier exists for a
# serious opponent, not speed.
#
# Raised from 18 because 18 had quietly become the *binding* limit rather than a
# safety net. Measured on this machine after the multi-threaded `engine_pool`
# configuration landed: a depth-18 multipv-6 search now completes in 2.4-6.2s,
# so the 20s budget below went almost entirely unspent and the tier was
# thinking for a third of its allowance. At 26 the wall-clock bound is what
# actually stops the search in every middlegame position tested, which is the
# intended shape: *time* is the budget, depth is the ceiling it works towards.
# Measured depths reached inside 20s: 22-26 in middlegames (vs. 18 before), and
# quiet endgames still finish early rather than burning the full budget.
#
# 28 was measured too and came out slightly *worse* in middlegames - a ceiling
# the search cannot approach costs more in time-management overhead than it
# returns - so this is a measured optimum, not a "bigger is better" guess.
GRANDMASTER_SEARCH_DEPTH = 26

# The candidate search's default wall-clock ceiling (1.5s) is tuned for the
# practice tiers and would cut a depth-18 search off long before it finished,
# quietly making GRANDMASTER_SEARCH_DEPTH decorative. This tier gets a longer
# leash; it still bounds the synchronous HTTP request.
#
# Was 20s, then 10s, then 5s, then 2s, then 0.5s — each cut for the same
# reason (a live opponent felt every move as a real wait). Raised back to 1.5s
# after 0.5s was measured to be the actual cause of a different, worse
# complaint ("it plays a real sacrifice, then hangs pieces right after"): a
# real test game plus a direct depth probe on the exact position where the
# bot's follow-up first went wrong (see the analysis in this repo's session
# history around the fix, position after 17...Bg4) showed the search reaching
# only depth 14-15 at GRANDMASTER_MULTIPV=6 within 0.5s, in a genuinely sharp,
# forcing position - exactly where more depth matters most and where a
# shallow search's evaluation is least trustworthy (the same position's true
# eval, per this app's own deep post-game analysis, was already ~65cp worse
# for the mover than the 0.5s search believed). 1.5s measured depth 18 at the
# same multipv, and is still far short of the old 5-20s that made moves feel
# unusably slow - the target here is "materially deeper without being a
# perceptible wait", not a return to the old budgets.
#
# Raised again, 1.5s -> 3.0s, on explicit request for more "critical
# thinking" power, not because 1.5s was measured broken this time. Re-probed
# the same reference position (post-17...Bg4) at both budgets: 1.5s landed
# depth 17 and misjudged the position as dead equal (cp 0) in one run, depth
# 19 in another - the search is close enough to its own iteration boundary
# there that it can land on either side of it run to run. 3.0s reached depth
# 20 consistently and correctly saw the mover already worse (cp -90),
# removing that boundary-case variance rather than chasing a specific depth
# number.
#
# On the free-tier host this is not a clean 1:1 mapping, though: this is
# *requested* engine time, not *delivered* wall-clock time there. A
# CPU-starved process (this host gets roughly a tenth of a real core) gets
# scheduled far less often, so Stockfish's own internal clock-checking
# between search iterations happens less frequently too — by the time it
# next checks the clock and notices the deadline passed, more real time has
# elapsed than the deadline itself. Measured overshoot so far: 5s requested
# -> 10-15s real, then 2s requested -> 7s real (~3.5x). If that ratio still
# roughly holds, 3.0s requested lands near ~10s real wall-clock time on that
# host - a real, felt wait, and worth re-measuring there directly if it
# feels too slow; a deliberate trade for more calculation power, made with
# eyes open rather than assumed away.
#
# Below roughly this point, the fixed per-move cost of spawning a fresh
# Stockfish process and completing the UCI handshake (~0.4s measured
# locally, likely more when CPU-starved — see `engine_pool.StockfishEngine`)
# starts to dominate over the search time itself, so further cuts here have
# rapidly diminishing returns. The next real lever past that floor is
# reusing one long-lived engine process across moves instead of spawning a
# new one per move — a bigger change (needs a lifecycle-managed, lock-guarded
# shared engine), not attempted yet since it hasn't been asked for.
#
# Nothing between the browser and uvicorn imposes a shorter deadline
# (`apiFetch` sets no timeout, no proxy sits in front of the app), so the
# request survives whatever this ends up actually taking.
GRANDMASTER_TIME_LIMIT_S = 3.0


def is_grandmaster(elo: int) -> bool:
    """True when `elo` selects the unrestricted full-strength tier."""
    return elo >= GRANDMASTER_ELO


# Every bot move shares the same handful of long-lived Stockfish processes
# (see `engine_pool`'s "Shared, long-lived processes") instead of spawning a
# fresh one per move - that spawn-and-handshake cost used to be paid on every
# single move and was the dominant part of a move's latency, not the search
# itself. The UCI protocol isn't safe for two threads to drive at once, so
# this lock serialises actual engine use across concurrent bot games; it does
# not serialise anything else about a request.
_BOT_ENGINE_LOCK = threading.Lock()

# How many candidate moves to re-rank. Wider than the obvious 5: a speculative
# sacrifice is exactly the kind of move a top engine ranks 6th-8th, so a pool of
# 5 measurably contains no aggressive option at all in most quiet positions and
# the personality never gets anything to choose between.
BOT_MULTIPV = 10

# The Grandmaster tier's pool is slightly wider than the practice tiers' need
# for personality, but deliberately *narrow* compared to what it used to be (14).
#
# MultiPV is not free: the engine must keep N separate lines alive to the same
# depth, so a wide search spends most of its budget proving that moves 7-14 are
# bad instead of calculating the move it is actually going to play. At this tier
# strength wins that trade - 4 still gives the personality scorer a real choice
# (a sound sacrifice that the engine rates near-equal is, by definition, in the
# top handful of lines), while returning a much deeper evaluation of each.
#
# Narrowed from 6, alongside GRANDMASTER_TIME_LIMIT_S being raised, after a
# direct measurement on a real mid-game position: within the same time budget,
# multipv=6 reached depth 14-15 and rated the position dead equal, while
# multipv=1 reached depth 16 and correctly saw the mover already slightly
# worse - the extra lines were spending search effort proving weaker
# alternatives were weaker instead of resolving the top line further. 4 is a
# middle point between that accuracy gain and keeping enough breadth for
# personality re-ranking to still have real alternatives to choose from.
GRANDMASTER_MULTIPV = 4

# Centipawn loss (vs. the engine's own best move) a candidate may cost and still
# be eligible, indexed by aggression level 1-5.
#
# Raised again from {0, 25, 50, 85, 120} (itself raised from {0, 20, 40, 65, 90}):
# even the top practice tier (near Stockfish's own UCI_Elo ceiling) was still
# routinely converging on quiet, drawish continuations at aggression 5 - real
# attacking tries and sharp complications cost more than a pawn and a half in a
# meaningful share of tested middlegame positions, so this table was still the
# binding constraint more often than the personality weights below it. ~1.7
# pawns at the top band is a real, felt concession rather than noise.
AGGRESSION_TOLERANCE_CP: dict[int, int] = {1: 0, 2: 32, 3: 65, 4: 105, 5: 150}

# The same gate, for the Grandmaster tier only - tighter than the practice
# table, on purpose.
#
# The table above is a *strength concession*: it buys a sharper style by letting
# the bot play a move it knows is up to ~1.2 pawns worse. That is exactly right
# for practice mode, where the handicap is the product. It is exactly wrong for
# the tier whose entire job is to not lose, where handing a strong opponent a
# pawn for aesthetics is how a won game becomes a lost one.
#
# Tightened back down from {0, 16, 30, 50, 70}: this app's own post-game
# analysis (see classification.py) grades every move on win%-drop, and a
# concession anywhere near the old 70cp ceiling routinely lands in
# Inaccuracy/Mistake territory (INACCURACY_MAX_DROP=10%, MISTAKE_MAX_DROP=20%)
# in a roughly balanced middlegame, where the win%-vs-cp curve is steepest -
# so the bot was earning its own "aggression" by intentionally playing moves
# its own analysis pipeline would later grade as mistakes. A real, *sound*
# sacrifice is the whole point of this tier's style and should cost far less
# than that: `BRILLIANT_MIN_WIN_PCT`'s band only ever fires inside a 1-2%
# win-drop, which this table's old ceiling was 5-10x wider than. Narrower
# bands push the personality re-rank (below) to actually search for cheap,
# real tactical chances instead of just cashing in the whole budget on
# aesthetics; `AGGRESSION_PERSONALITY_GAIN`'s top end was raised to match, so
# a genuinely sharp try still gets chosen decisively within this smaller,
# safer budget rather than the bot quietly reverting to quiet moves instead.
#
# Widened again on explicit request for more aggression/sacrifices, but not
# blindly repeating the earlier widen-then-revert cycles this table has its
# own history of: the two things that actually caused the last "hangs
# pieces" regression - too little real search time (0.5s) and too wide a
# multipv pool diluting it (6 lines) - were fixed first (see
# GRANDMASTER_TIME_LIMIT_S, now 3.0s, and GRANDMASTER_MULTIPV, now 4), and
# verified clean (one mild inaccuracy across 51 moves in a real test game,
# zero mistakes/blunders) before this table was touched again. This step is
# deliberately smaller than the old, reverted {0, 16, 30, 50, 70} - re-check
# real games after this if aggression goes any higher than here.
GRANDMASTER_AGGRESSION_TOLERANCE_CP: dict[int, int] = {1: 0, 2: 15, 3: 28, 4: 42, 5: 60}

# How hard the personality terms push, per aggression level.
#
# Widening the tolerance gate alone does *not* make the bot sharper: the gate
# only decides which candidates are allowed, while `CP_LOSS_WEIGHT` still taxes
# every centipawn given up inside it. With a flat personality weight a 1-pawn
# sacrifice (45 points) simply loses to the 0.5/cp tax past ~90cp, so raising
# the ceiling changed nothing on its own. This gain is the second half - it
# decides how *eagerly* the bot spends whatever budget the tolerance table
# above actually allows.
#
# Top two levels raised again (4: 2.0->2.3, 5: 3.0->3.6) to go with
# `GRANDMASTER_AGGRESSION_TOLERANCE_CP` being tightened in the same change:
# a smaller, safer budget needs a higher gain to still get spent decisively -
# otherwise the bot would default back to quiet engine moves more often
# simply because the room to be sharp shrank, which is the opposite of the
# goal (more decisive aggression, spent on cheaper/sounder tries instead of
# occasional expensive ones). Level 1 stays 0.0 - no personality at all,
# matching the "plain engine move" contract of that level.
#
# Top two raised again (4: 2.3->2.5, 5: 3.6->4.0), a smaller step than the
# tolerance table's own widening above - this shared table also drives the
# practice tiers (`personality_gain_for` doesn't know which elo tier called
# it), which already have a much wider tolerance budget of their own and
# don't need as much extra push to spend it.
AGGRESSION_PERSONALITY_GAIN: dict[int, float] = {
    1: 0.0,
    2: 0.85,
    3: 1.25,
    4: 2.5,
    5: 4.0,
}

MIN_AGGRESSION = 1
MAX_AGGRESSION = 5


# --- Full Attack Mode -------------------------------------------------------
#
# A separate, opt-in "go for the kill" setting - not another aggression
# level. The aggression slider's own top end has already been widened and
# reverted twice this session; the user's own call was to leave it exactly
# as it is and add this instead as a distinct, separately-selectable mode
# that overrides the slider rather than extending it. Off by default, and
# every function below defaults its new `full_attack` parameter to `False`,
# so every existing caller (the analysis pipeline, every existing test, a
# game with Full Attack off) is byte-for-byte unaffected.

# A much wider ceiling than any aggression level offers - wide enough to
# admit a genuine rook sacrifice (~500cp of raw material) with real, if
# imperfect, compensation. Still a real ceiling, not unconditional: an
# outright hung queen with nothing for it stays excluded.
#
# Raised from 600 to 850 - room for a rook sacrifice *plus* real follow-up
# cost (e.g. a further exchange or pawn given up pressing the attack once
# the rook is already committed), not just the rook alone. This mode's
# entire premise is "expect to lose more games for a real shot at a direct
# attack" - a ceiling this wide is deliberately not a safe number.
FULL_ATTACK_TOLERANCE_CP = 850

# Roughly doubled from the standard weights - sacrifices, and the king
# attack they're usually made for, are the entire point of this mode, not
# just barely-permitted personality flavour.
#
# Raised again (sacrifice 90->130, king exposure 60->85, king pressure
# 24->34) alongside the wider ceiling above - the same "a wider gate needs a
# matching gain" reasoning applies a second time: admitting bigger
# sacrifices without rewarding them proportionally more would just leave
# the extra room mostly unused.
FULL_ATTACK_SACRIFICE_WEIGHT = 130.0
FULL_ATTACK_KING_EXPOSURE_WEIGHT = 85.0
FULL_ATTACK_KING_PRESSURE_WEIGHT = 34.0

# Higher than even aggression 5's gain (3.6), so the much wider tolerance
# above actually gets used rather than just adding losing-tiebreak
# candidates to the pool - the same "a wider gate needs a matching gain"
# lesson AGGRESSION_PERSONALITY_GAIN's own comment already documents.
# Raised from 5.0 to keep pace with the ceiling/weight increases above.
FULL_ATTACK_PERSONALITY_GAIN = 7.0


# --- Repetition avoidance --------------------------------------------------
#
# The bot used to drift into threefold repetitions simply because a shuffling
# move happened to top the pool. Now that repetitions no longer auto-end the
# game (see bot_game_service._finish_if_over) that would just produce an endless
# shuffle, so a candidate that walks into a third occurrence of a position is
# dropped from consideration - but only when there is something else to play.
#
# The escape hatch matters as much as the rule: a perpetual check that saves a
# lost position is a *good* move, and a bot that plays a losing alternative to
# dodge a draw is worse than the draw. So a repeating candidate is still played
# when it beats the best non-repeating one by this margin, and when every legal
# option repeats.
REPETITION_ESCAPE_MARGIN_CP = 90

# Personality weights, in "score points". Calibrated against CP_LOSS_WEIGHT:
# giving up a pawn (45) is worth roughly 90cp of eval, i.e. the whole tolerance
# budget at aggression 5, so a sacrifice has to be nearly sound to be chosen.
SACRIFICE_WEIGHT = 45.0  # per pawn-unit of material handed over
KING_EXPOSURE_WEIGHT = 30.0  # per pawn-shield/open-file point around their king
KING_PRESSURE_WEIGHT = 12.0  # per extra attacker aimed at their king zone
CP_LOSS_WEIGHT = 0.5  # penalty per centipawn given up vs. the engine's best

# Sacrifice/king-zone pressure both describe direct attacks on the enemy
# king; this is the other half of "tactical" - does the move leave one or
# more *other* enemy pieces hanging, the raw shape of a fork, a pin that
# wins material, or a trap the opponent has to spot to avoid. Deliberately
# coarse (see `_new_threats`: undefended-or-not, no piece-value weighting)
# because it only has to break a tie among candidates the tolerance gate has
# already accepted as sound - it does not need to be a real SEE calculation
# to do that job.
THREAT_WEIGHT = 18.0  # per newly-hanging enemy piece this move creates

# A voluntary queen-for-queen trade is the single most common way a game
# heads toward a draw - it strips the board of the piece that creates the
# most winning chances, in both attack and technique. Penalising it (like
# every other personality term, only among candidates that already passed
# the tolerance gate - this never turns a genuinely best queen trade into a
# worse move, it only breaks a near-tie against not trading) pushes the bot
# to keep pieces on the board and keep playing for a win rather than
# simplifying, which is exactly the complaint this was tuned against: a
# strong practice-tier bot trading down into drawn positions instead of
# pressing an advantage.
QUEEN_TRADE_PENALTY = 25.0
# Only applied when the mover isn't clearly worse off - trading down while
# genuinely losing is normal defensive technique, not draw-seeking, and
# should not be discouraged.
QUEEN_TRADE_PENALTY_FLOOR_CP = -50

# Volatility: the eval spread across the candidate pool. It is identical for
# every candidate in a position, so it acts as a *gain* on the personality
# terms rather than an additive bonus - in a sharp position (wide spread) the
# aggressive choice is worth more practical chances, in a dead-flat one the
# bot stays closer to the engine's own preference.
VOLATILITY_REFERENCE_CP = 300.0  # spread at which the personality gain doubles
MAX_VOLATILITY_GAIN = 2.0

# Mate scores are folded into a large centipawn value when comparing lines,
# mirroring the analysis task's convention.
MATE_SCORE_CP = 10_000


@dataclass
class ScoredCandidate:
    """One candidate move with its Tal-ness breakdown. Mover-POV throughout."""

    candidate: CandidateMove
    cp_mover: int
    cp_loss: int
    eligible: bool
    sacrifice_pawns: int
    king_exposure_delta: int
    king_pressure_delta: int
    new_threats: int
    score: float
    # True when playing this move makes the resulting position occur for the
    # third time in the game. Handled by `_prefer_non_repeating`, not by the
    # score, because avoiding a repetition is a filter over the pool rather
    # than one more term to be traded off against king safety.
    repeats: bool = False


# --- Public API ------------------------------------------------------------


def choose_bot_move(
    board: chess.Board,
    elo: int,
    aggression: int,
    strategy_context: StrategyContext | None = None,
    full_attack: bool = False,
) -> chess.Move:
    """Pick the bot's move: elo-capped engine first, aggression re-rank second.

    At `GRANDMASTER_ELO` and above the strength step is skipped entirely: the
    engine is opened unrestricted (`elo=None` - no UCI cap, no node budget) and
    searched deeper. The aggression re-rank still runs on top, so the tier keeps
    its Tal flavour, but against a much tighter tolerance gate
    (`GRANDMASTER_AGGRESSION_TOLERANCE_CP`), so style is never bought with
    material at the tier whose job is to not lose.

    `strategy_context` (see `gambit_strategy.py`) is an optional third knob on
    top of the two above: a selected gambit plus the opponent's observed style,
    folded into the personality re-rank as one more preference. `None` (the
    default) reproduces this function's exact prior behaviour - every existing
    caller is unaffected.

    `full_attack=True` is Full Attack Mode (see `score_candidates`) - a real
    sacrifice, up to a whole rook, for a direct attack, overriding the
    aggression slider's own tolerance rather than extending it. Composes
    cleanly with a selected gambit: a game can have a gambit, Full Attack
    Mode, both, or neither, independently.
    """
    if is_grandmaster(elo):
        engine = StockfishEngine(
            elo=None, depth=GRANDMASTER_SEARCH_DEPTH, reuse_process=True
        )
        depth = GRANDMASTER_SEARCH_DEPTH
        time_limit = GRANDMASTER_TIME_LIMIT_S
        multipv = GRANDMASTER_MULTIPV
    else:
        engine = StockfishEngine(elo=elo, reuse_process=True)
        depth = BOT_SEARCH_DEPTH
        time_limit = None
        multipv = BOT_MULTIPV

    with _BOT_ENGINE_LOCK, engine:
        candidates = engine.analyse_candidates(
            board, depth=depth, multipv=multipv, time_limit=time_limit
        )
        candidates = _ensure_gambit_candidate(
            engine, board, candidates, strategy_context, depth, time_limit
        )

    if not candidates:
        raise EngineError(
            "Stockfish returned no candidate moves.",
            {"fen": board.fen(), "elo": elo, "aggression": aggression},
        )

    return select_move(board, candidates, aggression, elo, strategy_context, full_attack)


def _ensure_gambit_candidate(
    engine: StockfishEngine,
    board: chess.Board,
    candidates: list[CandidateMove],
    strategy_context: StrategyContext | None,
    depth: int,
    time_limit: float | None,
) -> list[CandidateMove]:
    """If an active gambit's own next scripted move exists but the ordinary
    multipv search in `choose_bot_move` didn't happen to surface it, fetch a
    real, targeted evaluation for it (`StockfishEngine.evaluate_move`) and
    append it to the pool.

    This is the piece that actually makes `score_candidates`' unconditional
    eligibility and cp_loss tax exemption for the gambit's own move reachable:
    both only ever operate on candidates already in the pool, and a
    deliberately engine-imperfect gambit continuation (the entire point of a
    gambit) is exactly the kind of move a top-`multipv` search routinely
    leaves out entirely, no matter how the eligibility rule is written — there is
    nothing there for the ceiling to admit. Without this, "play the gambit"
    kept silently failing the moment the engine's own shortlist didn't happen
    to include the book move, regardless of any tolerance tuning.
    """
    if strategy_context is None or strategy_context.status != "active":
        return candidates
    next_san = strategy_context.next_move_san
    if next_san is None:
        return candidates

    try:
        move = board.parse_san(next_san)
    except ValueError:
        # Malformed data or a position this SAN no longer applies to —
        # `gambit_strategy.build_context` should never produce this, but a
        # live game is not the place to discover that with a crash.
        return candidates

    if any(candidate.move == move for candidate in candidates):
        return candidates

    extra = engine.evaluate_move(board, move, depth=depth, time_limit=time_limit)
    return [*candidates, extra]


def select_move(
    board: chess.Board,
    candidates: list[CandidateMove],
    aggression: int,
    elo: int | None = None,
    strategy_context: StrategyContext | None = None,
    full_attack: bool = False,
) -> chess.Move:
    """Choose among an already-fetched candidate pool. Pure, so it unit-tests.

    `board` must carry the game's real move stack for repetition avoidance to
    see anything - `bot_game_service.reconstruct_board` replays every stored
    move with `push()`, so it does. A history-less board simply never reports a
    repetition, which degrades to the previous behaviour rather than misfiring.

    `elo` is passed through purely so the Grandmaster tier gets its own tighter
    tolerance table; omitting it keeps the practice-tier behaviour. `None` for
    `strategy_context` reproduces the exact prior behaviour (see `choose_bot_move`).
    `full_attack=True` is Full Attack Mode - see `score_candidates`.
    """
    if not candidates:
        raise EngineError("No candidate moves to choose from.", {"fen": board.fen()})

    scored = score_candidates(board, candidates, aggression, elo, strategy_context, full_attack)
    pool = _prefer_non_repeating(scored)

    # An active gambit's own next scripted move, once actually in the pool
    # (see choose_bot_move's _ensure_gambit_candidate), is played outright -
    # not just favoured by score. GAMBIT_LINE_BONUS alone can't guarantee
    # that: measured directly, a queen recapture's own threat-creation
    # personality score legitimately outscored the fixed bonus in a real
    # position (Smith-Morra's 3.c3 vs. simply retaking on d4), which would
    # have silently reproduced "select a gambit, watch the bot abandon it"
    # with a wider but still probabilistic gap. "Play the selected gambit" is
    # a stronger, more explicit signal than the aggression slider - this
    # applies at every aggression level, including 1 ("no personality"),
    # since picking a gambit is a separate, deliberate choice from picking a
    # strength/style setting. Still subject to the repetition filter above
    # (this early in a game that's essentially never live, but a plain "="
    # rather than a special case).
    if strategy_context is not None and strategy_context.status == "active" and strategy_context.next_move_san is not None:
        for item in pool:
            if gambit_strategy.is_line_continuation(board, item.candidate.move, strategy_context):
                return item.candidate.move

    # Aggression 1 is plain elo-limited Stockfish: no personality at all, just
    # the engine's own ranking over whatever the repetition filter left. Full
    # Attack Mode overrides this too - it's a real, separate mode, so it still
    # engages personality-driven selection even if the aggression slider
    # happens to sit at 1.
    if aggression <= MIN_AGGRESSION and not full_attack:
        return _engine_preference(pool)

    eligible = [item for item in pool if item.eligible]
    if not eligible:
        # The tolerance reference is the whole pool's best score, so an
        # unfiltered pool always has one eligible candidate; the filtered one
        # may not, and either way the engine's own preference is the right
        # fallback.
        return _engine_preference(pool)

    return max(eligible, key=lambda item: item.score).candidate.move


def _engine_preference(pool: list[ScoredCandidate]) -> chess.Move:
    """The engine's own favourite among `pool`, which stays in multipv order.

    Deliberately *not* `max(..., key=cp_mover)`: when a search is cut off
    mid-iteration - which the Grandmaster tier's wall-clock bound does routinely
    at `GRANDMASTER_MULTIPV` lines - the pool's scores come from different
    iterations and are not comparable, so re-ranking by them picks worse moves
    than trusting Stockfish's ordering. The filters above only ever remove
    entries, never reorder them, so the head of `pool` is still the engine's
    best surviving choice.
    """
    return pool[0].candidate.move


def _prefer_non_repeating(scored: list[ScoredCandidate]) -> list[ScoredCandidate]:
    """Drop candidates that repeat a position, when that costs nothing real.

    Two escape hatches, both load-bearing:

    * If *every* candidate repeats there is nothing to choose between, so the
      pool is returned untouched rather than emptied.
    * If the best repeating candidate is better than the best non-repeating one
      by `REPETITION_ESCAPE_MARGIN_CP`, the repetition is a genuine resource
      (perpetual check out of a lost position is the archetype) and is kept.
      Refusing a legitimately good draw to avoid repeating is a worse outcome
      than the draw.
    """
    repeating = [item for item in scored if item.repeats]
    if not repeating:
        return scored

    fresh = [item for item in scored if not item.repeats]
    if not fresh:
        return scored

    best_repeating = max(item.cp_mover for item in repeating)
    best_fresh = max(item.cp_mover for item in fresh)
    if best_repeating - best_fresh >= REPETITION_ESCAPE_MARGIN_CP:
        return scored

    return fresh


def score_candidates(
    board: chess.Board,
    candidates: list[CandidateMove],
    aggression: int,
    elo: int | None = None,
    strategy_context: StrategyContext | None = None,
    full_attack: bool = False,
) -> list[ScoredCandidate]:
    """Score every candidate for Tal-ness and mark tolerance eligibility.

    `elo` only selects the tolerance table (see `tolerance_for`); every
    personality term is tier-independent. `strategy_context` (optional - see
    `gambit_strategy.py`) folds in a selected gambit and the opponent's
    observed style as two more score terms; those *score* terms are applied
    strictly after `eligible` is decided, so neither can turn an otherwise
    ineligible candidate into the chosen move by outscoring the field. The one
    exception to eligibility itself is the gambit's own next scripted move,
    which is unconditionally eligible regardless of cp_loss (see the comment
    where `eligible` is computed below) - pre-vetted opening theory, not a
    preference. That same move is also exempt from `CP_LOSS_WEIGHT`'s cp_loss tax in the
    score itself (once eligible, still scored - just not taxed for the exact
    concession the eligibility exception just decided was fine), so a real
    gambit's book cost doesn't quietly outweigh `GAMBIT_LINE_BONUS` and get
    outscored by a quieter alternative anyway.

    `full_attack=True` swaps in `FULL_ATTACK_TOLERANCE_CP`/
    `FULL_ATTACK_PERSONALITY_GAIN` (via `tolerance_for`/`personality_gain_for`)
    and the `FULL_ATTACK_*` personality weights below, in place of the
    aggression-indexed tables and the standard `SACRIFICE_WEIGHT`/
    `KING_EXPOSURE_WEIGHT`/`KING_PRESSURE_WEIGHT` - bypassing the aggression
    slider entirely rather than extending it. `CP_LOSS_WEIGHT`, `THREAT_WEIGHT`
    and `QUEEN_TRADE_PENALTY` are unchanged either way: the boost is scoped to
    sacrifice-and-king-attack specifically, not a blanket rewrite of every term.
    """
    mover = board.turn
    tolerance = tolerance_for(aggression, elo, full_attack)
    aggression_gain = personality_gain_for(aggression, full_attack)
    gambit_gain = gambit_strategy.personality_multiplier(strategy_context)
    sacrifice_weight = FULL_ATTACK_SACRIFICE_WEIGHT if full_attack else SACRIFICE_WEIGHT
    king_exposure_weight = FULL_ATTACK_KING_EXPOSURE_WEIGHT if full_attack else KING_EXPOSURE_WEIGHT
    king_pressure_weight = FULL_ATTACK_KING_PRESSURE_WEIGHT if full_attack else KING_PRESSURE_WEIGHT

    cp_movers = [_mover_cp(candidate, mover) for candidate in candidates]
    # The gate references the pool's best score rather than candidates[0]: a
    # node-budgeted search can report its multipv lines from different
    # iterations, leaving the pool very slightly out of order.
    best_cp = max(cp_movers)
    gain = _volatility_gain(cp_movers)

    scored: list[ScoredCandidate] = []
    for candidate, cp_mover in zip(candidates, cp_movers):
        cp_loss = best_cp - cp_mover
        is_gambit_move = gambit_strategy.is_line_continuation(board, candidate.move, strategy_context)

        # The one exception to "eligibility is decided from cp_loss alone,
        # before any gambit/personality term": an active gambit's own next
        # scripted move is unconditionally eligible, not just given a wider
        # cp_loss ceiling. A finite ceiling was tried first and measured to
        # still fail on real, bundled gambits - Smith-Morra's own key idea,
        # 3.c3, deliberately declines an immediate free recapture on d4, which
        # the engine reads as a far larger concession than any ceiling narrow
        # enough to still mean something would admit (the Halloween Gambit
        # sacrifices two knights outright - "how much a real gambit can cost"
        # and "how much a real blunder costs" simply overlap; there is no
        # principled finite cp number between them). The gambit's
        # starting_moves are pre-vetted, named opening theory, not a
        # heuristic preference, and `gambit_strategy.build_context` already
        # guarantees the entire game so far is an exact match for that theory
        # before this ever applies (`is_gambit_line`) - the actual safety net
        # is upstream, in `validate_gambits()` (`tests/test_gambits.py`)
        # checking every bundled entry replays legally, and in the library
        # being hand-curated named theory rather than generated data.
        eligible = cp_loss <= tolerance or is_gambit_move

        sacrifice = _sacrifice_pawns(board, candidate.move)
        exposure_delta, pressure_delta = _king_attack_deltas(board, candidate.move)
        threats = _new_threats(board, candidate.move)
        queen_trade = (
            cp_mover >= QUEEN_TRADE_PENALTY_FLOOR_CP
            and _initiates_queen_trade(board, candidate.move)
        )

        personality = (
            sacrifice_weight * sacrifice
            + king_exposure_weight * exposure_delta
            + king_pressure_weight * pressure_delta
            + THREAT_WEIGHT * threats
            - (QUEEN_TRADE_PENALTY if queen_trade else 0.0)
        )
        # The gambit's own scripted move is exempt from the cp_loss tax in the
        # score itself, not just from the eligibility gate above: at
        # CP_LOSS_WEIGHT=0.5, a realistic ~100cp book concession costs 50
        # score points - more than GAMBIT_LINE_BONUS (40) can make back, which
        # would leave the move "eligible" but still reliably outscored by a
        # quieter, higher-eval alternative, silently reproducing the same
        # abandon-the-gambit bug this eligibility exception exists to fix.
        # This is still not unconditional: a candidate with a genuinely
        # stronger personality score (a real sacrifice/king-hunt/threat this
        # position actually offers) can still outscore it, same as any other
        # eligible move - only the raw "book theory costs centipawns" tax is
        # waived, not competition from other real tactical chances.
        taxed_cp_loss = 0.0 if is_gambit_move else cp_loss
        score = personality * gain * aggression_gain * gambit_gain - CP_LOSS_WEIGHT * taxed_cp_loss
        # Priority 6 (selected gambit preference) - the very last term, and
        # only ever added on top of a score whose eligibility was already
        # decided above from cp_loss alone.
        score += gambit_strategy.candidate_bonus(board, candidate, strategy_context)

        scored.append(
            ScoredCandidate(
                candidate=candidate,
                cp_mover=cp_mover,
                cp_loss=cp_loss,
                eligible=eligible,
                sacrifice_pawns=sacrifice,
                king_exposure_delta=exposure_delta,
                king_pressure_delta=pressure_delta,
                new_threats=threats,
                score=score,
                repeats=_repeats_position(board, candidate.move),
            )
        )
    return scored


def tolerance_for(aggression: int, elo: int | None = None, full_attack: bool = False) -> int:
    """Centipawn tolerance for an aggression level, clamped to the 1-5 range.

    `elo` selects *which* table applies: the Grandmaster tier gets the tight
    one, every practice tier keeps the original (looser) bands. `None` means
    "tier unknown", which reads the practice table - the safe default, since a
    caller with no elo in hand is never the Grandmaster path.

    `full_attack=True` bypasses both the elo tier and the aggression slider
    entirely, returning `FULL_ATTACK_TOLERANCE_CP` regardless of either -
    Full Attack Mode is a real override, not one more aggression level.
    """
    if full_attack:
        return FULL_ATTACK_TOLERANCE_CP
    level = max(MIN_AGGRESSION, min(MAX_AGGRESSION, aggression))
    if elo is not None and is_grandmaster(elo):
        return GRANDMASTER_AGGRESSION_TOLERANCE_CP[level]
    return AGGRESSION_TOLERANCE_CP[level]


def personality_gain_for(aggression: int, full_attack: bool = False) -> float:
    """Personality multiplier for an aggression level, clamped to the 1-5
    range - or `FULL_ATTACK_PERSONALITY_GAIN` outright when `full_attack` is
    set, same override relationship as `tolerance_for`."""
    if full_attack:
        return FULL_ATTACK_PERSONALITY_GAIN
    level = max(MIN_AGGRESSION, min(MAX_AGGRESSION, aggression))
    return AGGRESSION_PERSONALITY_GAIN[level]


def _repeats_position(board: chess.Board, move: chess.Move) -> bool:
    """True when `move` makes the resulting position occur a third time.

    Needs the game's real history, so it works on `board` itself (push/pop)
    rather than a `copy(stack=False)` like the other heuristics: a stackless
    copy has no earlier occurrences to find and would always answer False.
    The push is undone before returning, so the caller's board is unchanged.
    """
    if not board.move_stack:
        return False
    if not board.is_legal(move):
        return False

    board.push(move)
    try:
        return board.is_repetition(3)
    finally:
        board.pop()


# --- Heuristics ------------------------------------------------------------


def _sacrifice_pawns(board: chess.Board, move: chess.Move) -> int:
    """Pawn-units the mover hands over by playing this move (0 if none).

    A side's own move can never reduce its own material, so - like
    `classification.is_material_sacrifice` - the delta is measured *past* the
    move: the opponent's most-valuable-victim capture, then the mover's
    cheapest recapture. No engine call, so this stays free to run on every
    candidate; it is enough to tell a real offer from an ordinary trade.
    """
    mover = board.turn
    before = material_balance(board, mover)

    after_board = board.copy(stack=False)
    if move not in after_board.legal_moves:
        return 0
    after_board.push(move)

    reply = _greedy_capture(after_board)
    if reply is not None:
        target = reply.to_square
        after_board.push(reply)
        recapture = _cheapest_capture_on(after_board, target)
        if recapture is not None:
            after_board.push(recapture)

    return max(0, before - material_balance(after_board, mover))


def _initiates_queen_trade(board: chess.Board, move: chess.Move) -> bool:
    """True when the mover captures the opponent's queen with their own queen -
    not a queen capturing a lesser piece, which is just winning material and
    unrelated to simplification.

    Does not itself distinguish a genuinely even trade from recapturing a
    queen that just took one of ours, or from grabbing an undefended queen for
    free - but it doesn't need to: those are exactly the positions where the
    raw centipawn swing already dwarfs `QUEEN_TRADE_PENALTY`, so the tolerance
    gate (or the `-CP_LOSS_WEIGHT * cp_loss` term) decides those cases long
    before this penalty is large enough to matter. It only actually changes
    the outcome when trading and not trading were close to begin with - a
    genuinely optional simplification, which is what this is tuned for.
    """
    moving_piece = board.piece_at(move.from_square)
    if moving_piece is None or moving_piece.piece_type != chess.QUEEN:
        return False
    if board.is_en_passant(move):
        return False
    victim = board.piece_at(move.to_square)
    return victim is not None and victim.piece_type == chess.QUEEN


def _victim_value(board: chess.Board, move: chess.Move) -> int:
    """Pawn-unit value of the piece `move` captures (0 for a quiet move)."""
    if board.is_en_passant(move):
        return PIECE_VALUES[chess.PAWN]
    victim = board.piece_at(move.to_square)
    return PIECE_VALUES.get(victim.piece_type, 0) if victim is not None else 0


def _attacker_value(board: chess.Board, move: chess.Move) -> int:
    attacker = board.piece_at(move.from_square)
    return PIECE_VALUES.get(attacker.piece_type, 0) if attacker is not None else 0


def _greedy_capture(board: chess.Board) -> chess.Move | None:
    """Most valuable victim, least valuable attacker."""
    captures = [move for move in board.legal_moves if board.is_capture(move)]
    if not captures:
        return None
    return max(
        captures,
        key=lambda move: (_victim_value(board, move), -_attacker_value(board, move)),
    )


def _cheapest_capture_on(board: chess.Board, square: chess.Square) -> chess.Move | None:
    """Recapture on `square` with the least valuable attacker available."""
    recaptures = [
        move
        for move in board.legal_moves
        if move.to_square == square and board.is_capture(move)
    ]
    if not recaptures:
        return None
    return min(recaptures, key=lambda move: _attacker_value(board, move))


def _hanging_pieces(board: chess.Board, target_color: chess.Color) -> int:
    """Count of `target_color`'s own non-king pieces that are attacked and
    have no defender at all - the raw material a single further move could
    win outright, independent of what that piece is worth."""
    attacker_color = not target_color
    count = 0
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None or piece.color != target_color or piece.piece_type == chess.KING:
            continue
        if board.is_attacked_by(attacker_color, square) and not board.is_attacked_by(
            target_color, square
        ):
            count += 1
    return count


def _new_threats(board: chess.Board, move: chess.Move) -> int:
    """How many *additional* opponent pieces this move leaves hanging,
    compared to before it - the generic, piece-agnostic shape a fork, a
    discovered attack, or a trap the opponent has to spot all share. Never
    negative: a move that resolves an existing threat (recapturing, moving a
    piece to safety) is just good play, not a personality concern, so it
    scores 0 here rather than being penalised for the threat it removed.
    """
    defender = not board.turn
    before = _hanging_pieces(board, defender)

    after_board = board.copy(stack=False)
    if move not in after_board.legal_moves:
        return 0
    after_board.push(move)

    after = _hanging_pieces(after_board, defender)
    return max(0, after - before)


def _king_attack_deltas(board: chess.Board, move: chess.Move) -> tuple[int, int]:
    """(exposure delta, pressure delta) against the *opponent's* king.

    Exposure moves only when pawns around their king actually disappear, which
    a single move rarely does. Pressure - how many of our pieces bear on the
    king's own square and its eight neighbours - moves whenever we aim another
    piece at the king, so it is what makes ordinary attacking moves register.
    """
    defender = not board.turn
    exposure_before = _king_exposure(board, defender)
    pressure_before = _king_zone_pressure(board, defender)

    after_board = board.copy(stack=False)
    if move not in after_board.legal_moves:
        return 0, 0
    after_board.push(move)

    return (
        _king_exposure(after_board, defender) - exposure_before,
        _king_zone_pressure(after_board, defender) - pressure_before,
    )


def _king_zone_pressure(board: chess.Board, king_color: chess.Color) -> int:
    """Count attacks the other side aims at the king's square and its neighbours."""
    king_square = board.king(king_color)
    if king_square is None:
        return 0

    attacker = not king_color
    zone = chess.SquareSet(chess.BB_KING_ATTACKS[king_square])
    zone.add(king_square)
    return sum(len(board.attackers(attacker, square)) for square in zone)


def _king_exposure(board: chess.Board, king_color: chess.Color) -> int:
    """Crude exposure count for `king_color`'s king: higher means airier.

    Two cheap signals over the king's file and its two neighbours: a missing
    pawn shield in front of the king, and a file with no friendly pawn on it
    at all (open or half-open towards the king).
    """
    king_square = board.king(king_color)
    if king_square is None:
        return 0

    king_file = chess.square_file(king_square)
    king_rank = chess.square_rank(king_square)
    forward = 1 if king_color == chess.WHITE else -1
    own_pawns = board.pieces_mask(chess.PAWN, king_color)

    exposure = 0
    for file_index in range(max(0, king_file - 1), min(7, king_file + 1) + 1):
        shielded = False
        for rank_offset in (1, 2):
            rank = king_rank + forward * rank_offset
            if 0 <= rank <= 7 and chess.BB_SQUARES[chess.square(file_index, rank)] & own_pawns:
                shielded = True
                break
        if not shielded:
            exposure += 1
        if not own_pawns & chess.BB_FILES[file_index]:
            exposure += 1
    return exposure


# --- Score plumbing --------------------------------------------------------


def _volatility_gain(cp_movers: list[int]) -> float:
    """Gain factor from the candidate pool's eval spread (1.0 = flat position)."""
    if len(cp_movers) < 2:
        return 1.0
    spread = max(cp_movers) - min(cp_movers)
    return min(MAX_VOLATILITY_GAIN, 1.0 + spread / VOLATILITY_REFERENCE_CP)


def _mover_cp(candidate: CandidateMove, mover: chess.Color) -> int:
    """Collapse a candidate's White-POV (cp, mate) into a mover-POV number."""
    white_cp = _to_cp(candidate.cp, candidate.mate)
    return white_cp if mover == chess.WHITE else -white_cp


def _to_cp(cp: int | None, mate: int | None) -> int:
    if mate is not None:
        if mate > 0:
            return MATE_SCORE_CP - mate
        if mate < 0:
            return -MATE_SCORE_CP - mate
        return 0
    return cp if cp is not None else 0
