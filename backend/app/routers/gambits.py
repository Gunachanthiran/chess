"""GET /api/gambits — the "Choose Your Gambit" data source. Read-only: the
Play Bot setup screen generates its whole picker from this response rather
than any hard-coded list, so a new gambit only ever needs a JSON entry in
`app/data/gambits.json`."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.gambit import GambitListResponse, GambitOut
from app.services import gambits as gambits_service

router = APIRouter(prefix="/gambits", tags=["gambits"])


@router.get("", response_model=GambitListResponse)
def list_gambits() -> GambitListResponse:
    return GambitListResponse(
        gambits=[GambitOut.model_validate(gambit) for gambit in gambits_service.list_gambits()]
    )
