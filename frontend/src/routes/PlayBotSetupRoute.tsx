import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlayBotSetupForm } from '../components/upload/PlayBotSetupForm';
import type { BotGameHook } from '../hooks/useBotGame';
import type { BotColor } from '../types';

type PlayBotSetupRouteProps = {
  bot: BotGameHook;
};

/** `/play` — choose colour/strength/aggression, then create the game and move to `/play/:gameId`. */
export function PlayBotSetupRoute({ bot }: PlayBotSetupRouteProps) {
  const navigate = useNavigate();

  const handleStart = useCallback(
    (
      playerColor: BotColor,
      elo: number,
      aggression: number,
      gambitId: string | null,
      adaptToOpponent: boolean,
      fullAttackMode: boolean,
    ) => {
      void bot
        .createGame(playerColor, elo, aggression, gambitId, adaptToOpponent, fullAttackMode)
        .then((id) => {
          if (id) navigate(`/play/${id}`);
          // On failure `bot.error` is already set; PlayBotSetupForm renders it
          // in place — nothing more to do here.
        });
    },
    [bot, navigate],
  );

  return (
    <div className="upload-grid upload-grid--single">
      <PlayBotSetupForm
        onStart={handleStart}
        busy={bot.creating}
        error={bot.error}
        onCancel={() => navigate('/analyze')}
      />
    </div>
  );
}
