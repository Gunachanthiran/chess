/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the ChessScope backend HTTP API. */
  readonly VITE_API_BASE_URL?: string;
  /** Base URL for the analysis WebSocket; derived from the API URL if unset. */
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
