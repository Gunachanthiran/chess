#!/bin/sh
# Same reasoning as start-api.sh: a script file instead of an inline
# `dockerCommand` string, since Render doesn't run that field through a real
# shell. This one backgrounds the actual Celery worker and keeps the stub
# health app in the foreground (see app/worker_health.py for why).

celery -A app.celery_app worker --loglevel=info --concurrency=1 &
exec uvicorn app.worker_health:app --host 0.0.0.0 --port "${PORT:-8000}"
