"""Tests for the Tal bot: strength cap first, aggression re-rank second.

The scoring/tolerance tests build candidate pools by hand so the assertions are
deterministic; the last class makes a handful of real Stockfish calls (the
engine is installed and a depth-12 search is fast) to prove the ELO cap and the
end-to-end move choice actually work.
"""

import chess
import chess.engine
import pytest

from app.services import tal_bot
from app.services.engine_pool import (
    MAX_CANDIDATE_NODES,
    MAX_UCI_ELO,
    MIN_UCI_ELO,
    NODES_AT_MIN_ELO,
    CandidateMove,
    StockfishEngine,
    nodes_for_elo,
)

# Greek-gift position: 8.Bxh7+ is a two-pawn-unit offer that rips open the
# black king, while 8.O-O is the quiet alternative.
GREEK_GIFT_FEN = "r1bq1rk1/pppn1ppp/3bpn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 8"


def candidates(board: chess.Board, *pairs: tuple[str, int]) -> list[CandidateMove]:
    """Build a White-POV candidate pool from (SAN, centipawns) pairs."""
    return [
        CandidateMove(move=board.parse_san(san), cp=cp, mate=None) for san, cp in pairs
    ]


class TestToleranceTable:
    def test_aggression_one_has_zero_tolerance(self):
        assert tal_bot.tolerance_for(1) == 0

    def test_tolerance_grows_with_aggression(self):
        values = [tal_bot.tolerance_for(level) for level in range(1, 6)]
        assert values == sorted(values)
        assert values[-1] == tal_bot.AGGRESSION_TOLERANCE_CP[5]

    @pytest.mark.parametrize("level", [-5, 0, 6, 99])
    def test_out_of_range_aggression_is_clamped(self, level):
        assert tal_bot.tolerance_for(level) in tal_bot.AGGRESSION_TOLERANCE_CP.values()

    def test_personality_gain_grows_with_aggression(self):
        """The gate alone never changed the pick; this gain is the other half."""
        gains = [tal_bot.personality_gain_for(level) for level in range(1, 6)]
        assert gains == sorted(gains)
        assert gains[0] == 0.0  # level 1 has no personality at all
        assert gains[-1] > 1.0

    @pytest.mark.parametrize("level", [-5, 0, 6, 99])
    def test_out_of_range_personality_gain_is_clamped(self, level):
        assert (
            tal_bot.personality_gain_for(level)
            in tal_bot.AGGRESSION_PERSONALITY_GAIN.values()
        )


