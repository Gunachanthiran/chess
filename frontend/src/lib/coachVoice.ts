import { useCallback, useState } from 'react';
import type { Classification } from '../types';

/**
 * Speaks coach commentary with the browser's built-in Web Speech API
 * (`speechSynthesis`) — free, no server cost, no API key, works offline.
 * Mirrors `sound.ts`'s defensive style: every entry point degrades to a
 * silent no-op rather than throwing when the API is missing (older Safari,
 * some embedded webviews) or blocked.
 *
 * Deliberately a generic system voice, not a clone of any real person's
 * voice — this only leans the *delivery* (rate/pitch) toward "hyped
 * commentator" or "wincing at a blunder" per move, via `moodFor`.
 */

const MUTE_STORAGE_KEY = 'chessscope.coach-voice.muted';

function readMuted(): boolean {
  try {
    // Off by default: unlike move sounds, a talking coach is a much bigger
    // behavioural change to spring on someone who hasn't asked for it yet.
    return window.localStorage.getItem(MUTE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/**
 * Delivery per move tier — faster and higher for the moves worth getting
 * excited about, slower and lower for the ones worth wincing at. Neither
 * value is tuned to resemble any specific person; it is generic "excited"
 * vs. "deflated" prosody, the same knobs a text-to-speech settings panel
 * would expose.
 */
function moodFor(classification?: Classification): { rate: number; pitch: number } {
  switch (classification) {
    case 'brilliant':
      return { rate: 1.18, pitch: 1.12 };
    case 'great':
      return { rate: 1.12, pitch: 1.06 };
    case 'blunder':
      return { rate: 0.92, pitch: 0.82 };
    case 'mistake':
      return { rate: 0.97, pitch: 0.88 };
    default:
      return { rate: 1.05, pitch: 0.95 };
  }
}

/** Speaks `text` immediately, cancelling anything the coach was already saying. */
export function speakCoachLine(text: string, classification?: Classification): void {
  try {
    const synth = getSynth();
    if (!synth) return;
    // A new line always interrupts the old one rather than queueing — by the
    // time a second move's commentary is ready, the first one is stale.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const { rate, pitch } = moodFor(classification);
    utterance.rate = rate;
    utterance.pitch = pitch;
    synth.speak(utterance);
  } catch {
    // Voice is a nicety — never let it break the page.
  }
}

export function stopCoachVoice(): void {
  try {
    getSynth()?.cancel();
  } catch {
    // Ignored — see speakCoachLine.
  }
}

export type CoachVoiceHook = {
  muted: boolean;
  toggleMuted: () => void;
  /** Speaks `text` unless muted or `text` is null (nothing to say this move).
   * `classification` (optional) leans the delivery toward hyped or deflated —
   * see `moodFor` above. */
  speak: (text: string | null, classification?: Classification) => void;
};

export function useCoachVoice(): CoachVoiceHook {
  const [muted, setMuted] = useState<boolean>(readMuted);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      writeMuted(next);
      if (next) stopCoachVoice();
      return next;
    });
  }, []);

  const speak = useCallback(
    (text: string | null, classification?: Classification) => {
      if (muted || !text) return;
      speakCoachLine(text, classification);
    },
    [muted],
  );

  return { muted, toggleMuted, speak };
}
