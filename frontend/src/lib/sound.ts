/**
 * Locally synthesized move sound effects (chess.com / chessiro style).
 *
 * Everything here is generated at runtime with the Web Audio API — no audio
 * files, no network requests, no dependencies. Browsers refuse to start an
 * AudioContext before a user gesture, so the context is created lazily on the
 * first play call rather than at module load, and every entry point is wrapped
 * so a blocked or unavailable context degrades to silence instead of throwing.
 */

let context: AudioContext | null = null;
let contextUnavailable = false;

type AudioContextCtor = typeof AudioContext;

/**
 * Returns the shared AudioContext, creating it on first use. Returns null (and
 * latches that decision) when Web Audio is missing or construction is blocked.
 */
function getContext(): AudioContext | null {
  if (context) return context;
  if (contextUnavailable) return null;

  try {
    const w = window as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      contextUnavailable = true;
      return null;
    }
    context = new Ctor();
    return context;
  } catch {
    contextUnavailable = true;
    return null;
  }
}

/**
 * Promise for a resume already in flight, so concurrent calls share it
 * instead of each firing their own `ctx.resume()`.
 */
let pendingResume: Promise<void> | null = null;

/**
 * Synchronously creates (if needed) and resumes the shared AudioContext.
 *
 * This exists to be called directly from a real, trusted user-gesture event
 * handler (a `pointerdown`/`click`/`keydown` listener bound with `{ once:
 * true }` at the app root — see `App.tsx`) — NOT from inside a `useEffect`
 * reacting to a state change. That distinction is the actual fix here: every
 * browser's autoplay policy gates `AudioContext` creation/resume on being
 * called within the synchronous call stack of a trusted gesture. This app's
 * move sounds are triggered from an effect that fires *after* an async
 * network round-trip (the move gets confirmed by the server before the sound
 * plays) — by the time that effect runs, the original gesture's synchronous
 * window has long closed, so a `resume()` called from there can be silently
 * refused no matter how carefully the subsequent scheduling is sequenced.
 * Warming the context up eagerly, on the very first real interaction with the
 * page — long before any move has actually happened — sidesteps the problem
 * entirely instead of racing it.
 */
export function unlockAudio(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended' && !pendingResume) {
    pendingResume = ctx.resume().catch(() => undefined);
  }
}

/**
 * Resolves once `ctx` is not suspended, resuming it first if needed. Callers
 * await this before scheduling any node — never fire scheduling and resume()
 * in parallel, or the "first sound after a fresh context" race comes back.
 */
function ready(ctx: AudioContext): Promise<void> {
  if (ctx.state !== 'suspended') return Promise.resolve();
  if (!pendingResume) {
    pendingResume = ctx.resume().catch(() => undefined);
  }
  return pendingResume;
}

type ToneOptions = {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Seconds from now before the note starts. */
  delay?: number;
  /** Seconds the note takes to decay to silence. */
  duration: number;
  /** Peak gain, 0..1. */
  peak: number;
  type?: OscillatorType;
  /** Optional linear ramp to this frequency across the note. */
  glideTo?: number;
  /**
   * Seconds to reach `peak`. The default (1.5ms) is short enough to read as a
   * struck object; longer values soften a note into a pad.
   */
  attack?: number;
};

/** Schedules a single oscillator note with a fast attack and exponential decay. */
function tone(ctx: AudioContext, options: ToneOptions): void {
  const {
    freq,
    delay = 0,
    duration,
    peak,
    type = 'sine',
    glideTo,
    attack = 0.0015,
  } = options;
  const start = ctx.currentTime + delay;
  const end = start + duration;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo !== undefined) {
    // Exponential, not linear: pitch is perceived logarithmically, so an
    // exponential fall is what makes a glide read as a struck object settling
    // rather than a synthesizer sweep.
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), end);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc.stop(end + 0.02);
}

/**
 * Schedules a short burst of filtered white noise — the percussive "wood on
 * wood" transient that sits under a move or a capture.
 *
 * `type` picks what the burst is *for*: `lowpass` keeps only the body and reads
 * as weight/thud; `bandpass` keeps a narrow bright slice and reads as the click
 * of the attack itself.
 */
function noiseBurst(
  ctx: AudioContext,
  options: {
    duration: number;
    peak: number;
    cutoff: number;
    delay?: number;
    type?: 'lowpass' | 'bandpass' | 'highpass';
    /** Resonance for the bandpass slice. Low values stay broad and natural. */
    q?: number;
  },
): void {
  const { duration, peak, cutoff, delay = 0, type = 'lowpass', q = 0.7 } = options;
  const start = ctx.currentTime + delay;
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));

  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    // Fade the noise out across the buffer so it reads as a thud, not a hiss.
    const fade = 1 - i / frameCount;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, start);
  filter.Q.setValueAtTime(q, start);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  source.start(start);
  source.stop(start + duration + 0.02);
}

/** Multiplies `value` by a random factor within `±pct` — real physical strikes never repeat identically. */
function jitter(value: number, pct: number): number {
  return value * (1 + (Math.random() * 2 - 1) * pct);
}

