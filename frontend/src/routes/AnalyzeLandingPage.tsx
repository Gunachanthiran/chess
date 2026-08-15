import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadPGNForm } from '../components/upload/UploadPGNForm';
import { ImportFromLichessForm } from '../components/upload/ImportFromLichessForm';
import type { AnalysisJob, Game } from '../types';

/** `/analyze` — start a new analysis by uploading a PGN or importing from Lichess. */
export function AnalyzeLandingPage() {
  const navigate = useNavigate();

  // Both forms already create the job server-side; this just decides where to
  // go once one has, so the URL becomes the source of truth for the rest of
  // the analysis flow instead of state passed down from here.
  const handleAnalysisStarted = useCallback(
    (_game: Game, job: AnalysisJob) => {
      navigate(`/analysis/${job.id}`);
    },
    [navigate],
  );

  return (
    <section className="start">
      <div className="start__head">
        <h2 className="start__title">Start an analysis</h2>
        <p className="start__subtitle">
          Upload a PGN or pull a game straight from Lichess — Stockfish reviews every move
          and grades both sides.
        </p>
      </div>
      <div className="upload-grid upload-grid--pair">
        <UploadPGNForm onAnalysisStarted={handleAnalysisStarted} />
        <ImportFromLichessForm onAnalysisStarted={handleAnalysisStarted} />
      </div>
    </section>
  );
}
