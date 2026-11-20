import { MessageCircle, Play, UsersRound } from 'lucide-react';
import pearLogoUrl from '../../../assets/favicon.png';
import pearsAtTableUrl from '../../../assets/landing-cozy-room.webp';

type LandingPageProps = {
  backendWakeUrl: string;
  code: string;
  creating: boolean;
  error: string;
  joining: boolean;
  notice: string;
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  realtimeWakeUrl: string;
};

export function LandingPage({
  backendWakeUrl,
  code,
  creating,
  error,
  joining,
  notice,
  onCodeChange,
  onCreate,
  onJoin,
  realtimeWakeUrl
}: LandingPageProps) {
  const busy = creating || joining;

  return (
    <main className="landing">
      <img alt="" aria-hidden="true" className="landing-illustration" src={pearsAtTableUrl} />
      <div className="landing-inner">
        <header className="landing-brand">
          <span className="landing-badge"><img alt="" src={pearLogoUrl} /></span>
          <h1>Pear Programming</h1>
        </header>
        <p className="landing-tagline">Pair program together in a shared, real-time room.</p>

        <section aria-labelledby="room-card-title" className="landing-card">
          <h2 className="sr-only" id="room-card-title">Create or join a room</h2>
          <button className="primary-button landing-create" disabled={busy} onClick={onCreate} type="button">
            {creating ? 'Preparing your room…' : 'Create room'}
          </button>

          <div className="landing-divider"><span>or join with a code</span></div>

          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              onJoin();
            }}
          >
            <label className="sr-only" htmlFor="landing-room-code">Room code</label>
            <div className="join-form-row">
              <input
                aria-describedby="landing-room-code-hint"
                autoCapitalize="characters"
                autoComplete="off"
                id="landing-room-code"
                onChange={(event) => onCodeChange(event.target.value)}
                placeholder="Room code"
                spellCheck={false}
                value={code}
              />
              <button className="secondary-button" disabled={busy} type="submit">
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
            <small className="sr-only" id="landing-room-code-hint">Six letters or numbers, shared by your Lead Pear.</small>
          </form>

          <div aria-live="polite">
            {notice && <p className="landing-notice" role="status">{notice}</p>}
            {error && <p className="landing-error" role="alert">{error}</p>}
          </div>
        </section>

        <ul aria-label="What you can do in a room" className="landing-features">
          <li><UsersRound aria-hidden="true" size={16} /><span>Edit together live, up to five pears</span></li>
          <li><MessageCircle aria-hidden="true" size={16} /><span>Chat and ask @PearAI for help</span></li>
          <li><Play aria-hidden="true" size={16} /><span>Run code in 14 languages</span></li>
        </ul>

        {(backendWakeUrl || realtimeWakeUrl) && (
          <p className="landing-wake">
            Free hosting: the first room can take a minute to start. Wake the
            {backendWakeUrl && <> <a href={backendWakeUrl} rel="noreferrer" target="_blank">backend</a></>}
            {backendWakeUrl && realtimeWakeUrl && ' and'}
            {realtimeWakeUrl && <> <a href={realtimeWakeUrl} rel="noreferrer" target="_blank">realtime</a></>}
            {' '}servers early.
          </p>
        )}
      </div>
    </main>
  );
}