/**
 * A struck-object resonance: several sine partials at *inharmonic* frequency
 * ratios, each decaying independently (higher partials faster, exactly how a
 * physical material damps its higher vibration modes quicker than its
 * fundamental). This is what a single oscillator with a pitch glide can't
 * give you — a clean tone is inherently harmonic, so it always reads as a
 * synthesizer note. Real wood/plastic/felt impacts are inharmonic and
 * broadband, which is the actual difference between "a beep" and "a knock."
 *
 * `brightness` (0..1) balances how much the upper partials contribute —
 * higher for a sharp strike (a capture), lower for a soft one (a quiet move).
 */
function woodStrike(
  ctx: AudioContext,
  options: { freq: number; delay?: number; peak: number; duration: number; brightness?: number },
): void {
  const { freq, delay = 0, peak, duration, brightness = 0.6 } = options;
  // Inharmonic ratios (not 1/2/3x) — a harmonic series is what makes additive
  // synthesis sound like an organ instead of a struck object.
  const partials = [
    { ratio: 1, amp: 1, decay: 1 },
    { ratio: 2.37, amp: 0.55 * brightness + 0.15, decay: 1.6 },
    { ratio: 3.82, amp: 0.32 * brightness + 0.06, decay: 2.3 },
    { ratio: 5.14, amp: 0.16 * brightness, decay: 3.1 },
  ];

  partials.forEach(({ ratio, amp, decay }) => {
    if (amp <= 0) return;
    tone(ctx, {
      freq: jitter(freq * ratio, 0.01),
      delay: delay + jitter(0, 0.4) * 0.001,
      duration: duration / decay,
      peak: peak * amp,
      type: 'sine',
      attack: 0.0006,
    });
  });
}

/**
 * Runs `play` against a live context, swallowing anything that goes wrong.
 *
 * When the context is already running (true for every call after the first
 * in a session) this schedules synchronously, same as before. Only a
 * suspended context takes the async path, waiting on `ready()` so playback
 * never races an in-flight resume.
 */
function withContext(play: (ctx: AudioContext) => void): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ready(ctx).then(() => {
        try {
          play(ctx);
        } catch {
          // Audio is a nicety — never let it break navigation.
        }
      });
      return;
    }
    play(ctx);
  } catch {
    // Audio is a nicety — never let it break navigation.
  }
}

