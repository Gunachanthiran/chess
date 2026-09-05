/**
 * Browser notifications for a finished analysis job — opt-in (a real
 * permission prompt only fires from a direct click, per every browser's own
 * policy), and persisted the same way `useSoundEffects`' mute flag is.
 *
 * Deliberately *not* a real push subscription: that needs a backend VAPID
 * key pair and a server-side send on job completion, a materially bigger
 * change than "notify me while I still have this tab open somewhere" calls
 * for. This works as long as the browser itself stays running (background
 * tab or backgrounded app, not fully closed) — the same reach a live
 * WebSocket already has, which is what actually delivers the completion
 * event this fires from.
 */

const PREFERENCE_KEY = 'chessscope.notifications.analysis-complete';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function readNotifyPreference(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return (
      window.localStorage.getItem(PREFERENCE_KEY) === 'true' && Notification.permission === 'granted'
    );
  } catch {
    return false;
  }
}

function writeNotifyPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

/**
 * Call only from a direct click handler — `Notification.requestPermission()`
 * silently resolves to `'default'` (never prompts again this session) if
 * called any other way in most browsers.
 *
 * Returns whether notifications ended up enabled, so the caller can flip a
 * toggle to match reality rather than assuming the request succeeded.
 */
export async function enableAnalysisNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') {
    writeNotifyPreference(true);
    return true;
  }
  if (Notification.permission === 'denied') {
    writeNotifyPreference(false);
    return false;
  }
  const result = await Notification.requestPermission();
  const granted = result === 'granted';
  writeNotifyPreference(granted);
  return granted;
}

export function disableAnalysisNotifications(): void {
  writeNotifyPreference(false);
}

/**
 * Fires one notification, preferring the service worker's own
 * `showNotification` (works from a background tab on more platforms, and
 * lets `sw.js`'s `notificationclick` handler focus the app) and falling
 * back to the plain `Notification` constructor when no registration exists
 * yet (e.g. this is a dev build, which never registers one — see
 * `main.tsx`).
 */
export async function notifyAnalysisDone(title: string, body: string, url: string): Promise<void> {
  if (!readNotifyPreference()) return;

  const options: NotificationOptions = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'chessscope-analysis',
    data: { url },
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
    }
    new Notification(title, options);
  } catch {
    // Non-fatal — the job is still findable from the dashboard either way.
  }
}