class TestGrandmasterToleranceTable:
    """The top tier trades style for strength on a much tighter budget.

    The practice tiers' tolerance is a deliberate handicap - it lets the bot
    play a move it knows is up to ~1.2 pawns worse. At the tier whose job is to
    not lose, that same handicap is just a lost pawn, so it gets its own table.
    """

    @pytest.mark.parametrize("level", range(1, 6))
    def test_grandmaster_tolerance_is_tighter_at_every_level(self, level):
        gm = tal_bot.tolerance_for(level, elo=tal_bot.GRANDMASTER_ELO)
        practice = tal_bot.tolerance_for(level, elo=1500)
        assert gm <= practice
        if level > 1:
            assert gm < practice

    def test_top_grandmaster_tolerance_stays_within_engine_noise(self):
        """70cp is "a real but sound offer", still well under a full pawn."""
        assert tal_bot.tolerance_for(5, elo=tal_bot.GRANDMASTER_ELO) <= 75

    @pytest.mark.parametrize("elo", [800, 1500, 2000, 2500, tal_bot.GRANDMASTER_ELO - 1])
    def test_practice_tiers_keep_the_original_table(self, elo):
        for level in range(1, 6):
            assert (
                tal_bot.tolerance_for(level, elo=elo)
                == tal_bot.AGGRESSION_TOLERANCE_CP[level]
            )

    def test_an_unknown_tier_reads_the_practice_table(self):
        """`None` means "no tier in hand", which must never mean Grandmaster."""
        for level in range(1, 6):
            assert (
                tal_bot.tolerance_for(level) == tal_bot.AGGRESSION_TOLERANCE_CP[level]
            )

    def test_aggression_one_is_still_exact_at_both_tiers(self):
        assert tal_bot.tolerance_for(1, elo=tal_bot.GRANDMASTER_ELO) == 0
        assert tal_bot.tolerance_for(1, elo=1500) == 0

    @pytest.mark.parametrize("level", [-5, 0, 6, 99])
    def test_out_of_range_aggression_is_clamped(self, level):
        assert (
            tal_bot.tolerance_for(level, elo=tal_bot.GRANDMASTER_ELO)
            in tal_bot.GRANDMASTER_AGGRESSION_TOLERANCE_CP.values()
        )

    def test_a_costly_sacrifice_is_refused_at_grandmaster_but_taken_in_practice(self):
        """The behavioural difference, not just the table's numbers.

        Bxh7+ is 90cp behind the engine's best: inside the practice tier's
        level-5 budget (120cp) and outside the Grandmaster one (70cp).
        """
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 100), ("Bxh7+", 10))

        practice = tal_bot.select_move(board, pool, aggression=5, elo=1500)
        grandmaster = tal_bot.select_move(
            board, pool, aggression=5, elo=tal_bot.GRANDMASTER_ELO
        )
        assert board.san(practice) == "Bxh7+"
        assert board.san(grandmaster) == "O-O"

    def test_a_sound_sacrifice_is_still_taken_at_grandmaster(self):
        """Tightening the gate must not neuter the tier's style entirely.

        A 20cp offer is inside the Grandmaster budget - the engine itself rates
        it near-equal - so the personality still gets to choose it.
        """
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 30), ("Bxh7+", 10))

        chosen = tal_bot.select_move(
            board, pool, aggression=5, elo=tal_bot.GRANDMASTER_ELO
        )
        assert board.san(chosen) == "Bxh7+"

    def test_the_tier_gate_reaches_the_eligibility_flag(self):
        """The gate's direct effect: which candidates are allowed at all.

        90cp behind the engine's best: inside the practice tier's level-5
        budget (120cp) but still outside the Grandmaster one (70cp).
        """
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 100), ("Bxh7+", 10))

        gm_scored = {
            board.san(item.candidate.move): item
            for item in tal_bot.score_candidates(
                board, pool, aggression=5, elo=tal_bot.GRANDMASTER_ELO
            )
        }
        practice_scored = {
            board.san(item.candidate.move): item
            for item in tal_bot.score_candidates(board, pool, aggression=5, elo=1500)
        }
        assert gm_scored["Bxh7+"].eligible is False
        assert practice_scored["Bxh7+"].eligible is True


class TestAggressionOne:
    def test_returns_the_engines_own_top_candidate(self):
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 40), ("Bxh7+", 35), ("Ne5", 10))

        assert tal_bot.select_move(board, pool, aggression=1) == pool[0].move

    def test_ignores_an_obviously_tal_like_alternative(self):
        """Even a free, in-tolerance sacrifice must not be picked at level 1."""
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 40), ("Bxh7+", 40))

        assert board.san(tal_bot.select_move(board, pool, aggression=1)) == "O-O"


class TestAggressionBias:
    def test_high_aggression_prefers_the_sacrifice_within_tolerance(self):
        board = chess.Board(GREEK_GIFT_FEN)
        # Bxh7+ is 30cp worse than the engine's top move: inside the level-5
        # tolerance of 90cp, so the personality bias may take it.
        pool = candidates(board, ("O-O", 40), ("Bxh7+", 10), ("Ne5", 5))

        chosen = tal_bot.select_move(board, pool, aggression=5)
        assert board.san(chosen) == "Bxh7+"

    def test_quiet_pool_still_yields_the_top_move(self):
        """With no sacrifice or king-opening on offer, aggression changes nothing.

        Every move here scores exactly zero personality (no material offered,
        nothing aimed at the black king), so only the eval can decide.
        """
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 40), ("Bd2", 20), ("a3", 5))

        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "O-O"

    def test_a_modest_concession_buys_pressure_at_high_aggression(self):
        """The point of the retune: ordinary attacking moves now register.

        Ne5 offers nothing, but it does aim another piece at f7 - one point of
        king-zone pressure. Under the old flat personality weight a 35cp
        concession swamped that, so levels 1 and 5 picked the same move in most
        positions. Now level 5 takes it and level 3 still does not.
        """
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 40), ("Bd2", 20), ("Ne5", 5))

        assert board.san(tal_bot.select_move(board, pool, aggression=1)) == "O-O"
        assert board.san(tal_bot.select_move(board, pool, aggression=3)) == "O-O"
        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "Ne5"

    def test_scoring_credits_the_sacrifice_and_the_king_exposure(self):
        board = chess.Board(GREEK_GIFT_FEN)
        pool = candidates(board, ("O-O", 40), ("Bxh7+", 10))

        scored = {
            board.san(item.candidate.move): item
            for item in tal_bot.score_candidates(board, pool, aggression=5)
        }
        assert scored["Bxh7+"].sacrifice_pawns > 0
        assert scored["Bxh7+"].king_exposure_delta > 0
        assert scored["O-O"].sacrifice_pawns == 0
        assert scored["O-O"].king_exposure_delta == 0
        assert scored["Bxh7+"].score > scored["O-O"].score