export const SoundEffects = {
  /**
   * A piece set down on a board: bright click for the attack, inharmonic
   * wood resonance for the body, both jittered so the same move never sounds
   * quite identical twice.
   */
  playMove(): void {
    withContext((ctx) => {
      noiseBurst(ctx, {
        duration: jitter(0.016, 0.15),
        peak: 0.15,
        cutoff: jitter(2700, 0.1),
        type: 'bandpass',
        q: 0.6,
      });
      woodStrike(ctx, { freq: jitter(390, 0.03), peak: 0.22, duration: 0.065, brightness: 0.55 });
    });
  },

  /**
   * Two-part "clack": a sharper, brighter strike than a normal move, landing
   * on noticeably more low-end weight for the piece being knocked off the
   * square. The 22ms gap between strike and body is what reads as two events
   * (a real capture) instead of one.
   */
  playCapture(): void {
    withContext((ctx) => {
      // Strike.
      noiseBurst(ctx, {
        duration: jitter(0.013, 0.15),
        peak: 0.17,
        cutoff: jitter(3300, 0.1),
        type: 'bandpass',
        q: 0.6,
      });
      woodStrike(ctx, { freq: jitter(520, 0.03), peak: 0.19, duration: 0.045, brightness: 0.8 });
      // Body — the displaced piece landing, lower and heavier.
      const bodyDelay = jitter(0.022, 0.1);
      noiseBurst(ctx, { delay: bodyDelay, duration: 0.065, peak: 0.12, cutoff: 550 });
      woodStrike(ctx, {
        freq: jitter(190, 0.04),
        delay: bodyDelay,
        peak: 0.22,
        duration: 0.12,
        brightness: 0.35,
      });
      tone(ctx, {
        freq: jitter(155, 0.03),
        glideTo: 68,
        delay: bodyDelay,
        duration: 0.14,
        peak: 0.16,
        type: 'sine',
      });
    });
  },

  /**
   * Urgent, bright rising double-tone: D6 then G6, a perfect fourth apart.
   *
   * Rising-fourth intervals are the standard "attention" gesture (sirens,
   * alerts), and the 55ms spacing is tight enough to read as one alarm rather
   * than two notes. Triangle rather than sine gives it the odd harmonics that
   * make it cut through; a quiet sine an octave down keeps it from sounding
   * thin, and a click on the first note keeps it as percussive as the moves it
   * sits alongside.
   */
  playCheck(): void {
    withContext((ctx) => {
      noiseBurst(ctx, { duration: 0.012, peak: 0.07, cutoff: 3400, type: 'bandpass', q: 0.6 });
      tone(ctx, { freq: 1174.66, duration: 0.055, peak: 0.13, type: 'triangle' });
      tone(ctx, { freq: 587.33, duration: 0.05, peak: 0.05, type: 'sine' });
      tone(ctx, { freq: 1567.98, delay: 0.055, duration: 0.075, peak: 0.13, type: 'triangle' });
      tone(ctx, { freq: 783.99, delay: 0.055, duration: 0.07, peak: 0.05, type: 'sine' });
    });
  },

  /**
   * Full C-major resolution, C5-E5-G5-C6, with a body note under it and a
   * synthesized tail.
   *
   * Three things give this the resonance the old three-sine arpeggio lacked:
   * it *resolves* onto the octave rather than stopping on the fifth; a quiet
   * C3 pad with a slow 60ms attack and a 1.4s decay sits underneath the whole
   * phrase as sustain; and every note is doubled by a quieter copy delayed
   * 70ms and detuned +0.4%, whose longer decay smears each note's tail into the
   * next. That doubling is a cheap stand-in for reverb — no ConvolverNode, no
   * impulse response, no assets — and the detune is what stops the copy from
   * sounding like a flat echo. The final note gets a 1.1s decay so the sound
   * rings out instead of stopping dead.
   */
  playGameEnd(): void {
    withContext((ctx) => {
      // Sustaining body under the arpeggio.
      tone(ctx, { freq: 130.81, duration: 1.4, peak: 0.06, type: 'triangle', attack: 0.06 });

      const notes = [
        { freq: 523.25, delay: 0, duration: 0.42 }, // C5
        { freq: 659.25, delay: 0.1, duration: 0.42 }, // E5
        { freq: 783.99, delay: 0.2, duration: 0.5 }, // G5
        { freq: 1046.5, delay: 0.32, duration: 1.1 }, // C6 — resolution, rings out.
      ];

      notes.forEach(({ freq, delay, duration }) => {
        tone(ctx, { freq, delay, duration, peak: 0.14, type: 'triangle' });
        // Detuned, delayed, quieter double — the reverb-ish tail.
        tone(ctx, {
          freq: freq * 1.004,
          delay: delay + 0.07,
          duration: duration + 0.35,
          peak: 0.055,
          type: 'sine',
          attack: 0.02,
        });
      });
    });
  },

  /**
   * Castling: two pieces move in one turn (king then rook), so this is two
   * `playMove`-style strikes back to back rather than one — the rook's is
   * lower and a touch quieter, reading as the second, lighter piece landing
   * right after the king's.
   */
  playCastle(): void {
    withContext((ctx) => {
      noiseBurst(ctx, {
        duration: jitter(0.016, 0.15),
        peak: 0.15,
        cutoff: jitter(2700, 0.1),
        type: 'bandpass',
        q: 0.6,
      });
      woodStrike(ctx, { freq: jitter(390, 0.03), peak: 0.22, duration: 0.065, brightness: 0.55 });

      const rookDelay = jitter(0.09, 0.1);
      noiseBurst(ctx, {
        delay: rookDelay,
        duration: jitter(0.014, 0.15),
        peak: 0.12,
        cutoff: jitter(2200, 0.1),
        type: 'bandpass',
        q: 0.6,
      });
      woodStrike(ctx, {
        freq: jitter(330, 0.03),
        delay: rookDelay,
        peak: 0.17,
        duration: 0.06,
        brightness: 0.45,
      });
    });
  },

  /**
   * Promotion: a normal strike (the pawn landing) immediately followed by a
   * short ascending shimmer — three quick high notes a major third and a
   * minor third apart, evoking the pawn "becoming" a new, higher-value piece
   * without going as far as the full `playGameEnd` fanfare.
   */
  playPromote(): void {
    withContext((ctx) => {
      noiseBurst(ctx, {
        duration: jitter(0.016, 0.15),
        peak: 0.14,
        cutoff: jitter(2700, 0.1),
        type: 'bandpass',
        q: 0.6,
      });
      woodStrike(ctx, { freq: jitter(390, 0.03), peak: 0.2, duration: 0.06, brightness: 0.55 });

      const shimmer = [
        { freq: 1046.5, delay: 0.045 }, // C6
        { freq: 1318.51, delay: 0.09 }, // E6
        { freq: 1567.98, delay: 0.135 }, // G6
      ];
      shimmer.forEach(({ freq, delay }) => {
        tone(ctx, { freq, delay, duration: 0.16, peak: 0.08, type: 'triangle', attack: 0.004 });
      });
    });
  },

  /**
   * Dull low double-thunk for a rejected move — deliberately unmusical.
   *
   * Two square waves 8Hz apart beat against each other, and the lowpassed noise
   * burst under them makes it land as a dead thud rather than a tone.
   */
  playIllegalMove(): void {
    withContext((ctx) => {
      noiseBurst(ctx, { duration: 0.045, peak: 0.09, cutoff: 420 });
      tone(ctx, { freq: jitter(142, 0.02), glideTo: 118, duration: 0.11, peak: 0.12, type: 'square' });
      tone(ctx, { freq: jitter(150, 0.02), glideTo: 124, duration: 0.11, peak: 0.09, type: 'square' });
    });
  },
};

export type SoundEffectsApi = typeof SoundEffects;
