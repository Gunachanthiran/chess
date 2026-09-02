import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PlayBotPage } from '../components/layout/PlayBotPage';
import type { BotGameHook } from '../hooks/useBotGame';

type PlayBotRouteProps = {
  bot: BotGameHook;
};

/**
 * `/play/:gameId` — loads the game if it isn't already the one in memory
 * (e.g. a direct visit or a reload; right after `PlayBotSetupRoute` creates
 * one, `bot.botGame.id` already matches and this is a no-op).
 */
export function PlayBotRoute({ bot }: PlayBotRouteProps) {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const loadingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    if (bot.botGame?.id === gameId) return;
    if (loadingRef.current === gameId) return;
    loadingRef.current = gameId;
    void bot.loadGame(gameId);
  }, [gameId, bot]);

  if (!gameId) {
    navigate('/play', { replace: true });
    return null;
  }

  return (
    <PlayBotPage
      bot={bot}
      onNewGame={() => navigate('/play')}
      onExit={() => navigate('/analyze')}
      onAnalyzed={(jobId) => navigate(`/analysis/${jobId}`)}
    />
  );
}
