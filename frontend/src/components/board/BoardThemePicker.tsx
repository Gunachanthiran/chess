import { BOARD_THEMES, BOARD_THEME_ORDER, useBoardTheme } from '../../lib/boardTheme';

/**
 * Row of swatch buttons for the site-wide board colour scheme, sized to sit
 * next to the mute toggle in a `.controls` row.
 *
 * Swatches rather than a `<select>`: the choice *is* a colour, so showing the
 * two square colours themselves is more direct than naming them, and four
 * options is few enough to lay out flat. It reads its own state from
 * `useBoardTheme()`, so the pages that render it need no theme wiring at all.
 */
export function BoardThemePicker() {
  const { theme, setTheme } = useBoardTheme();

  return (
    <div className="theme-picker" role="group" aria-label="Board theme">
      {BOARD_THEME_ORDER.map((option) => {
        const colors = BOARD_THEMES[option];
        const isActive = option === theme;
        return (
          <button
            key={option}
            type="button"
            className={`theme-swatch${isActive ? ' theme-swatch--active' : ''}`}
            onClick={() => setTheme(option)}
            title={`${colors.label} board`}
            aria-label={`${colors.label} board theme`}
            aria-pressed={isActive}
          >
            {/* Two halves, split diagonally by the flex row plus a skew-free
                clip — the same "half light, half dark" cue chess sites use. */}
            <span
              className="theme-swatch__half"
              style={{ backgroundColor: colors.light }}
              aria-hidden="true"
            />
            <span
              className="theme-swatch__half"
              style={{ backgroundColor: colors.dark }}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
