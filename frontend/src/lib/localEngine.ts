import { Chess } from 'chess.js';
import type { ExplorePositionResult, TopMove } from '../types';

/**
 * Browser-side Stockfish for the analysis page's "explore" preview (drag any
 * move, see a live eval instantly) — a self-hosted WASM build running in a
 * Web Worker, so this never touches the network. Unrelated to real game
 * analysis, which stays server-side for consistency/depth; this only ever
 * backs the live "what if I play this" read. See `public/engine/NOTICE.md`
 * for the engine's own license/source (GPLv3, nmrugg/stockfish.js).
 *
 * One Worker, module-level and lazily created: every caller across the app
 * shares it rather than spinning up a fresh ~7MB WASM instance per component.
 */

const ENGINE_SCRIPT_URL = '/engine/stockfish-18-lite-single.js';
const MULTIPV = 3;
const SEARCH_DEPTH = 14;
/** Safety valve, not the normal exit path: `go depth 14` on the lite single-
 * threaded build finishes well under this on real hardware. Only a very slow
 * device would ever hit it, and it must still resolve with whatever the
 * engine has found so far rather than hang the preview indefinitely. */
const SEARCH_TIMEOUT_MS = 4000;

type EvalLine = { cp: number | null; mate: number | null; pvUci: string[] };
type Request = { fen: string; resolve: (result: ExplorePositionResult) => void };

let worker: Worker | null = null;
let readyPromise: Promise<Worker> | null = null;

// Exactly one search in flight on the shared worker at a time - UCI engines
// don't support overlapping searches, so a second request while one is
// running is queued (superseding any request already queued behind it) and
// only actually started once the current search's own `bestmove` confirms
// the engine is idle again. This is what keeps two `position`/`go` pairs
// from ever interleaving on the same worker.
let searching = false;
let activeRequest: Request | null = null;
let queuedRequest: Request | null = null;
let lines = new Map<number, EvalLine>();
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

function createWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(ENGINE_SCRIPT_URL);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Could not start the local engine worker.'));
      return;
    }

    const onError = (event: ErrorEvent) => {
      w.removeEventListener('error', onError);
      reject(event.error instanceof Error ? event.error : new Error('Local engine worker failed to load.'));
    };
    const onMessage = (event: MessageEvent<string>) => {
      if (event.data === 'uciok') {
        w.postMessage('isready');
      } else if (event.data === 'readyok') {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        resolve(w);
      }
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage('uci');
  });
}

function getWorker(): Promise<Worker> {
  if (!readyPromise) {
    readyPromise = createWorker()
      .then((w) => {
        w.postMessage(`setoption name MultiPV value ${MULTIPV}`);
        w.addEventListener('message', handleMessage);
        worker = w;
        return w;
      })
      .catch((err) => {
        // Let a later call retry from scratch rather than staying broken
        // for the rest of the session on one transient failure.
        readyPromise = null;
        throw err;
      });
  }
  return readyPromise;
}

function handleMessage(event: MessageEvent<string>): void {
  const line = event.data;
  if (typeof line !== 'string') return;

  if (line.startsWith('info') && line.includes(' pv ')) {
    parseInfoLine(line);
  } else if (line.startsWith('bestmove')) {
    onBestMove();
  }
}

function parseInfoLine(line: string): void {
  const multipvMatch = /\bmultipv (\d+)/.exec(line);
  const scoreCpMatch = /\bscore cp (-?\d+)/.exec(line);
  const scoreMateMatch = /\bscore mate (-?\d+)/.exec(line);
  const pvMatch = /\bpv (.+)$/.exec(line);
  if (!pvMatch) return;

  lines.set(multipvMatch ? Number(multipvMatch[1]) : 1, {
    cp: scoreCpMatch ? Number(scoreCpMatch[1]) : null,
    mate: scoreMateMatch ? Number(scoreMateMatch[1]) : null,
    pvUci: pvMatch[1].trim().split(/\s+/),
  });
}

function onBestMove(): void {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  const finished = activeRequest;
  activeRequest = null;
  searching = false;

  if (finished) {
    finished.resolve(buildResult(finished.fen));
  }
  lines = new Map();

  // Only start the next search now that the engine has actually confirmed
  // (via this bestmove) that it's idle - starting it any earlier risks its
  // `position`/`go` interleaving with the search that's still winding down.
  if (queuedRequest) {
    const next = queuedRequest;
    queuedRequest = null;
    startSearch(next);
  }
}

function startSearch(request: Request): void {
  if (!worker) return;
  activeRequest = request;
  searching = true;
  worker.postMessage(`position fen ${request.fen}`);
  worker.postMessage(`go depth ${SEARCH_DEPTH}`);
  timeoutHandle = setTimeout(() => {
    if (searching) worker?.postMessage('stop');
  }, SEARCH_TIMEOUT_MS);
}

function buildResult(fen: string): ExplorePositionResult {
  const sideToMove = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const sorted = [...lines.entries()].sort(([a], [b]) => a - b);

  const topMoves: TopMove[] = [];
  let bestCp: number | null = null;
  let bestMate: number | null = null;

  sorted.forEach(([, entry], position) => {
    const sans = pvToSans(fen, entry.pvUci);
    if (sans.length === 0) return;

    // UCI scores are from the side-to-move's own POV; every evaluation field
    // in this app is White-POV, matching the backend's own convention.
    const cp = entry.cp !== null && sideToMove === 'black' ? -entry.cp : entry.cp;
    const mate = entry.mate !== null && sideToMove === 'black' ? -entry.mate : entry.mate;
    topMoves.push({ sans, cp, mate });
    if (position === 0) {
      bestCp = cp;
      bestMate = mate;
    }
  });

  return { cp: bestCp, mate: bestMate, top_moves: topMoves };
}

/** UCI move sequence (`e2e4`, `e7e8q`) to SAN, stopping at the first move
 * that fails to apply rather than throwing - a partial line is still useful. */
function pvToSans(fen: string, pvUci: string[]): string[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }

  const sans: string[] = [];
  for (const uci of pvUci) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      break;
    }
    if (!move) break;
    sans.push(move.san);
  }
  return sans;
}

function hasLegalMoves(fen: string): boolean {
  try {
    return new Chess(fen).moves().length > 0;
  } catch {
    return false;
  }
}

/**
 * Evaluates one position locally, entirely in the browser. Mirrors
 * `api/analysis.ts`'s `explorePosition` response shape exactly, so callers
 * can swap between the two (or fall back from this to that on failure)
 * without touching anything downstream of the result.
 *
 * Terminal positions (checkmate/stalemate) short-circuit before ever
 * touching the engine, matching the backend's own explore endpoint.
 */
export async function evaluatePositionLocally(fen: string): Promise<ExplorePositionResult> {
  if (!hasLegalMoves(fen)) {
    return { cp: null, mate: null, top_moves: [] };
  }

  await getWorker();

  return new Promise((resolve) => {
    const request: Request = { fen, resolve };
    if (searching) {
      // Only the latest request matters for a live preview - anything
      // already queued behind an in-flight search is superseded and its
      // promise simply never resolves, the same contract an
      // AbortController-based cancellation would give.
      queuedRequest = request;
      worker?.postMessage('stop');
    } else {
      startSearch(request);
    }
  });
}
