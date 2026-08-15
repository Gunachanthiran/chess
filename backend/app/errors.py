"""Application error hierarchy.

Every router raises one of these instead of HTTPException so that the JSON
response body always has the same shape:

    {"error": "CODE", "message": "human readable", "detail": {}}
"""

from typing import Any


class ChessScopeError(Exception):
    """Base class for all application errors."""

    status_code: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        detail: dict[str, Any] | None = None,
        *,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail or {}
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.code, "message": self.message, "detail": self.detail}


class NotFoundError(ChessScopeError):
    status_code = 404
    code = "NOT_FOUND"


class ValidationError(ChessScopeError):
    status_code = 400
    code = "VALIDATION_ERROR"


class ConflictError(ChessScopeError):
    """Request is well-formed but the resource is not in the required state."""

    status_code = 409
    code = "CONFLICT"


class EngineError(ChessScopeError):
    status_code = 500
    code = "ENGINE_ERROR"


class ExternalAPIError(ChessScopeError):
    status_code = 502
    code = "EXTERNAL_API_ERROR"
