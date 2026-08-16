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
 * `+` means check, `O-O`/`O-O-O` means castling, `=` means promotion, `x`
 * means capture, and anything else is a quiet move. Checked in that order —
 * most notable event wins — since a single move can carry more than one of
 * these at once (`Qxf7#` is mate *and* a capture; `O-O+` is castling *and*
 * check; `exd8=Q+` is a capture, a promotion, *and* check).
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
      } else if (san.startsWith('O-O')) {
        SoundEffects.playCastle();
      } else if (san.includes('=')) {
        SoundEffects.playPromote();
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
