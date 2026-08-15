import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { uploadPgn } from '../../api/games';
import { createAnalysisJob } from '../../api/analysis';
import { errorMessage } from '../../api/client';
import type { AnalysisJob, Game } from '../../types';

type UploadPGNFormProps = {
  /** Called once the game exists and its analysis job has been queued. */
  onAnalysisStarted: (game: Game, job: AnalysisJob) => void;
};

/**
 * Paste-or-upload a PGN, then immediately queue analysis for it. The two calls
 * are chained here so the user gets one button rather than an "uploaded, now
 * press analyse" dead end.
 */
export function UploadPGNForm({ onAnalysisStarted }: UploadPGNFormProps) {
  const [pgn, setPgn] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      // Read client-side and drop the text into the same textarea, so what gets
      // submitted is always exactly what the user can see.
      const text = await file.text();
      setPgn(text);
      setFileName(file.name);
    } catch {
      setError(`Could not read ${file.name}.`);
    } finally {
      // Allow re-selecting the same file after an edit.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = pgn.trim();
    if (trimmed.length === 0) {
      setError('Paste a PGN or choose a .pgn file first.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const game = await uploadPgn(trimmed);
      const job = await createAnalysisJob(game.id);
      onAnalysisStarted(game, job);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <div className="panel__header">Upload a PGN</div>

      <label className="form__label" htmlFor="pgn-textarea">
        Paste PGN
      </label>
      <textarea
        id="pgn-textarea"
        className="form__textarea"
        value={pgn}
        onChange={(event) => setPgn(event.target.value)}
        placeholder={'[Event "Casual game"]\n[White "..."]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
        rows={10}
        spellCheck={false}
        disabled={submitting}
      />

      <div className="form__row">
        <label className="form__file">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            onChange={(event) => void handleFile(event)}
            disabled={submitting}
          />
          <span>Choose .pgn file</span>
        </label>
        {fileName && <span className="form__hint">Loaded {fileName}</span>}
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <button className="button button--primary" type="submit" disabled={submitting}>
        {submitting ? 'Starting analysis…' : 'Upload & analyse'}
      </button>
    </form>
  );
}
