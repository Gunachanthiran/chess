import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTABLE_CLASSIFICATIONS } from './coach';
import type { Classification } from '../types';

/**
 * Personalizing the coach with the user's own photo, voice, and reaction
 * lines — entirely browser-local, no backend, no account storage. Binary
 * data (the avatar photo, recorded voice clips) lives in IndexedDB, the
 * first use of it in this codebase (localStorage is unsuitable for
 * images/audio — small size cap, synchronous, string-only). Small text
 * (display name, custom lines) stays in localStorage, following the exact
 * `chessscope.<feature>.<key>` + try/catch convention `coachVoice.ts`
 * already established. Every browser-capability call degrades to a no-op
 * rather than throwing, matching this codebase's posture for optional
 * features (missing IndexedDB in a locked-down webview, denied/absent
 * microphone access, private browsing storage limits).
 */

const DB_NAME = 'chessscope-coach-profile';
const STORE_NAME = 'blobs';
const AVATAR_KEY = 'avatar';
const voiceKey = (tier: Classification): string => `voice-${tier}`;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbGet(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed'));
    });
  } catch {
    return null;
  }
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'));
    });
  } catch {
    // Personalization is a nicety — never let storage failure break the page.
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  } catch {
    // See idbPut.
  }
}

const NAME_STORAGE_KEY = 'chessscope.coach-profile.name';
const LINES_STORAGE_KEY = 'chessscope.coach-profile.lines';

function readDisplayName(): string | null {
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDisplayName(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(NAME_STORAGE_KEY, name);
    else window.localStorage.removeItem(NAME_STORAGE_KEY);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

function readCustomLines(): Partial<Record<Classification, string>> {
  try {
    const raw = window.localStorage.getItem(LINES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Record<Classification, string>>) : {};
  } catch {
    return {};
  }
}

function writeCustomLines(lines: Partial<Record<Classification, string>>): void {
  try {
    window.localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Non-fatal: see writeDisplayName.
  }
}

/** Plays a recorded clip's object URL, degrading silently on failure — the
 * same wrapped/try-catch posture as `coachVoice.ts`'s `speakCoachLine`. */
export function playRecordedClip(url: string): void {
  try {
    const audio = new Audio(url);
    void audio.play().catch(() => {
      // Autoplay/permission failure — a nicety, never worth surfacing.
    });
  } catch {
    // See above.
  }
}

export type CoachProfileHook = {
  avatarUrl: string | null;
  setAvatar: (file: File) => Promise<void>;
  clearAvatar: () => Promise<void>;

  displayName: string | null;
  setDisplayName: (name: string | null) => void;

  customLines: Partial<Record<Classification, string>>;
  setCustomLine: (tier: Classification, text: string | null) => void;

  /** Object URLs for existing recorded clips, keyed by tier. */
  recordings: Partial<Record<Classification, string>>;
  /** The tier currently being recorded, or `null` when idle. */
  recordingTier: Classification | null;
  /** Set when `startRecording` fails (no mic permission, no MediaRecorder
   * support) — a message to surface inline, never a thrown error. */
  recordingError: string | null;
  startRecording: (tier: Classification) => Promise<void>;
  stopRecording: () => Promise<void>;
  deleteRecording: (tier: Classification) => Promise<void>;
  playRecording: (tier: Classification) => void;
};

export function useCoachProfile(): CoachProfileHook {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayNameState] = useState<string | null>(readDisplayName);
  const [customLines, setCustomLines] = useState<Partial<Record<Classification, string>>>(readCustomLines);
  const [recordings, setRecordings] = useState<Partial<Record<Classification, string>>>({});
  const [recordingTier, setRecordingTier] = useState<Classification | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);

  // Load whatever was already persisted, once, on mount.
  useEffect(() => {
    let cancelled = false;
    idbGet(AVATAR_KEY).then((blob) => {
      if (!cancelled && blob) setAvatarUrl(URL.createObjectURL(blob));
    });
    Promise.all(
      NOTABLE_CLASSIFICATIONS.map(async (tier) => {
        const blob = await idbGet(voiceKey(tier));
        return [tier, blob] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Partial<Record<Classification, string>> = {};
      for (const [tier, blob] of entries) {
        if (blob) next[tier] = URL.createObjectURL(blob);
      }
      setRecordings(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAvatar = useCallback(async (file: File) => {
    await idbPut(AVATAR_KEY, file);
    setAvatarUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  }, []);

  const clearAvatar = useCallback(async () => {
    await idbDelete(AVATAR_KEY);
    setAvatarUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, []);

  const setDisplayName = useCallback((name: string | null) => {
    const trimmed = name?.trim() || null;
    setDisplayNameState(trimmed);
    writeDisplayName(trimmed);
  }, []);

  const setCustomLine = useCallback((tier: Classification, text: string | null) => {
    setCustomLines((previous) => {
      const next = { ...previous };
      const trimmed = text?.trim();
      if (trimmed) next[tier] = trimmed;
      else delete next[tier];
      writeCustomLines(next);
      return next;
    });
  }, []);

  const startRecording = useCallback(async (tier: Classification) => {
    setRecordingError(null);
    try {
      if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setRecordingError('Voice recording is not supported in this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingTier(tier);
    } catch {
      setRecordingError('Could not access the microphone — check your browser permissions.');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const tier = recordingTier;
    if (!recorder || !tier) return;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(recordedChunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    setRecordingTier(null);

    await idbPut(voiceKey(tier), blob);
    setRecordings((previous) => {
      const prior = previous[tier];
      if (prior) URL.revokeObjectURL(prior);
      return { ...previous, [tier]: URL.createObjectURL(blob) };
    });
  }, [recordingTier]);

  const deleteRecording = useCallback(async (tier: Classification) => {
    await idbDelete(voiceKey(tier));
    setRecordings((previous) => {
      const prior = previous[tier];
      if (prior) URL.revokeObjectURL(prior);
      const next = { ...previous };
      delete next[tier];
      return next;
    });
  }, []);

  const playRecording = useCallback(
    (tier: Classification) => {
      const url = recordings[tier];
      if (url) playRecordedClip(url);
    },
    [recordings],
  );

  return {
    avatarUrl,
    setAvatar,
    clearAvatar,
    displayName,
    setDisplayName,
    customLines,
    setCustomLine,
    recordings,
    recordingTier,
    recordingError,
    startRecording,
    stopRecording,
    deleteRecording,
    playRecording,
  };
}
