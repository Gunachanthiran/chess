import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DashboardPage } from './routes/DashboardPage';
import { LoginPage } from './routes/LoginPage';
import { AnalyzeLandingPage } from './routes/AnalyzeLandingPage';
import { PlayerSearchPage } from './routes/PlayerSearchPage';
import { AnalysisRoute } from './routes/AnalysisRoute';
import { PlayBotSetupRoute } from './routes/PlayBotSetupRoute';
import { PlayBotRoute } from './routes/PlayBotRoute';
import { GameLibraryPage } from './components/layout/GameLibraryPage';
import { ColorSchemeToggle } from './components/layout/ColorSchemeToggle';
import { PanelSkeleton } from './components/common/Skeleton';
import { IconAnalyze, IconDashboard, IconLibrary, IconPlay, IconPlayers } from './components/common/Icons';
import { useBotGame } from './hooks/useBotGame';
import { useAccountStatus } from './hooks/useAccountStatus';
import { unlockAudio } from './lib/sound';
import './App.css';

/**
 * Nav sections. Several routes map onto one section — starting an analysis
 * and reading a finished one back are both "Analyze" as far as the user is
 * concerned.
 */
type NavSection = 'dashboard' | 'analyze' | 'library' | 'play' | 'players';

function sectionForPath(pathname: string): NavSection {
  if (pathname.startsWith('/library')) return 'library';
  // Checked before `/play`, which `/players` would otherwise also match —
  // `startsWith('/play')` doesn't stop at the path segment boundary, so
  // `/players` needs to be ruled out first rather than made a prefix of it.
  if (pathname.startsWith('/players')) return 'players';
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

  // On a narrow viewport `.app__nav` scrolls horizontally within itself
  // (App.css) rather than overflowing the page, which means the active tab
  // can land off-screen — five items' natural width no longer fits one row
  // on a phone. Scrolling it into view on every section change keeps "where
  // am I" visible without requiring a manual swipe first.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // `inline: 'end'`, not `'nearest'` — `'nearest'` treats an element that is
    // even partially visible as already satisfied and never finishes the
    // scroll, which is exactly the half-cut-off state this is meant to fix.
    navRef.current
      ?.querySelector('.app__nav-link--active')
      ?.scrollIntoView({ inline: 'end', block: 'nearest' });
    // `connected` is a dependency, not just `activeSection`: `<nav>` is only
    // rendered at all once `connected` becomes true (below), so the very
    // first opportunity `navRef.current` is non-null arrives on *that*
    // transition, not on a section change — a `[activeSection]`-only effect
    // would run once too early (nav doesn't exist yet, a harmless no-op) and
    // then never again, since the URL-derived section it depends on hasn't
    // itself changed.
  }, [activeSection, connected]);

  const navItems: {
    section: NavSection;
    label: string;
    path: string;
    Icon: (props: { className?: string }) => ReactElement;
  }[] = [
    { section: 'dashboard', label: 'Dashboard', path: '/', Icon: IconDashboard },
    { section: 'analyze', label: 'Analyze', path: '/analyze', Icon: IconAnalyze },
    { section: 'library', label: 'Library', path: '/library', Icon: IconLibrary },
    { section: 'play', label: 'Play Bot', path: '/play', Icon: IconPlay },
    { section: 'players', label: 'Players', path: '/players', Icon: IconPlayers },
  ];

  const connectedName = status?.lichess?.username ?? status?.chess_com?.username ?? null;

  return (
    <div className="app">
      {/* Persistent left sidebar on desktop; the same markup collapses into a
          horizontal top bar under `.app__sidebar`'s own mobile media query
          (App.css) rather than rendering two separate nav structures. */}
      <aside className="app__sidebar">
        <h1 className="app__brand">
          Chess<span className="app__title-accent">Scope</span>
        </h1>

        {/* No point navigating around a gated app before there's anything
            behind the gate — the nav only appears once connected. */}
        {connected && (
          <nav className="app__nav" aria-label="Main" ref={navRef}>
            {navItems.map((item) => {
              const isActive = item.section === activeSection;
              return (
                <button
                  key={item.section}
                  type="button"
                  className={`app__nav-link${isActive ? ' app__nav-link--active' : ''}`}
                  onClick={() => navigate(item.path)}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.label}
                >
                  <item.Icon className="app__nav-icon" />
                  <span className="app__nav-label">{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* The mute toggle stays with the board — `useSoundEffects` is owned by
            each playing/analysing page, so a copy up here would have its own
            disconnected state. This keeps the sidebar foot balanced instead. */}
        <div className="app__sidebar-foot">
          {connectedName ? (
            <button
              type="button"
              className="app__connected"
              onClick={() => navigate('/login')}
              title="Manage connected accounts"
            >
              <span className="app__connected-label">Connected as {connectedName}</span>
            </button>
          ) : (
            <p className="app__tagline">Self-hosted game analysis</p>
          )}
          <ColorSchemeToggle />
        </div>
      </aside>

      <div className="app__body">
        <main className="app__main">
          {accountLoading || gateBlocksRender ? (
            <PanelSkeleton />
          ) : (
            <Routes>
              <Route path="/login" element={<LoginPage account={account} />} />
              <Route path="/" element={<DashboardPage account={account} />} />
              <Route path="/analyze" element={<AnalyzeLandingPage />} />
              <Route path="/library" element={<GameLibraryPage />} />
              <Route path="/analysis/:jobId" element={<AnalysisRoute />} />
              <Route path="/play" element={<PlayBotSetupRoute bot={bot} />} />
              <Route path="/play/:gameId" element={<PlayBotRoute bot={bot} />} />
              <Route path="/players" element={<PlayerSearchPage />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}