class TestToleranceGate:
    def test_candidate_losing_too_much_is_not_eligible(self):
        board = chess.Board(GREEK_GIFT_FEN)
        # 300cp worse than the top move: far outside every tolerance band.
        pool = candidates(board, ("O-O", 40), ("Bxh7+", -260))

        scored = {
            board.san(item.candidate.move): item
            for item in tal_bot.score_candidates(board, pool, aggression=5)
        }
        assert scored["O-O"].eligible is True
        assert scored["Bxh7+"].eligible is False
        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "O-O"

    def test_gate_tightens_as_aggression_drops(self):
        board = chess.Board(GREEK_GIFT_FEN)
        # 30cp of loss: inside level 4/5, outside level 2.
        pool = candidates(board, ("O-O", 40), ("Bxh7+", 10))

        assert board.san(tal_bot.select_move(board, pool, aggression=2)) == "O-O"
        assert board.san(tal_bot.select_move(board, pool, aggression=4)) == "Bxh7+"

    def test_black_to_move_uses_mover_pov(self):
        """Candidate cp values are White-POV, so Black's ranking must invert."""
        board = chess.Board()
        board.push_san("e4")
        pool = candidates(board, ("c5", -20), ("e5", 300))

        scored = tal_bot.score_candidates(board, pool, aggression=5)
        by_san = {board.san(item.candidate.move): item for item in scored}
        # +300 White-POV is terrible for Black, so it must be gated out.
        assert by_san["c5"].cp_loss == 0
        assert by_san["e5"].eligible is False


def shuffled_board(*sans: str) -> chess.Board:
    """A board carrying real history, so `is_repetition` has something to see."""
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


# After these seven plies it is Black to move and ...Ng8 restores the starting
# position for the *third* time; every other legal move is fresh.
REPETITION_SANS = ("Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1")


