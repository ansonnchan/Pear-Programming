import { Bot, Leaf, MessageCircle, Sparkles } from 'lucide-react';
import pearLogoUrl from '../../../assets/favicon.png';

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
  return (
    <main className="landing-shell">
      {(backendWakeUrl || realtimeWakeUrl) && (
        <aside aria-label="Free tier service notice" className="landing-notice-bar" role="status">
          <p>
            <Leaf aria-hidden="true" size={14} />
            <span>Free hosting: the first room can take 1–2 minutes while the servers wake up.</span>
          </p>
          <span className="landing-notice-links">
            {backendWakeUrl && <a href={backendWakeUrl} rel="noreferrer" target="_blank">Wake backend</a>}
            {realtimeWakeUrl && <a href={realtimeWakeUrl} rel="noreferrer" target="_blank">Wake realtime</a>}
          </span>
        </aside>
      )}

      <section className="landing-hero" id="landing-home">
        <div className="landing-copy">
          <div className="landing-hero-brand">
            <img alt="" src={pearLogoUrl} />
            <span>Pear Programming</span>
          </div>
          <p className="landing-subheading">Pair program together. Real-time coding rooms.</p>
          <h1>
            <span>Code with others in a <strong>pear-ly</strong></span>
            <span><strong>friendly</strong> IDE in real time.</span>
          </h1>
          <p className="landing-lede">
            Pear Programming is a collaborative coding platform where teams can write code together in real time,
            chat alongside their work, and stay in sync in a shared browser IDE. Rooms are limited to <strong> five pears </strong>for smooth collaboration.
          </p>

          <h2 className="landing-feature-heading">What makes Pear Programming special?</h2>
          <div aria-label="Pear Programming highlights" className="landing-features">
            <article>
              <span className="landing-feature-icon"><Sparkles size={18} /></span>
              <div><strong>Real-time collaboration</strong><small>Edit and build together. See every change as it happens.</small></div>
            </article>
            <article>
              <span className="landing-feature-icon"><MessageCircle size={18} /></span>
              <div><strong>Chat &amp; code together</strong><small>Discuss ideas and solve problems without leaving the room.</small></div>
            </article>
            <article>
              <span className="landing-feature-icon"><Bot size={18} /></span>
              <div><strong>PearAI assistant</strong><small>Your context-aware coding companion. Mention @PearAI to begin.</small></div>
            </article>
          </div>
        </div>

        <section aria-labelledby="room-card-title" className="landing-panel" id="room-actions">
          <div className="room-card-heading">
            <h2 id="room-card-title">Create or Join a Room</h2>
            <p>Start empty, then upload your project.</p>
          </div>

          <div className="room-create-block" id="landing-create">
            <div>
              <strong>Start a new room</strong>
              <small>Open an empty shared workspace as the Lead Pear.</small>
            </div>
            <button className="primary-button create-room-button" disabled={creating || joining} onClick={onCreate} type="button">
              {creating ? 'Preparing your room…' : 'Create Pear Room'}
            </button>
          </div>

          <div className="landing-divider"><span>or</span></div>

          <form
            className="join-form"
            onSubmit={(event) => {
              event.preventDefault();
              onJoin();
            }}
          >
            <label htmlFor="landing-room-code">Enter Room Code</label>
            <div className="join-form-row">
              <input
                aria-describedby="landing-room-code-hint"
                autoCapitalize="characters"
                autoComplete="off"
                id="landing-room-code"
                onChange={(event) => onCodeChange(event.target.value)}
                placeholder="AXXAYB"
                spellCheck={false}
                value={code}
              />
              <button className="secondary-button" disabled={joining || creating} type="submit">
                {joining ? 'Joining…' : 'Join Pear Room'}
              </button>
            </div>
            <small className="sr-only" id="landing-room-code-hint">Six letters or numbers, shared by your Lead Pear.</small>
          </form>

          <p className="landing-room-note">Anyone with the room code can join.</p>
          <div aria-live="polite">
            {notice && <p className="landing-notice" role="status">{notice}</p>}
            {error && <p className="landing-error" role="alert">{error}</p>}
          </div>
        </section>
      </section>

    </main>
  );
}
