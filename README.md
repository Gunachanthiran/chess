# ChessScope

Self-hosted chess analysis platform. This is **Milestone 1: Core Analysis MVP** — PGN upload / Lichess import, async Stockfish analysis with live progress, move classification, accuracy, and an interactive board.

Not included yet (future milestones): Opening Trainer, AI Coach, sound/themes, Docker hardening.

## Prerequisites

- Docker Desktop
- [Homebrew](https://brew.sh) + Stockfish: `brew install stockfish`
- Python 3.12+
- Node 20+

## Setup

### 1. Infra (Postgres + Redis)

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # adjust STOCKFISH_PATH if `which stockfish` differs
alembic upgrade head
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Run the Celery worker (separate terminal, same venv):

```bash
celery -A app.celery_app worker --loglevel=info --concurrency=1
```

One worker process is deliberate: a single analysis job already parallelises
itself across `ANALYSIS_POOL_SIZE` Stockfish processes
(`ANALYSIS_POOL_SIZE x ANALYSIS_POOL_THREADS_PER_ENGINE` = 8 search threads by
default). Running two jobs at once would oversubscribe the CPU and make both
slower than either alone.

Optionally, run `celery beat` too (separate terminal, same venv) if you want
your connected Lichess/Chess.com accounts to sync automatically once a day
instead of only when you click "Sync latest games" — the worker above
executes tasks, but only `beat` actually schedules the daily one
(`app/celery_app.py`'s `beat_schedule`):

```bash
celery -A app.celery_app beat --loglevel=info
```

Run backend tests:

```bash
pytest
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173.

## Architecture

- `backend/app` — FastAPI app (routers, services, models, Celery task)
- `frontend/src` — React + TypeScript + Vite app
- Postgres stores games, analysis jobs, and per-move analysis
- Redis is the Celery broker and also carries live progress via pub/sub, forwarded to the browser over a WebSocket

See `docker-compose.yml` for the infra services and `.env.example` for configuration.

## Deploying

`render.yaml` is a [Render](https://render.com) Blueprint that provisions everything — the API, the Celery worker, Postgres, a Redis-compatible Key Value store, and the static frontend build — from one repo. In Render's dashboard: **New → Blueprint**, pick this repo, review, deploy.

A few things worth knowing about the free tier before relying on it:

- **Free web services spin down after 15 minutes idle** and take ~1 minute to wake back up on the next request. This applies to the API and (see below) the worker.
- **Free Postgres databases expire 30 days after creation** unless upgraded to a paid plan first (14-day warning). Not a one-time gotcha — it recurs every 30 days on the free plan.
- **Free Key Value (Redis) doesn't persist across restarts.** Fine here: it's only a Celery broker and ephemeral progress pub/sub, never a data store.
- **Render's free plan has no Background Worker option** — only Web Services, Postgres, Key Value, and Static Sites are free. `render.yaml` works around this by running the Celery worker as a *Web Service*: the real `celery worker` process runs in the background, alongside a two-route stub app (`app/worker_health.py`) in the foreground purely so Render sees a bound port. See the comments in `render.yaml` and `backend/Dockerfile` for the exact mechanism.
- **Stockfish is deliberately weaker on the free worker** (`STOCKFISH_DEPTH=14`, single-threaded, a small hash table) to fit a free instance's limited CPU/RAM — analysis will be visibly slower and shallower than local. All of these are plain env vars on the `chessscope-worker` service in Render's dashboard, adjustable any time with no redeploy.
- Service names in `render.yaml` (e.g. `chessscope-api`) become the default `*.onrender.com` subdomain *if available* — if Render has to suffix a taken name, update the affected `BACKEND_BASE_URL`/`FRONTEND_BASE_URL`/`CORS_ORIGINS`/`VITE_API_BASE_URL` values to match and redeploy.
