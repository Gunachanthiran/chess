"""Stub ASGI app for the Celery worker's Render service.

Render's free plan is only available to services that bind an HTTP port and
respond to health checks — background workers are explicitly excluded from
the free plan. The worker service therefore runs the real Celery worker as a
background process and this trivial app in the foreground, purely so Render
sees a live port. It is not part of the actual application otherwise: no
router here is ever reached by the frontend or by any other service.

Render also spins a free web service down after 15 minutes with no *inbound*
HTTP traffic — a check that only looks at requests hitting the public URL,
not at CPU/background activity. Nothing else in this system ever calls this
service's routes (the API just pushes onto Redis and returns), so left alone
this container goes to sleep the first time nobody starts an analysis for 15
minutes — then the *next* job someone queues sits waiting for a cold start
before the worker even picks it up, which is what a job stuck at "queued,
waiting for an engine slot" actually is. `_keepalive` below pings this
service's own public URL well inside that window so it never goes idle long
enough to be spun down in the first place.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Comfortably under Render's 15-minute free-tier idle threshold.
KEEPALIVE_INTERVAL_S = 600.0


async def _keepalive() -> None:
    # Render sets this automatically for every web service; local/dev runs
    # never have it, so the loop is simply never started there (see
    # `lifespan` below) rather than pinging localhost, which wouldn't touch
    # Render's traffic detector at all even if it did run.
    url = os.environ["RENDER_EXTERNAL_URL"]
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            await asyncio.sleep(KEEPALIVE_INTERVAL_S)
            try:
                await client.get(url)
            except httpx.HTTPError as exc:
                # Best-effort: a missed ping just means the *next* one (10
                # minutes away, still inside the 15-minute window) tries
                # again. Never worth taking the worker down over.
                logger.warning("Worker keepalive ping failed: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    task = (
        asyncio.create_task(_keepalive())
        if "RENDER_EXTERNAL_URL" in os.environ
        else None
    )
    try:
        yield
    finally:
        if task is not None:
            task.cancel()


app = FastAPI(title="ChessScope worker health stub", lifespan=lifespan)


@app.get("/")
def health() -> dict:
    return {"status": "ok", "role": "celery-worker"}