class TestRepetitionAvoidance:
    """The bot must stop drifting into draws by shuffling, without refusing a
    repetition that is genuinely the best thing available."""

    def test_detects_a_third_occurrence(self):
        board = shuffled_board(*REPETITION_SANS)
        assert tal_bot._repeats_position(board, board.parse_san("Ng8")) is True
        assert tal_bot._repeats_position(board, board.parse_san("e5")) is False

    def test_detection_leaves_the_board_untouched(self):
        board = shuffled_board(*REPETITION_SANS)
        before, stack = board.fen(), len(board.move_stack)
        tal_bot._repeats_position(board, board.parse_san("Ng8"))
        assert board.fen() == before
        assert len(board.move_stack) == stack

    def test_a_history_less_board_never_reports_a_repetition(self):
        """Degrades to the old behaviour rather than misfiring."""
        board = chess.Board()
        assert tal_bot._repeats_position(board, board.parse_san("e4")) is False

    def test_repeating_top_move_is_skipped_for_a_comparable_alternative(self):
        board = shuffled_board(*REPETITION_SANS)
        # White-POV, Black to move: -10 (Ng8) is only 20cp better for Black
        # than -30 (e5), i.e. inside the escape margin, so e5 wins.
        pool = candidates(board, ("Ng8", 10), ("e5", 30))

        assert board.san(tal_bot.select_move(board, pool, aggression=1)) == "e5"
        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "e5"

    def test_repetition_is_kept_when_it_is_far_better(self):
        """The perpetual-check case: taking the draw beats losing the game."""
        board = shuffled_board(*REPETITION_SANS)
        # Every alternative is -500 White-POV worse for Black than repeating.
        pool = candidates(board, ("Ng8", 10), ("e5", 510), ("d5", 520))

        assert board.san(tal_bot.select_move(board, pool, aggression=1)) == "Ng8"
        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "Ng8"

    def test_repetition_is_kept_when_it_is_the_only_candidate(self):
        board = shuffled_board(*REPETITION_SANS)
        pool = candidates(board, ("Ng8", 10))

        assert board.san(tal_bot.select_move(board, pool, aggression=3)) == "Ng8"

    def test_filtered_pool_still_respects_the_tolerance_gate(self):
        """Dropping the repetition must not smuggle in an unsound alternative."""
        board = shuffled_board(*REPETITION_SANS)
        # Ng8 repeats; e5 is sound; d5 is 400cp worse and must stay ineligible.
        pool = candidates(board, ("Ng8", 10), ("e5", 30), ("d5", 430))

        assert board.san(tal_bot.select_move(board, pool, aggression=5)) == "e5"

    def test_scoring_flags_the_repeating_candidate(self):
        board = shuffled_board(*REPETITION_SANS)
        pool = candidates(board, ("Ng8", 10), ("e5", 30))

        flags = {
            board.san(item.candidate.move): item.repeats
            for item in tal_bot.score_candidates(board, pool, aggression=3)
        }
        assert flags == {"Ng8": True, "e5": False}


class TestStrategyContextDefaultsToANoOp:
    """`strategy_context` is new and optional — omitting it (every pre-gambit
    caller) must reproduce the exact prior behaviour. See gambit_strategy.py
    for the feature this guards the absence of."""

    def test_select_move_output_is_identical_with_and_without_default_context(self):
        board = chess.Board()
        pool = candidates(board, ("e4", 40), ("d4", 35), ("Nf3", 10))

        with_explicit_none = tal_bot.select_move(board, pool, aggression=4, strategy_context=None)
        omitted_entirely = tal_bot.select_move(board, pool, aggression=4)
        assert with_explicit_none == omitted_entirely

    def test_score_candidates_scores_are_unchanged_by_an_absent_context(self):
        board = chess.Board()
        pool = candidates(board, ("e4", 40), ("d4", 35))

        scores_without_param = [item.score for item in tal_bot.score_candidates(board, pool, aggression=4)]
        scores_with_none = [
            item.score
            for item in tal_bot.score_candidates(board, pool, aggression=4, strategy_context=None)
        ]
        assert scores_without_param == scores_with_none


class TestEmptyPool:
    def test_no_candidates_raises_engine_error(self):
        from app.errors import EngineError

        with pytest.raises(EngineError):
            tal_bot.select_move(chess.Board(), [], aggression=3)


