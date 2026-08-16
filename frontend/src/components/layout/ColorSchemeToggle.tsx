import { useColorScheme } from '../../lib/colorScheme';

/**
 * Sun/moon switch for the site-wide dark/light-and-gold preference. Lives in
 * the header next to the connection indicator; reads its own state from
 * `useColorScheme()` so no page needs to wire anything through.
 */
export function ColorSchemeToggle() {
  const { scheme, toggleScheme } = useColorScheme();
  const isLight = scheme === 'light';

  return (
    <button
      type="button"
      className="app__theme-toggle"
      onClick={toggleScheme}
      title={isLight ? 'Switch to dark theme' : 'Switch to light & gold theme'}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light and gold theme'}
      aria-pressed={isLight}
    >
      {isLight ? '☀️' : '🌙'}
    </button>
  );
}
