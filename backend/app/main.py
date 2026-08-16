"""ChessScope API application."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.errors import ChessScopeError
from app.routers import analysis, auth, bot_games, games, imports, lichess, players, ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ChessScope API",
    version="0.1.0",
    description="Self-hosted chess analysis: PGN import, Stockfish analysis, accuracy.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ChessScopeError)
async def chessscope_error_handler(_: Request, exc: ChessScopeError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(RequestValidationError)
async def request_validation_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    """Keep FastAPI's body/query validation errors in the standard shape."""
    return JSONResponse(
        status_code=422,
        content={
            "error": "VALIDATION_ERROR",
            "message": "Request payload failed validation.",
            "detail": {"errors": _serialisable_errors(exc)},
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred.",
            "detail": {},
        },
    )


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}


app.include_router(games.router, prefix="/api")
app.include_router(lichess.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(bot_games.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(players.router, prefix="/api")
app.include_router(ws.router)


def _serialisable_errors(exc: RequestValidationError) -> list[dict]:
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "loc": [str(part) for part in error.get("loc", [])],
                "msg": error.get("msg", ""),
                "type": error.get("type", ""),
            }
        )
    return errors
