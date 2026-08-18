"""Pydantic schema for GET /api/gambits — the "Choose Your Gambit" data source.

Serialises `app.services.gambits.Gambit` directly; the frontend generates its
picker entirely from this, so a new gambit only ever needs a JSON entry (see
`app/data/gambits.json`), never a UI change.
"""

from pydantic import BaseModel, ConfigDict


class GambitWeightsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    development: float
    king_attack: float
    center_control: float
    sacrifice: float


class GambitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    side: str
    eco: str
    starting_moves: list[str]
    description: str
    style: list[str]
    aggression_level: int
    recommended_response: str
    weights: GambitWeightsOut


class GambitListResponse(BaseModel):
    gambits: list[GambitOut]
