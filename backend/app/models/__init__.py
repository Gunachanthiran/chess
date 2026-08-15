"""SQLAlchemy models. Importing this package registers every table on Base.metadata."""

from app.models.account_connection import AccountConnection, LichessOAuthState
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.bot_game import BotColor, BotGame, BotGameStatus
from app.models.bot_game_move import BotGameMove
from app.models.game import Game, GameSource
from app.models.import_job import ImportJob
from app.models.move_analysis import MoveAnalysis, MoveClassification, Side

__all__ = [
    "AccountConnection",
    "LichessOAuthState",
    "AnalysisJob",
    "JobStatus",
    "BotColor",
    "BotGame",
    "BotGameStatus",
    "BotGameMove",
    "Game",
    "GameSource",
    "ImportJob",
    "MoveAnalysis",
    "MoveClassification",
    "Side",
]
