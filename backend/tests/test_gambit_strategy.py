"""The gambit/opponent-adaptation layer bolted onto tal_bot's existing
personality re-rank. The core guarantee: the gambit's *score* terms
(`personality_multiplier`, `candidate_bonus`) can only ever break a tie among
moves tal_bot's tolerance gate has already accepted — they can never rescue a
candidate that gate rejected, and a gambit move that isn't even in the
candidate pool can never be chosen regardless. The one deliberate exception is
eligibility itself for the gambit's own next scripted move, which gets a
separate, wider ceiling (`GAMBIT_LINE_MAX_CP_LOSS`) than the aggression
table — pre-vetted opening theory, not a preference — but that ceiling is
still a real cap, not unconditional.
"""

import chess

from app.services import gambits, tal_bot
from app.services.engine_pool import CandidateMove
from app.services.gambit_strategy import NO_GAMBIT_CONTEXT, build_context, candidate_bonus
from app.services.opponent_style import NEUTRAL_PROFILE


def candidates(board: chess.Board, *pairs: tuple[str, int]) -> list[CandidateMove]:
    return [CandidateMove(move=board.parse_san(san), cp=cp, mate=None) for san, cp in pairs]


class TestBuildContext:
    def test_no_gambit_is_no_gambit_status(self):
        context = build_context(chess.Board(), None, [], chess.WHITE, True)
        assert context.status == "no_gambit"
        assert context.gambit is None

    def test_fresh_board_on_the_gambit_side_is_active_with_a_next_move(self):
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(chess.Board(), gambit, [], chess.WHITE, True)
        assert context.status == "active"
        assert context.next_move_san == "e4"

    def test_still_on_line_mid_way_through(self):
        gambit = gambits.get_gambit("kings_gambit")
        board = chess.Board()
        board.push_san("e4")
        board.push_san("e5")
        moves = [("e4", "e2e4", chess.WHITE), ("e5", "e7e5", chess.BLACK)]
        context = build_context(board, gambit, moves, chess.WHITE, True)
        assert context.status == "active"
        assert context.next_move_san == "f4"

    def test_opponent_deviation_marks_the_gambit_deviated(self):
        gambit = gambits.get_gambit("kings_gambit")
        board = chess.Board()
        board.push_san("e4")
        board.push_san("c5")  # Sicilian, not 1...e5 — off the King's Gambit line
        moves = [("e4", "e2e4", chess.WHITE), ("c5", "c7c5", chess.BLACK)]
        context = build_context(board, gambit, moves, chess.WHITE, True)
        assert context.status == "deviated"
        assert context.next_move_san is None

    def test_completing_the_line_is_extended_not_deviated(self):
        gambit = gambits.get_gambit("kings_gambit")
        board = chess.Board()
        for san in ("e4", "e5", "f4"):
            board.push_san(san)
        moves = [
            ("e4", "e2e4", chess.WHITE),
            ("e5", "e7e5", chess.BLACK),
            ("f4", "f2f4", chess.WHITE),
        ]
        context = build_context(board, gambit, moves, chess.WHITE, True)
        assert context.status == "extended"
        assert context.next_move_san is None

    def test_not_the_bots_turn_has_no_next_move_even_while_active(self):
        gambit = gambits.get_gambit("kings_gambit")
        board = chess.Board()
        board.push_san("e4")
        moves = [("e4", "e2e4", chess.WHITE)]
        # bot_color is WHITE but it's Black's turn — nothing scripted right now.
        context = build_context(board, gambit, moves, chess.WHITE, True)
        assert context.status == "active"
        assert context.next_move_san is None

    def test_adapt_to_opponent_off_uses_the_neutral_profile(self):
        context = build_context(
            chess.Board(), None, [("e4", "e2e4", chess.WHITE)], chess.BLACK, False
        )
        assert context.opponent is NEUTRAL_PROFILE


class TestEligibilityGuarantees:
    def test_gambit_move_absent_from_the_pool_cannot_be_chosen(self):
        """The gambit's next move isn't even a candidate here — the bonus
        function has nothing to attach to, and the engine's own top pick wins."""
        board = chess.Board()
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(board, gambit, [], chess.WHITE, True)

        pool = candidates(board, ("d4", 30), ("Nf3", 25), ("c4", 20))
        chosen = tal_bot.select_move(board, pool, aggression=5, strategy_context=context)
        assert board.san(chosen) != "e4"  # never offered, so never chosen

    def test_gambit_move_beyond_grandmaster_tolerance_still_playable(self):
        """The actual bug this eligibility exception fixes: at the tight
        Grandmaster tolerance (70cp at aggression 5), a real gambit's book
        move used to get excluded from the eligible pool entirely — even
        though nothing else was wrong with it — so the bot would silently
        abandon the very gambit line it was told to play. 100cp comfortably
        clears that 70cp ceiling, so it must still be chosen once it's the
        gambit's own next scripted move."""
        board = chess.Board()
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(board, gambit, [], chess.WHITE, True)

        pool = candidates(board, ("d4", 100), ("e4", 0))
        chosen = tal_bot.select_move(
            board, pool, aggression=5, elo=tal_bot.GRANDMASTER_ELO, strategy_context=context
        )
        assert board.san(chosen) == "e4"

    def test_gambit_move_stays_eligible_at_any_cp_loss(self):
        """Eligibility for the gambit's own scripted move is unconditional,
        not just a wider ceiling — measured necessary against real bundled
        gambits: Smith-Morra's 3.c3 declines an immediate free recapture (a
        concession an engine reads as far larger than "slightly worse"), and
        the Halloween Gambit sacrifices two knights outright. A 900cp gap —
        comfortably past any finite ceiling that would still mean anything —
        must still be chosen once it's the gambit's own next scripted move,
        exactly as a small gap already is above."""
        board = chess.Board()
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(board, gambit, [], chess.WHITE, True)

        pool = candidates(board, ("d4", 900), ("e4", 0))
        chosen = tal_bot.select_move(board, pool, aggression=5, strategy_context=context)
        assert board.san(chosen) == "e4"

    def test_only_the_exact_scripted_move_gets_the_exemption(self):
        """The unconditional eligibility is scoped to the gambit's own next
        move (e4 here) specifically — not "any move, because a gambit
        happens to be active." An unrelated weak candidate at the same huge
        cp_loss must still lose to the engine's actual best move."""
        board = chess.Board()
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(board, gambit, [], chess.WHITE, True)

        pool = candidates(board, ("d4", 900), ("a3", 0))  # a3 isn't the gambit's move
        chosen = tal_bot.select_move(board, pool, aggression=5, strategy_context=context)
        assert board.san(chosen) == "d4"

    def test_gambit_move_within_tolerance_is_preferred(self):
        """The positive case: once the gambit's move is genuinely eligible
        (within tolerance), the bonus is enough to win a close tie."""
        board = chess.Board()
        gambit = gambits.get_gambit("kings_gambit")
        context = build_context(board, gambit, [], chess.WHITE, True)

        pool = candidates(board, ("d4", 30), ("e4", 25))
        chosen = tal_bot.select_move(board, pool, aggression=5, strategy_context=context)
        assert board.san(chosen) == "e4"

    def test_no_context_is_a_pure_no_op(self):
        board = chess.Board()
        move = board.parse_san("e4")
        candidate = CandidateMove(move=move, cp=0, mate=None)
        assert candidate_bonus(board, candidate, None) == 0.0
        assert candidate_bonus(board, candidate, NO_GAMBIT_CONTEXT) == 0.0
