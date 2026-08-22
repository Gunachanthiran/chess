import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { NOTABLE_CLASSIFICATIONS } from '../../lib/coach';
import type { CoachProfileHook } from '../../lib/coachProfile';
import { classificationIcon, classificationLabel } from '../../styles/classification-colors';

type CoachPersonalizeProps = {
  profile: CoachProfileHook;
};

/**
 * The "make the coach yours" panel: a display name, an uploaded photo
 * (replacing the illustrated `CoachMascot`), and per-notable-tier custom
 * reaction lines plus a self-recorded voice clip that plays back instead of
 * the synthesized voice. Entirely the user's own likeness/voice/words — see
 * `lib/coachProfile.ts` for the browser-local (IndexedDB + localStorage)
 * storage this reads and writes through `profile`.
 */
export function CoachPersonalize({ profile }: CoachPersonalizeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    try {
      await profile.setAvatar(file);
    } catch {
      setPhotoError(`Could not use ${file.name} as a photo.`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="coach-personalize">
      <label className="form__label" htmlFor="coach-display-name">
        Display name
      </label>
      <input
        id="coach-display-name"
        className="form__input"
        value={profile.displayName ?? ''}
        onChange={(event) => profile.setDisplayName(event.target.value)}
        placeholder="Rook"
      />

      <span className="form__label">Photo</span>
      <div className="form__row">
        {profile.avatarUrl && (
          <img src={profile.avatarUrl} alt="" className="coach-personalize__preview" />
        )}
        <label className="form__file">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void handlePhoto(event)}
          />
          <span>{profile.avatarUrl ? 'Change photo' : 'Choose photo'}</span>
        </label>
        {profile.avatarUrl && (
          <button type="button" className="button" onClick={() => void profile.clearAvatar()}>
            Remove photo
          </button>
        )}
      </div>
      {photoError && <span className="form__hint">{photoError}</span>}

      <span className="form__label">Reactions</span>
      <div className="coach-personalize__rows">
        {NOTABLE_CLASSIFICATIONS.map((tier) => {
          const isRecording = profile.recordingTier === tier;
          const hasClip = Boolean(profile.recordings[tier]);
          return (
            <div key={tier} className="coach-personalize__row">
              <span className="coach-personalize__tier">
                {classificationIcon(tier)} {classificationLabel(tier)}
              </span>
              <input
                className="form__input coach-personalize__line"
                value={profile.customLines[tier] ?? ''}
                onChange={(event) => profile.setCustomLine(tier, event.target.value)}
                placeholder="Write your own line for this..."
              />
              <div className="coach-personalize__voice">
                <button
                  type="button"
                  className={`button${isRecording ? ' coach-personalize__record--active' : ''}`}
                  onClick={() =>
                    void (isRecording ? profile.stopRecording() : profile.startRecording(tier))
                  }
                >
                  {isRecording ? '■ Stop' : hasClip ? '● Re-record' : '● Record'}
                </button>
                {hasClip && !isRecording && (
                  <>
                    <button type="button" className="button" onClick={() => profile.playRecording(tier)}>
                      ▶ Play
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => void profile.deleteRecording(tier)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {profile.recordingError && <span className="form__hint">{profile.recordingError}</span>}
    </div>
  );
}