class TestStrengthCapIsReal:
    """The invariant the whole design rests on: a weak bot must actually be weak.

    `UCI_LimitStrength` alone does not deliver this - it only perturbs the single
    `bestmove` from a `go`, leaving the multipv `info` lines full strength - so
    the node budget carries the cap and these tests guard it.
    """

    def test_node_budget_grows_with_elo_and_is_clamped(self):
        budgets = [nodes_for_elo(elo) for elo in range(1400, 3200, 200)]
        assert budgets == sorted(budgets)
        assert nodes_for_elo(MIN_UCI_ELO) == NODES_AT_MIN_ELO
        assert nodes_for_elo(50) == NODES_AT_MIN_ELO  # clamped below the range
        assert nodes_for_elo(99_999) <= MAX_CANDIDATE_NODES

    def test_full_strength_engine_has_no_node_budget(self):
        assert StockfishEngine().nodes is None
        assert StockfishEngine(elo=1320).nodes == NODES_AT_MIN_ELO

    def test_a_weak_pool_differs_from_a_strong_one(self):
        """If these came out identical, the ELO cap would be doing nothing."""
        board = chess.Board(
            "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
        )
        with StockfishEngine(elo=MIN_UCI_ELO) as engine:
            weak = engine.analyse_candidates(board, depth=12, multipv=5)
        with StockfishEngine(elo=MAX_UCI_ELO) as engine:
            strong = engine.analyse_candidates(board, depth=12, multipv=5)

        weak_evals = [(item.move.uci(), item.cp) for item in weak]
        strong_evals = [(item.move.uci(), item.cp) for item in strong]
        assert weak_evals != strong_evals

    def test_weak_bot_searches_far_fewer_nodes(self):
        board = chess.Board(GREEK_GIFT_FEN)
        with StockfishEngine(elo=MIN_UCI_ELO) as engine:
            info = engine._engine.analyse(
                board, chess.engine.Limit(depth=12, nodes=engine.nodes), multipv=1
            )
        nodes = info[0].get("nodes") if isinstance(info, list) else info.get("nodes")
        # Stockfish overshoots a tiny node budget, but not by orders of magnitude.
        assert nodes is not None and nodes < 20_000


