#!/bin/sh
# Same reasoning as start-api.sh: a script file instead of an inline
# `dockerCommand` string, since Render doesn't run that field through a real
# shell. This one backgrounds the actual Celery worker plus `beat` (the
# scheduler that actually fires celery_app.py's `beat_schedule` - a worker
# alone never runs a periodic task on its own) and keeps the stub health app
# in the foreground (see app/worker_health.py for why).
#
# `--schedule` points beat's own "when did each periodic task last run" file
# at /tmp rather than the working directory - this container's filesystem is
# ephemeral across deploys/restarts either way, so this changes nothing about
# durability, just keeps it out of the app source tree.

celery -A app.celery_app worker --loglevel=info --concurrency=1 &
celery -A app.celery_app beat --loglevel=info --schedule=/tmp/celerybeat-schedule &
exec uvicorn app.worker_health:app --host 0.0.0.0 --port "${PORT:-8000}"
