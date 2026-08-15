"""Recompute stored accuracies for completed jobs, without re-running Stockfish.

The per-move win percentages are already on `move_analysis`, so a change to the
accuracy formula only needs the aggregation replayed.

Usage (from backend/, with the venv active):

    python scripts/recompute_accuracy.py [--dry-run]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal  # noqa: E402
from app.models.analysis_job import AnalysisJob, JobStatus  # noqa: E402
from app.models.game import Game  # noqa: E402
from app.models.move_analysis import Side  # noqa: E402
from app.services import accuracy as accuracy_service  # noqa: E402


def _accuracy_for(job: AnalysisJob, side: Side) -> float:
    moves = sorted(job.moves, key=lambda move: move.ply)
    return accuracy_service.compute_side_accuracy(
        accuracy_service.mover_pov_pairs(
            move for move in moves if move.side is side
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the new numbers without writing them.",
    )
    args = parser.parse_args()

    session = SessionLocal()
    try:
        jobs = (
            session.query(AnalysisJob)
            .filter(AnalysisJob.status == JobStatus.completed)
            .order_by(AnalysisJob.created_at)
            .all()
        )
        if not jobs:
            print("No completed analysis jobs found.")
            return 0

        for job in jobs:
            game: Game | None = session.get(Game, job.game_id)
            label = (
                f"{game.white_name} vs {game.black_name} / {game.opening_name}"
                if game is not None
                else str(job.game_id)
            )

            old_white, old_black = job.white_accuracy, job.black_accuracy
            new_white = _accuracy_for(job, Side.white)
            new_black = _accuracy_for(job, Side.black)

            print(f"job {job.id}  ({label}, {len(job.moves)} plies)")
            print(f"  white: {_fmt(old_white)} -> {new_white:.2f}")
            print(f"  black: {_fmt(old_black)} -> {new_black:.2f}")

            if not args.dry_run:
                job.white_accuracy = new_white
                job.black_accuracy = new_black

        if args.dry_run:
            print("\nDry run: nothing written.")
        else:
            session.commit()
            print(f"\nUpdated {len(jobs)} job(s).")
        return 0
    finally:
        session.close()


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
