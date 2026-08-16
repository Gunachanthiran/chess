/**
 * Shared domain types. These mirror the frozen backend API contract exactly —
 * field names must not be renamed or camel-cased here.
 */

export type GameSource = 'upload' | 'lichess' | 'chess_com';

export type Game = {
  id: string;
  source: GameSource;
  lichess_game_id: string | null;
  /** Set for games pulled in by a Chess.com bulk import. */
  chess_com_game_id: string | null;
  /** The account a bulk import was run for — i.e. whose game this is. */
  imported_username: string | null;
  /** Present on a single-game fetch (GET /api/games/{id}); omitted from list
   * responses (GET /api/games) — nothing in the frontend reads it, and
   * shipping full PGN text for up to 200 games per page was pure waste. */
  pgn?: string;
  white_name: string;
  black_name: string;
  white_elo: number | null;
  black_elo: number | null;
  result: string;
  eco: string | null;
  opening_name: string | null;
  played_at: string | null;
  created_at: string;
  /** The most recently completed analysis job's id, or null if never
   * analysed — lets a dashboard card link straight to `/analysis/{this}`
   * ("Reviewed") instead of starting a new job. */
  latest_completed_job_id: string | null;
};

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AnalysisJob = {
  id: string;
  game_id: string;
  status: JobStatus;
  progress_pct: number;
  error_message: string | null;
  white_accuracy: number | null;
  black_accuracy: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced';

export type Side = 'white' | 'black';

export type MoveAnalysis = {
  id: string;
  job_id: string;
  ply: number;
  move_number: number;
  side: Side;
  fen_before: string;
  san: string;
  uci: string;
  eval_cp_before: number | null;
  eval_cp_after: number | null;
  mate_before: number | null;
  mate_after: number | null;
  best_move_uci: string;
  best_move_eval_cp: number | null;
  win_pct_before: number;
  win_pct_after: number;
  classification: Classification;
};

/** Response shape of GET /api/analysis/jobs/{job_id}/moves */
export type MoveAnalysisResponse = {
  moves: MoveAnalysis[];
  white_accuracy: number;
  black_accuracy: number;
};

/** Response shape of GET /api/games */
export type GameListResponse = {
  games: Game[];
  total: number;
};

/* ---------- Bulk import ---------- */

export type ImportSource = 'lichess' | 'chess_com';

export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ImportJob = {
  id: string;
  source: ImportSource;
  username: string;
  /** Epoch milliseconds, or null for "no lower bound". */
  since_ms: number | null;
  /** Epoch milliseconds, or null for "no upper bound". */
  until_ms: number | null;
  max_games: number;
  status: ImportJobStatus;
  progress_pct: number;
  games_found: number;
  games_imported: number;
  games_skipped: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/** Body of POST /api/imports. */
export type CreateImportRequest = {
  source: ImportSource;
  username: string;
  since?: number;
  until?: number;
  max_games?: number;
};

/** Envelope returned by every /api/imports endpoint. */
export type ImportJobResponse = {
  job: ImportJob;
};

/* ---------- Play against the bot ---------- */

/** Side the human picks when starting a bot game. */
export type BotColor = 'white' | 'black';

export type BotGameStatus = 'in_progress' | 'checkmate' | 'stalemate' | 'draw' | 'resigned';

export type BotGameMove = {
  id: string;
  ply: number;
  side: Side;
  san: string;
  uci: string;
  fen_after: string;
  is_bot_move: boolean;
};

export type BotGame = {
  id: string;
  player_color: BotColor;
  bot_elo: number;
  bot_aggression: number;
  status: BotGameStatus;
  result: string | null;
  moves: BotGameMove[];
  /**
   * Opening the game is currently in, recomputed server-side on every response.
   * Both are null once the game has left known theory.
   */
  opening_eco: string | null;
  opening_name: string | null;
  created_at: string;
  updated_at: string;
};

/** Body of POST /api/bot-games */
export type CreateBotGameRequest = {
  player_color: BotColor;
  bot_elo: number;
  bot_aggression: number;
};

/** Body of POST /api/bot-games/{id}/moves — `e2e4`, or `e7e8q` when promoting. */
export type SubmitBotMoveRequest = {
  uci: string;
};

/** Envelope returned by every /api/bot-games endpoint. */
export type BotGameResponse = {
  bot_game: BotGame;
};

/**
 * Lighter `BotGame` for list views (the dashboard's Bots tab and its
 * "game in progress" banner) — `move_count` instead of the full move list.
 */
export type BotGameSummary = {
  id: string;
  player_color: BotColor;
  bot_elo: number;
  bot_aggression: number;
  status: BotGameStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
  move_count: number;
  opening_eco: string | null;
  opening_name: string | null;
};

/** Response shape of GET /api/bot-games */
export type BotGameSummaryListResponse = {
  bot_games: BotGameSummary[];
  total: number;
};

/* ---------- Login (Lichess OAuth / Chess.com connect) ---------- */

export type AccountConnection = {
  username: string;
  connected_at: string;
};

/** Response shape of GET /api/auth/status */
export type AuthStatus = {
  lichess: AccountConnection | null;
  chess_com: AccountConnection | null;
};

/** Response shape of POST /api/auth/chesscom/connect */
export type ConnectResponse = {
  job_id: string;
  username: string;
};

/* ---------- Board UI ---------- */

/**
 * One legal destination for a piece the player has picked up. Client-side only
 * — derived from chess.js, never sent to or received from the backend.
 */
export type LegalMoveTarget = {
  /** Destination square, e.g. `e4`. */
  to: string;
  /** True when landing there takes a piece (en passant included). */
  capture: boolean;
};

/** Uniform error body returned by the backend for any non-2xx response. */
export type ApiErrorBody = {
  error: string;
  message: string;
  detail?: unknown;
};

/** A single frame pushed over WS /ws/analysis/{job_id}. */
export type AnalysisProgressFrame = {
  status: JobStatus;
  progress_pct: number;
  white_accuracy?: number;
  black_accuracy?: number;
  error?: string;
};

/** A single frame pushed over WS /ws/import/{import_job_id}. */
export type ImportProgressFrame = {
  status: ImportJobStatus;
  progress_pct: number;
  games_found?: number;
  games_imported?: number;
  games_skipped?: number;
  error?: string;
};
