import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted (no Google Fonts CDN call at runtime) — fits a self-hosted app,
// and both weights load from this bundle instead of a second network origin.
// `index.css`'s `font-family` referenced 'Inter' since the very first pass at
// theming, on the assumption something loaded it; nothing ever did, so every
// page has been rendering in each OS's own default UI font this whole time.
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Production only: registering a service worker under Vite's dev server
// would cache dev-mode module requests, which is exactly the kind of
// stale-asset confusion HMR exists to avoid. `import.meta.env.PROD` is
// statically replaced at build time, so this whole branch (including the
// import) is dead code - and the browser never even requests `sw.js` - in
// `npm run dev`.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal — the app works identically without it, just without the
      // "Add to Home Screen" install prompt and offline app-shell caching.
    });
  });
}
