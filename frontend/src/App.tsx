import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DashboardPage } from './routes/DashboardPage';
import { LoginPage } from './routes/LoginPage';
import { AnalyzeLandingPage } from './routes/AnalyzeLandingPage';
import { AnalysisRoute } from './routes/AnalysisRoute';
import { PlayBotSetupRoute } from './routes/PlayBotSetupRoute';
import { PlayBotRoute } from './routes/PlayBotRoute';
import { GameLibraryPage } from './components/layout/GameLibraryPage';
import { ColorSchemeToggle } from './components/layout/ColorSchemeToggle';
import { useBotGame } from './hooks/useBotGame';
import { useAccountStatus } from './hooks/useAccountStatus';
import { unlockAudio } from './lib/sound';
import './App.css';

/**
 * Nav sections. Several routes map onto one section — starting an analysis
 * and reading a finished one back are both "Analyze" as far as the user is
 * concerned.
 */
type NavSection = 'dashboard' | 'analyze' | 'library' | 'play';

function sectionForPath(pathname: string): NavSection {
  if (pathname.startsWith('/library')) return 'library';
  if (pathname.startsWith('/play')) return 'play';
  if (pathname.startsWith('/analyze')) return 'analyze';
  return 'dashboard';
}

/**
 * Root layout: persistent nav, the app-wide audio unlock, and the one
 * `useBotGame()` instance shared by the setup and play routes (created while
 * `/play` is still mounted, read again once navigation lands on `/play/:id`).
 * Real URLs replace what used to be an in-memory `view` state machine plus a
 * localStorage-based "remember where I was" workaround — direct visits and
 * reloads now resolve from the URL itself, the same way any other page does.
 */
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const bot = useBotGame();
  // Hoisted, not called separately by LoginPage/DashboardPage: this hook's
  // state also drives the gate below, so a second independent copy in
  // LoginPage would go stale the moment a connect/disconnect there changed
  // the database without this instance's knowledge — the exact bug that
  // first shipped here (connecting Chess.com navigated to `/`, then this
  // gate's still-stale `connected: false` immediately bounced back to
  // `/login`, one render later, before its own next fetch could catch up).
  const account = useAccountStatus();
  const { connected, loading: accountLoading, status } = account;

  // Gate: single-user, self-hosted scope means "logged in" is a property of
  // the database (see useAccountStatus), not a browser session — this just
  // redirects to /login until at least one account is connected, and never
  // touches /login itself (which is also where reconnecting/disconnecting
  // happens once signed in).
  useEffect(() => {
    if (accountLoading) return;
    if (!connected && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [accountLoading, connected, location.pathname, navigate]);

  const gateBlocksRender =
    !accountLoading && !connected && location.pathname !== '/login';

  // Warms up the AudioContext on the very first real interaction with the
  // page, well before any move sound needs to play. Move sounds are triggered
  // from an effect reacting to a server response — by the time that runs, a
  // browser's autoplay policy no longer considers it inside a trusted
  // gesture, so creating/resuming the context *there* can be silently
  // refused. Doing it here, directly inside a real gesture handler, is what
  // actually satisfies that policy.
  //
  // Listening on several event types, not just `pointerdown`, because exactly
  // which gesture a browser accepts as "trusted" for this purpose varies —
  // Safari/iOS in particular has historically been stricter than Chrome and
  // has, at various versions, wanted `touchend`/`click` specifically rather
  // than `pointerdown`. Each listener is `once: true` and calling
  // `unlockAudio()` more than once is a harmless no-op (see its own guard), so
  // covering every plausible gesture type here costs nothing.
  useEffect(() => {
    const unlock = () => unlockAudio();
    const events = ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click'] as const;
    events.forEach((name) => window.addEventListener(name, unlock, { once: true, capture: true }));
    return () => {
      events.forEach((name) => window.removeEventListener(name, unlock, { capture: true }));
    };
  }, []);

  const activeSection = sectionForPath(location.pathname);

  const navItems: { section: NavSection; label: string; path: string }[] = [
    { section: 'dashboard', label: 'Dashboard', path: '/' },
    { section: 'analyze', label: 'Analyze', path: '/analyze' },
    { section: 'library', label: 'Library', path: '/library' },
    { section: 'play', label: 'Play Bot', path: '/play' },
  ];

  const connectedName = status?.lichess?.username ?? status?.chess_com?.username ?? null;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-inner">
          <h1 className="app__title">
            Chess<span className="app__title-accent">Scope</span>
          </h1>

          {/* No point navigating around a gated app before there's anything
              behind the gate — the nav only appears once connected. */}
          {connected && (
            <nav className="app__nav" aria-label="Main">
              {navItems.map((item) => {
                const isActive = item.section === activeSection;
                return (
                  <button
                    key={item.section}
                    type="button"
                    className={`app__nav-link${isActive ? ' app__nav-link--active' : ''}`}
                    onClick={() => navigate(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}

          {/* The mute toggle stays with the board — `useSoundEffects` is owned by
              each playing/analysing page, so a copy up here would have its own
              disconnected state. This keeps the bar balanced instead. */}
          <div className="app__header-actions">
            {connectedName ? (
              <button
                type="button"
                className="app__connected"
                onClick={() => navigate('/login')}
                title="Manage connected accounts"
              >
                Connected as {connectedName}
              </button>
            ) : (
              <p className="app__tagline">Self-hosted game analysis</p>
            )}
            <ColorSchemeToggle />
          </div>
        </div>
      </header>

      <main className="app__main">
        {accountLoading || gateBlocksRender ? (
          <div className="panel">Loading…</div>
        ) : (
          <Routes>
            <Route path="/login" element={<LoginPage account={account} />} />
            <Route path="/" element={<DashboardPage account={account} />} />
            <Route path="/analyze" element={<AnalyzeLandingPage />} />
            <Route path="/library" element={<GameLibraryPage />} />
            <Route path="/analysis/:jobId" element={<AnalysisRoute />} />
            <Route path="/play" element={<PlayBotSetupRoute bot={bot} />} />
            <Route path="/play/:gameId" element={<PlayBotRoute bot={bot} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
