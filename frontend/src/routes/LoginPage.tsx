import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { connectChessCom, disconnectChessCom, disconnectLichess, lichessLoginUrl } from '../api/auth';
import { errorMessage } from '../api/client';
import { PanelSkeleton } from '../components/common/Skeleton';
import type { UseAccountStatusResult } from '../hooks/useAccountStatus';
import type { AccountConnection } from '../types';

type LoginPageProps = {
  /** Hoisted in App.tsx — see the comment there for why this must be the
   * same instance the route guard reads, not a second independent fetch. */
  account: UseAccountStatusResult;
};

function ConnectedRow({
  label,
  connection,
  onDisconnect,
  disconnecting,
}: {
  label: string;
  connection: AccountConnection;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div className="login__connected-row">
      <div>
        <strong>{label}</strong>
        <span className="login__connected-name"> — connected as {connection.username}</span>
      </div>
      <button className="button" type="button" onClick={onDisconnect} disabled={disconnecting}>
        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </div>
  );
}

/**
 * `/login` — the front door. Chess.com has no OAuth for third-party apps, so
 * only Lichess gets a real "Continue with…" login; Chess.com is a plain
 * username field, same trust model the Bulk Import form already used (no
 * password ever asked, see api/auth.ts).
 *
 * Doubles as the connection-management screen: reachable again once signed
 * in, it shows what's connected and offers Disconnect instead of the
 * connect controls.
 */
export function LoginPage({ account }: LoginPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { status, loading, error: statusError, refresh } = account;

  const [chessComUsername, setChessComUsername] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnectingSource, setDisconnectingSource] = useState<'lichess' | 'chess_com' | null>(
    null,
  );

  const callbackError = searchParams.get('error');

  const handleConnectChessCom = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = chessComUsername.trim();
    if (trimmed.length === 0) {
      setConnectError('Enter a Chess.com username.');
      return;
    }

    setConnecting(true);
    setConnectError(null);
    try {
      const response = await connectChessCom(trimmed);
      // Must resolve before navigating: the route guard in App.tsx reads
      // this same `account` instance, and a stale "not connected" read there
      // would otherwise immediately redirect back to /login.
      await refresh();
      navigate(`/?import_job=${response.job_id}`);
    } catch (err) {
      setConnectError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (source: 'lichess' | 'chess_com') => {
    setDisconnectingSource(source);
    try {
      if (source === 'lichess') await disconnectLichess();
      else await disconnectChessCom();
      await refresh();
    } finally {
      setDisconnectingSource(null);
    }
  };

  if (loading) {
    return <PanelSkeleton />;
  }

  return (
    <div className="login">
      <div className="login__head">
        <h2 className="login__title">Connect your chess account</h2>
        <p className="login__subtitle">
          ChessScope pulls in your full game history once you connect an account below.
        </p>
      </div>

      {(callbackError || statusError) && (
        <div className="alert alert--error">{callbackError ?? statusError}</div>
      )}

      {(status?.lichess || status?.chess_com) && (
        <div className="panel login__connected">
          <div className="panel__header">Connected accounts</div>
          {status.lichess && (
            <ConnectedRow
              label="Lichess"
              connection={status.lichess}
              onDisconnect={() => void handleDisconnect('lichess')}
              disconnecting={disconnectingSource === 'lichess'}
            />
          )}
          {status.chess_com && (
            <ConnectedRow
              label="Chess.com"
              connection={status.chess_com}
              onDisconnect={() => void handleDisconnect('chess_com')}
              disconnecting={disconnectingSource === 'chess_com'}
            />
          )}
          <button className="button button--primary" type="button" onClick={() => navigate('/')}>
            Go to dashboard
          </button>
        </div>
      )}

      <div className="login__grid">
        {!status?.lichess && (
          <div className="panel form login__option">
            <div className="panel__header">Lichess</div>
            <p className="form__hint">
              Real OAuth login — ChessScope never sees your Lichess password.
            </p>
            <a className="button button--primary" href={lichessLoginUrl()}>
              Continue with Lichess
            </a>
          </div>
        )}

        {!status?.chess_com && (
          <form className="panel form login__option" onSubmit={handleConnectChessCom}>
            <div className="panel__header">Chess.com</div>
            <p className="form__hint">
              Chess.com has no login for third-party apps — just your public username, never a
              password.
            </p>
            <label className="form__label" htmlFor="login-chesscom-username">
              Chess.com username
            </label>
            <input
              id="login-chesscom-username"
              className="form__input"
              value={chessComUsername}
              onChange={(event) => setChessComUsername(event.target.value)}
              placeholder="MagnusCarlsen"
              autoComplete="off"
              disabled={connecting}
            />
            {connectError && <div className="alert alert--error">{connectError}</div>}
            <button className="button button--primary" type="submit" disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Chess.com'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
