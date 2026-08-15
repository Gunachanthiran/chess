# ChessScope backend — one image, two roles (see render.yaml).
#
# The API service runs scripts/start-api.sh (this image's default CMD). The
# Celery worker service overrides it via `dockerCommand` to run
# scripts/start-worker.sh instead — the real worker plus a tiny stub ASGI app
# just to satisfy Render's free-tier "must bind a port" requirement for web
# services (background workers can't be free on Render, a web service can;
# see render.yaml). Both are real script files, not an inline shell string in
# `dockerCommand` — confirmed against a real deploy that Render does not run
# that field through a shell, so `&&`/`&` in it are never interpreted, just
# passed through literally.
FROM python:3.12-slim

# `psycopg[binary]` in requirements.txt ships a self-contained wheel, so no
# libpq headers are needed here — just Stockfish itself for actual analysis.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

# Debian's `stockfish` package installs to /usr/games — verified by the first
# deploy's build/boot log; trivial to override via the STOCKFISH_PATH env var
# if a base-image change ever moves it.
ENV STOCKFISH_PATH=/usr/games/stockfish

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY scripts/start-api.sh scripts/start-worker.sh ./scripts/
RUN chmod +x ./scripts/start-api.sh ./scripts/start-worker.sh

# Render sets $PORT; both scripts bind to it, not a hardcoded port.
CMD ["./scripts/start-api.sh"]
