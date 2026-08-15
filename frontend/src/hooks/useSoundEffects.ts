import { useCallback, useState } from 'react';
import { SoundEffects } from '../lib/sound';

const MUTE_STORAGE_KEY = 'chessscope.sound.muted';

/** Reads the persisted mute flag. Sound is ON by default. */
function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    // Private mode / storage disabled — fall back to the default.
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

export type SoundEffectsHook = {
  muted: boolean;
  toggleMuted: () => void;
  /** Plays the sound matching a SAN string, unless muted. */
  playForMove: (san: string) => void;
  /** Buzzes for a move the board rejected, unless muted. */
  playIllegal: () => void;
};

/**
 * Owns the mute preference and maps a move's SAN to the right synthesized cue.
 *
 * SAN carries everything needed to pick a sound: `#` means mate (game over),
 * `+` means check, `x` means capture, and anything else is a quiet move. Mate
 * is checked before check because a mating move is written `Qxf7#`, not `+#`.
 */
export function useSoundEffects(): SoundEffectsHook {
  const [muted, setMuted] = useState<boolean>(readMuted);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      writeMuted(next);
      return next;
    });
  }, []);

  const playForMove = useCallback(
    (san: string) => {
      if (muted) return;
      if (san.includes('#')) {
        SoundEffects.playGameEnd();
      } else if (san.includes('+')) {
        SoundEffects.playCheck();
      } else if (san.includes('x')) {
        SoundEffects.playCapture();
      } else {
        SoundEffects.playMove();
      }
    },
    [muted],
  );

  const playIllegal = useCallback(() => {
    if (muted) return;
    SoundEffects.playIllegalMove();
  }, [muted]);

  return { muted, toggleMuted, playForMove, playIllegal };
}
