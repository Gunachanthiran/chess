import { useCallback, useEffect, useMemo, useState } from 'react';
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
const VOICE_STORAGE_KEY = 'chessscope.coach-voice.voice-uri';

function readVoiceURI(): string | null {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeVoiceURI(uri: string | null): void {
  try {
    if (uri) window.localStorage.setItem(VOICE_STORAGE_KEY, uri);
    else window.localStorage.removeItem(VOICE_STORAGE_KEY);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

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

/**
 * Ranks a system voice by how likely it is to sound less robotic than the
 * browser's arbitrary default — English locale first, a name that suggests
 * a higher-quality engine (most desktop/mobile OSes ship at least one voice
 * tagged this way alongside their compact/basic ones) next, an explicitly
 * "compact"/"robot" name last. Never hard-excludes anything: a browser that
 * only exposes one odd voice should still get that voice, just unranked.
 */
export function scoreVoice(voice: SpeechSynthesisVoice): number {
  let score = 0;
  if (/^en/i.test(voice.lang)) score += 10;
  const name = voice.name.toLowerCase();
  if (/enhanced|premium|neural|natural/.test(name)) score += 5;
  if (/compact|robot/.test(name)) score -= 3;
  return score;
}

/** The highest-`scoreVoice`d entry, or `null` when the list is empty (voices
 * load asynchronously in most browsers — see `useCoachVoice` below). */
export function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

/** Speaks `text` immediately, cancelling anything the coach was already
 * saying. `voice` is optional and defaults to the browser's own default
 * voice when omitted, matching this function's original behaviour exactly
 * for any caller that doesn't pass one. */
export function speakCoachLine(
  text: string,
  classification?: Classification,
  voice?: SpeechSynthesisVoice | null,
): void {
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
    if (voice) utterance.voice = voice;
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
  /** Every voice the browser currently exposes — empty until `getVoices()`
   * actually returns something (see the `voiceschanged` effect below), and
   * possibly empty forever on a browser/webview with no TTS voices at all. */
  voices: SpeechSynthesisVoice[];
  /** The voice `speak` will actually use: the user's explicit pick if it's
   * still present in `voices`, else the best-scored one, else `null`. */
  activeVoice: SpeechSynthesisVoice | null;
  selectedVoiceURI: string | null;
  /** `null` clears the override and reverts to auto (`pickBestVoice`). */
  setVoice: (voiceURI: string | null) => void;
};

export function useCoachVoice(): CoachVoiceHook {
  const [muted, setMuted] = useState<boolean>(readMuted);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(readVoiceURI);

  // Voice lists load asynchronously in most browsers (Chrome returns an
  // empty array on the very first synchronous call) — read once immediately
  // in case it's already populated, then trust `voiceschanged` from there.
  useEffect(() => {
    const synth = getSynth();
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);

  const activeVoice = useMemo(() => {
    const chosen = voices.find((v) => v.voiceURI === selectedVoiceURI);
    return chosen ?? pickBestVoice(voices);
  }, [voices, selectedVoiceURI]);

  const setVoice = useCallback((voiceURI: string | null) => {
    setSelectedVoiceURI(voiceURI);
    writeVoiceURI(voiceURI);
  }, []);

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
      speakCoachLine(text, classification, activeVoice);
    },
    [muted, activeVoice],
  );

  return { muted, toggleMuted, speak, voices, activeVoice, selectedVoiceURI, setVoice };
}
