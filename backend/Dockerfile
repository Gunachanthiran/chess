# ChessScope backend — one image, two roles (see render.yaml).
#
# The API service runs this image's default CMD as-is. The Celery worker
# service overrides it via `dockerCommand` to run the actual worker plus a
# tiny stub ASGI app just to satisfy Render's free-tier "must bind a port"
# requirement for web services — background workers can't be free on Render,
# a web service can (see the deploy plan for why).
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

# Render sets $PORT; uvicorn must bind to it, not a hardcoded port.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
