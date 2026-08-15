import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthStatus } from '../api/auth';
import { errorMessage } from '../api/client';
import type { AuthStatus } from '../types';

export type UseAccountStatusResult = {
  status: AuthStatus | null;
  /** True only until the first fetch resolves — used to hold the route guard
   * off (see App.tsx) so a fresh page load doesn't flash-redirect to /login
   * before we actually know whether an account is connected. */
  loading: boolean;
  error: string | null;
  /** True once `status` has loaded and at least one platform is connected. */
  connected: boolean;
  /**
   * Re-fetches and resolves once `status` has actually been updated.
   * Callers that navigate right after a connect/disconnect (see LoginPage)
   * must `await` this rather than fire-and-forget it — this hook is hoisted
   * once in App.tsx and shared with the route guard there, so navigating on
   * a still-stale status would have the guard's own next render bounce
   * straight back to /login before the fetch below had a chance to land.
   */
  refresh: () => Promise<AuthStatus | null>;
};

/** Fetch-on-mount status of the Lichess/Chess.com connection — see
 * `api/auth.ts::getAuthStatus`. Single-user scope: this is a property of the
 * deployment, not a per-browser session, so there is nothing to persist
 * client-side beyond the usual re-fetch-on-mount.
 *
 * Hoisted once in App.tsx (see the comment there) rather than called
 * separately by every page that needs it — LoginPage and DashboardPage both
 * receive the same instance as a prop. */
export function useAccountStatus(): UseAccountStatusResult {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // This hook lives for the app's whole lifetime (see App.tsx), so a ref
  // guard against a genuinely rare unmount-mid-fetch race is enough — no
  // AbortController machinery needed for a hook that essentially never
  // unmounts before the page itself navigates away.
  //
  // The reset-to-true has to happen inside the effect body, not just at
  // `useRef`'s initial value — React 18 StrictMode double-invokes effects in
  // development (mount, cleanup, mount again) to surface exactly this kind
  // of bug. A cleanup-only assignment left `mountedRef.current` stuck
  // `false` after that synthetic first cleanup, permanently, since nothing
  // ever flipped it back — every `refresh()` after that silently no-opped
  // and `loading` never left `true`.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<AuthStatus | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAuthStatus();
      if (mountedRef.current) setStatus(response);
      return response;
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Only on mount — `refresh` is stable (empty dependency array itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    loading,
    error,
    connected: status !== null && (status.lichess !== null || status.chess_com !== null),
    refresh,
  };
}