class TestRealEngine:
    """A few genuine Stockfish calls - no mocking, matching the repo's habit."""

    def test_elo_is_clamped_to_stockfishs_supported_range(self):
        assert StockfishEngine(elo=100).elo == MIN_UCI_ELO
        assert StockfishEngine(elo=9999).elo == MAX_UCI_ELO
        assert StockfishEngine(elo=1500).elo == 1500

    def test_default_construction_is_untouched_full_strength(self):
        """The analysis pipeline's usage must be completely unaffected."""
        engine = StockfishEngine()
        assert engine.elo is None
        with engine:
            result = engine.analyse(chess.Board(), depth=8)
        assert result["best_move"] is not None

    def test_analyse_candidates_returns_a_legal_pool(self):
        board = chess.Board(GREEK_GIFT_FEN)
        with StockfishEngine(elo=1500) as engine:
            pool = engine.analyse_candidates(board, depth=10, multipv=5)

        assert 1 < len(pool) <= 5
        assert all(board.is_legal(item.move) for item in pool)
        assert len({item.move for item in pool}) == len(pool)

    def test_full_strength_pool_is_ranked_best_first(self):
        """Without a node budget the multipv lines all come from one iteration."""
        board = chess.Board(GREEK_GIFT_FEN)
        with StockfishEngine() as engine:
            pool = engine.analyse_candidates(board, depth=12, multipv=5)

        scores = [tal_bot._mover_cp(item, chess.WHITE) for item in pool]
        assert scores == sorted(scores, reverse=True)

    def test_analyse_candidates_on_a_terminal_position_is_empty(self):
        mated = chess.Board("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
        assert mated.is_checkmate()
        with StockfishEngine(elo=1500) as engine:
            assert engine.analyse_candidates(mated, depth=8) == []

    @pytest.mark.parametrize("aggression", [1, 3, 5])
    def test_choose_bot_move_returns_a_legal_move(self, aggression):
        board = chess.Board(GREEK_GIFT_FEN)
        move = tal_bot.choose_bot_move(board, elo=1500, aggression=aggression)
        assert board.is_legal(move)


class _RecordingEngine:
    """Stand-in for StockfishEngine that records how it was built and called.

    Keeps the tier-routing tests free of multi-second real searches; the real
    engine is exercised once, below, by `TestGrandmasterRealEngine`.
    """

    instances: list["_RecordingEngine"] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.calls: list[dict] = []
        _RecordingEngine.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return None

    def analyse_candidates(self, board, **kwargs):
        self.calls.append(kwargs)
        return candidates(board, ("O-O", 40), ("Bxh7+", 10))


@pytest.fixture
def recording_engine(monkeypatch):
    _RecordingEngine.instances = []
    monkeypatch.setattr(tal_bot, "StockfishEngine", _RecordingEngine)
    return _RecordingEngine


class TestGrandmasterRouting:
    """Which engine `choose_bot_move` builds, per tier. No real search."""

    def test_sentinel_sits_above_stockfishs_own_ceiling(self):
        """Otherwise it could collide with a genuine tunable UCI_Elo value."""
        assert tal_bot.GRANDMASTER_ELO > MAX_UCI_ELO
        assert tal_bot.GRANDMASTER_SEARCH_DEPTH > tal_bot.BOT_SEARCH_DEPTH

    def test_grandmaster_opens_an_unrestricted_engine(self, recording_engine):
        board = chess.Board(GREEK_GIFT_FEN)
        tal_bot.choose_bot_move(board, elo=tal_bot.GRANDMASTER_ELO, aggression=3)

        engine = recording_engine.instances[0]
        # elo=None is what makes it full strength: no configure(), no node cap.
        assert engine.kwargs["elo"] is None
        assert engine.kwargs["depth"] == tal_bot.GRANDMASTER_SEARCH_DEPTH
        assert engine.calls[0]["depth"] == tal_bot.GRANDMASTER_SEARCH_DEPTH
        assert engine.calls[0]["time_limit"] == tal_bot.GRANDMASTER_TIME_LIMIT_S
        assert engine.calls[0]["multipv"] == tal_bot.GRANDMASTER_MULTIPV
        # Deliberately *narrower* than the practice tiers (it used to be wider).
        # MultiPV costs depth: every extra line has to be refuted to the same
        # depth as the line actually being played. This is the tier that has to
        # be strong, so it spends the budget on the top lines instead - while
        # still leaving the personality scorer several candidates to pick from.
        assert tal_bot.GRANDMASTER_MULTIPV < tal_bot.BOT_MULTIPV
        assert tal_bot.GRANDMASTER_MULTIPV >= 5

    @pytest.mark.parametrize("elo", [800, 1500, 2000, 2500, tal_bot.GRANDMASTER_ELO - 1])
    def test_normal_tiers_still_take_the_elo_capped_path(self, recording_engine, elo):
        """The beatable practice tiers must be untouched by the new branch."""
        board = chess.Board(GREEK_GIFT_FEN)
        tal_bot.choose_bot_move(board, elo=elo, aggression=3)

        engine = recording_engine.instances[0]
        # no depth override, elo passed through; reuse_process=True is the
        # shared-Stockfish-process opt-in every bot-tier engine now sets.
        assert engine.kwargs == {"elo": elo, "reuse_process": True}
        assert engine.calls[0]["depth"] == tal_bot.BOT_SEARCH_DEPTH
        assert engine.calls[0]["time_limit"] is None  # keeps the 1.5s default
        assert engine.calls[0]["multipv"] == tal_bot.BOT_MULTIPV

    def test_above_the_sentinel_is_also_grandmaster(self, recording_engine):
        board = chess.Board(GREEK_GIFT_FEN)
        tal_bot.choose_bot_move(board, elo=9999, aggression=1)
        assert recording_engine.instances[0].kwargs["elo"] is None

    def test_grandmaster_still_applies_the_aggression_rerank(self, recording_engine):
        """Full strength keeps the Tal flavour: the pool is still re-ranked."""
        board = chess.Board(GREEK_GIFT_FEN)
        # The stub pool has Bxh7+ 30cp behind O-O: inside level 5's tolerance.
        sharp = tal_bot.choose_bot_move(
            board, elo=tal_bot.GRANDMASTER_ELO, aggression=5
        )
        precise = tal_bot.choose_bot_move(
            board, elo=tal_bot.GRANDMASTER_ELO, aggression=1
        )
        assert board.san(sharp) == "Bxh7+"
        assert board.san(precise) == "O-O"


class TestGrandmasterRealEngine:
    """One genuine unrestricted search, matching the repo's real-engine habit."""

    def test_grandmaster_engine_has_no_cap_and_no_node_budget(self):
        engine = StockfishEngine(elo=None, depth=tal_bot.GRANDMASTER_SEARCH_DEPTH)
        assert engine.elo is None
        assert engine.nodes is None

    def test_choose_bot_move_plays_a_legal_grandmaster_move(self):
        board = chess.Board(GREEK_GIFT_FEN)
        move = tal_bot.choose_bot_move(
            board, elo=tal_bot.GRANDMASTER_ELO, aggression=3
        )
        assert board.is_legal(move)
