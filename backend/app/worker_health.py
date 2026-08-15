"""Stub ASGI app for the Celery worker's Render service.

Render's free plan is only available to services that bind an HTTP port and
respond to health checks — background workers are explicitly excluded from
the free plan. The worker service therefore runs the real Celery worker as a
background process and this trivial app in the foreground, purely so Render
sees a live port. It is not part of the actual application otherwise: no
router here is ever reached by the frontend or by any other service.
"""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="ChessScope worker health stub")


@app.get("/")
def health() -> dict:
    return {"status": "ok", "role": "celery-worker"}
