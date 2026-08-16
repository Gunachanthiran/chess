import { useCallback, useState } from 'react';

/**
 * Speaks coach commentary with the browser's built-in Web Speech API
 * (`speechSynthesis`) — free, no server cost, no API key, works offline.
 * Mirrors `sound.ts`'s defensive style: every entry point degrades to a
 * silent no-op rather than throwing when the API is missing (older Safari,
 * some embedded webviews) or blocked.
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

/** Speaks `text` immediately, cancelling anything the coach was already saying. */
export function speakCoachLine(text: string): void {
  try {
    const synth = getSynth();
    if (!synth) return;
    // A new line always interrupts the old one rather than queueing — by the
    // time a second move's commentary is ready, the first one is stale.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;
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
  /** Speaks `text` unless muted or `text` is null (nothing to say this move). */
  speak: (text: string | null) => void;
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
    (text: string | null) => {
      if (muted || !text) return;
      speakCoachLine(text);
    },
    [muted],
  );

  return { muted, toggleMuted, speak };
}
