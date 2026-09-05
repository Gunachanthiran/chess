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
  /** Accuracy off that same latest-completed job, both sides — `null` until
   * one exists. Whose side is "mine" is a client-side question (see
   * `lib/gameDisplay.ts`'s `describeMatchup`/`mySide`), so both are shipped
   * rather than the backend guessing. */
  white_accuracy: number | null;
  black_accuracy: number | null;
};

/** One point of the dashboard's accuracy trend chart. */
export type AccuracyTrendPoint = {
  played_at: string;
  accuracy: number;
};

/** Response shape of GET /api/games/stats — the dashboard stats widget.
 * Computed across *every* game, not a paginated page of them. */
export type GameStats = {
  total_games: number;
  analyzed_games: number;
  /** Mean accuracy (my side) over the most recent ~20 analysed games, or
   * `null` when nothing qualifies yet. */
  recent_accuracy: number | null;
  current_streak_days: number;
  /** Up to ~30 most recent analysed games, oldest first. */
  accuracy_trend: AccuracyTrendPoint[];
};

/** One row of GET /api/games/openings — your side's record with one opening,
 * across every analysed game. */
export type OpeningPerformance = {
  opening_name: string;
  eco: string | null;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Standard chess "score" percentage: a win counts 1, a draw 0.5. */
  score_pct: number;
  avg_accuracy: number | null;
};

export type OpeningPerformanceList = OpeningPerformance[];

/** One row of GET /api/games/phases — your own moves in one game phase. */
export type PhaseBreakdown = {
  phase: 'opening' | 'middlegame' | 'endgame';
  total_moves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  error_rate_pct: number;
};

export type PhaseBreakdownList = PhaseBreakdown[];

/** Response shape of GET /api/games/head-to-head — `games: 0` is a
 * legitimate "no resolvable game against this name" answer, not an error. */
export type HeadToHead = {
  opponent_name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  score_pct: number;
  avg_accuracy: number | null;
};

/** One tactics-trainer puzzle: a real Mistake/Blunder your own side played
 * in an analysed game, replayed from the position just before it — see
 * GET /api/puzzles. `Classification`/`Side` are declared further down this
 * file; referenced here ahead of their declaration since type declarations
 * are not order-sensitive in TypeScript. */
export type Puzzle = {
  id: string;
  game_id: string;
  fen: string;
  side_to_move: Side;
  played_san: string;
  played_uci: string;
  correct_uci: string;
  correct_san: string;
  classification: Classification;
  opening_name: string | null;
  white_name: string;
  black_name: string;
  played_at: string | null;
};

export type PuzzleListResponse = {
  puzzles: Puzzle[];
  /** Total Mistakes/Blunders available across every analysed game, before
   * capping to this one batch — e.g. to show "1 of 47". */
  total_available: number;
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
  /** Stockfish's ranked candidates for this position, best first. `null` for
   * rows analysed before this existed; `[]` is a real "nothing to suggest"
   * (a terminal position). */
  top_moves: TopMove[] | null;
};

/** One ranked candidate *line* — the engine's expected continuation for both
 * sides, not just its first move, best line first. `cp`/`mate` score the
 * position after `sans[0]` only, White-POV exactly like every other
 * evaluation field on `MoveAnalysis`. */
export type TopMove = {
  sans: string[];
  cp: number | null;
  mate: number | null;
};

/** Response shape of GET /api/analysis/jobs/{job_id}/moves */
export type MoveAnalysisResponse = {
  moves: MoveAnalysis[];
  white_accuracy: number;
  black_accuracy: number;
};

/** Response shape of POST /api/analysis/explore — an on-demand read of one
 * arbitrary position the user reached by dragging pieces, not necessarily
 * anywhere in the game's own recorded moves. White-POV, like every other
 * evaluation field in this app. */
export type ExplorePositionResult = {
  cp: number | null;
  mate: number | null;
  top_moves: TopMove[];
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

/** One entry from GET /api/gambits — the "Choose Your Gambit" data source.
 * The setup form generates its whole picker from this list; nothing about a
 * specific gambit is hard-coded on the frontend. */
export type Gambit = {
  id: string;
  name: string;
  /** Which colour this gambit belongs to — only relevant when the bot plays that colour. */
  side: BotColor;
  eco: string;
  starting_moves: string[];
  description: string;
  style: string[];
  aggression_level: number;
  recommended_response: string;
};

export type GambitListResponse = {
  gambits: Gambit[];
};

/** Where a game against the bot stands relative to its selected gambit. */
export type GambitStatus = 'no_gambit' | 'active' | 'extended' | 'deviated';

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
  gambit_id: string | null;
  adapt_to_opponent: boolean;
  status: BotGameStatus;
  result: string | null;
  moves: BotGameMove[];
  /**
   * Opening the game is currently in, recomputed server-side on every response.
   * Both are null once the game has left known theory.
   */
  opening_eco: string | null;
  opening_name: string | null;
  /**
   * Live gambit/strategy readout, likewise recomputed on every response —
   * see GameAnalysisPage-style opening fields above for the same pattern.
   */
  gambit_name: string | null;
  gambit_status: GambitStatus;
  opponent_style: string[];
  bot_strategy_summary: string | null;
  created_at: string;
  updated_at: string;
};

/** Body of POST /api/bot-games */
export type CreateBotGameRequest = {
  player_color: BotColor;
  bot_elo: number;
  bot_aggression: number;
  gambit_id: string | null;
  adapt_to_opponent: boolean;
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
  gambit_name: string | null;
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
  /** Chess.com avatar image URL, or `null` (no custom avatar, lookup failed,
   * or this is a Lichess connection — Lichess has no avatar feature). */
  avatar_url: string | null;
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

/* ---------- Player search ---------- */

export type PlayerRating = {
  format: string;
  rating: number | null;
};

/** Response shape of GET /api/players/lookup — a public profile looked up by
 * username, unrelated to any connected account. */
export type PlayerLookup = {
  source: ImportSource;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  title: string | null;
  country: string | null;
  profile_url: string | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  ratings: PlayerRating[];
};
