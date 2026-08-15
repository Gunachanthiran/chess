#!/bin/sh
# Render's `dockerCommand` field does not reliably interpret inline shell
# operators like `&&` (confirmed against a real deploy: it was passed the
# whole string, literally, as a single command name). A script file sidesteps
# that entirely — Render only ever needs to exec this one unambiguous path.
set -e

alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
