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
