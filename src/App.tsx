import { memo, useCallback, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import {
  FINALE_POSTER,
  OPENING_POSTER,
  SIGIL_START,
  SOUNDTRACK,
  STAGES,
  filmSource,
} from "./config";
import { StageList } from "./StageList";
import { useFilmScrubber } from "./useFilmScrubber";
import { useSoundtrack } from "./useSoundtrack";
import { useViewportProfile } from "./useViewportProfile";

const STAGE_STYLE = { "--poster-url": `url(${FINALE_POSTER})` } as CSSProperties;

/**
 * The soundtrack owns its own state so that toggling it re-renders one button rather than the whole
 * film stage. The <audio> element ships alongside it: without `controls` the UA stylesheet gives it
 * `display: none`, so it never becomes a grid item in the HUD.
 */
const Soundtrack = memo(function Soundtrack() {
  const { audioRef, soundOn, toggleSound, handleAudioError } = useSoundtrack();

  return (
    <>
      <audio
        ref={audioRef}
        src={SOUNDTRACK}
        preload="none"
        loop
        data-gain="0.000"
        onError={handleAudioError}
      />
      <button
        className="sound-toggle"
        type="button"
        aria-label={soundOn ? "Turn festival soundtrack off" : "Turn festival soundtrack on"}
        aria-pressed={soundOn}
        data-active={soundOn}
        onClick={toggleSound}
      >
        <span className="eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span className="sound-copy">
          <small>SOUNDTRACK</small>
          <strong>{soundOn ? "PLAYING" : "MUTED"}</strong>
        </span>
        <i className="pill-sheen" aria-hidden="true" />
      </button>
    </>
  );
});

/** Same idea: the reveal toggle stays local to the two buttons that care about it. */
const FinaleActions = memo(function FinaleActions({ reducedMotion }: { reducedMotion: boolean }) {
  const [revealed, setRevealed] = useState(false);

  const replay = useCallback(() => {
    setRevealed(false);
    window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);

  return (
    <div className="finale-actions">
      <button
        className="festival-mode"
        type="button"
        data-revealed={revealed}
        aria-expanded={revealed}
        aria-label={revealed ? "Festival mode coming soon" : "Enter festival mode"}
        onClick={() => setRevealed(true)}
      >
        <span className="mode-copy mode-copy--default" aria-hidden={revealed}>
          <small>UNLOCK NEXT SIGNAL</small>
          <strong>ENTER FESTIVAL MODE</strong>
        </span>
        <span className="mode-copy mode-copy--revealed" aria-hidden={!revealed}>
          <small>TRANSMISSION 02 / QUEUED</small>
          <strong>COMING SOON</strong>
        </span>
        <i className="mode-symbol" aria-hidden="true">↗</i>
        <i className="pill-sheen" aria-hidden="true" />
      </button>
      {/* Icon only: the glyph carries the meaning, and aria-label keeps it named for assistive
          tech and the accessible-name check. */}
      <button className="replay-button" type="button" aria-label="Replay experience" onClick={replay}>
        <i aria-hidden="true">↺</i>
      </button>
    </div>
  );
});

export function App() {
  const stageRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { tier, reducedMotion } = useViewportProfile();
  const [filmFallback, setFilmFallback] = useState(false);
  const ready = useFilmScrubber({ stageRef, videoRef, tier, reducedMotion });

  // A film that never decodes would otherwise leave the HUD floating over a black screen until the
  // loader times out, so fall back to the same static poster the reduced-motion path already uses.
  const handleFilmError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.getAttribute("src")) return;
    setFilmFallback(true);
  }, []);

  const showLoader = !reducedMotion && !filmFallback && !ready;

  return (
    <div className="scroll-spacer">
      <main
        className="experience"
        ref={stageRef}
        aria-label="APKMASON EDM Music Festival interactive film"
        data-film-fallback={filmFallback}
        style={STAGE_STYLE}
      >
        {/* One master film, one decoder. The act seams are baked cross-dissolves; see
            scripts/build-media.sh. */}
        <div className="video-stack" aria-hidden="true">
          <video
            key={tier}
            ref={videoRef}
            className="festival-film"
            muted
            playsInline
            preload={reducedMotion ? "none" : "auto"}
            poster={OPENING_POSTER}
            src={filmSource(tier)}
            tabIndex={-1}
            onError={handleFilmError}
          />
        </div>

        <div className="static-poster" aria-hidden="true" />

        {/* Outer box owns the position (transform driven by --sigil-*); the inner mark carries the
            data-beat fade, because renderUI writes an inline transform onto every beat element and
            would otherwise overwrite the anchoring. */}
        <div className="finale-sigil" aria-hidden="true">
          <div className="sigil-frame" data-beat data-start={SIGIL_START} data-end="1" data-hold="true">
            {(["cyan", "magenta", "core"] as const).map((layer) => (
              <span className={`sigil-letter sigil-letter--${layer}`} key={layer}>
                <i className="sigil-stroke sigil-stroke--upper-left" />
                <i className="sigil-stroke sigil-stroke--upper-right" />
                <i className="sigil-stroke sigil-stroke--bar" />
                <i className="sigil-stroke sigil-stroke--lower-left" />
                <i className="sigil-stroke sigil-stroke--lower-right" />
              </span>
            ))}
            <span className="sigil-lock" />
          </div>
        </div>

        <div className="vignette" aria-hidden="true" />
        <div className="festival-glow" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <div className="scanlines" aria-hidden="true" />

        <header className="top-hud">
          <div className="brand-lockup" aria-label="APKMASON EDM">
            <span className="brand-mark">A</span>
            <div><strong>APKMASON</strong><span>EDM / 2027</span></div>
          </div>
          <span className="fiction-pill" aria-label="Design fiction festival credential">
            <i className="pill-dot" aria-hidden="true" />
            <span className="pill-copy">
              <small>ACCESS // 27</small>
              <strong>DESIGN FICTION</strong>
            </span>
            <i className="pill-sheen" aria-hidden="true" />
          </span>
          <Soundtrack />
        </header>

        <div className="copy-safe-area">
          <section className="copy-beat copy-beat--intro" data-beat data-start="0.025" data-end="0.08">
            <p className="eyebrow">APKMASON PRESENTS</p>
            <h1>EDM <span className="rgb-glitch" data-text="MUSIC">MUSIC</span><br />FESTIVAL</h1>
            <p className="meta">NOVA DISTRICT / 22 AUG 2027</p>
            <p className="fiction-note">A FICTIONAL LIVE EXPERIENCE</p>
          </section>
          <section className="copy-beat" data-beat data-start="0.08" data-end="0.18">
            <p className="eyebrow cyan">THE SIGNAL IS OPEN</p>
            <h2>BEYOND<br />THE DROP.</h2>
            <p className="support">One night. Three stages. Eighteen signals.</p>
          </section>
          <section className="copy-beat headliner-beat" data-beat data-start="0.18" data-end="0.28">
            <p className="eyebrow">FIRST TRANSMISSION</p>
            <p className="headliner"><span>VANTA//ZERO</span><span>LUMEN ARC</span><span>NEON VALE</span></p>
          </section>
          <section className="copy-beat transition-beat" data-beat data-start="0.28" data-end="0.335">
            <p className="eyebrow cyan">ENTER THE SIGNAL</p>
            <div className="signal-line"><i /><i /><i /><i /><i /></div>
          </section>
          <section className="copy-beat act-two-title" data-beat data-start="0.335" data-end="0.43">
            <p className="eyebrow">IMMERSION / LIVE TRANSMISSION</p>
            <h2><span>18</span> ARTISTS<br /><span>03</span> STAGES<br /><span>01</span> NIGHT</h2>
          </section>
          <section className="copy-beat stage-selector" data-beat data-start="0.43" data-end="0.55">
            <p className="eyebrow">CHOOSE YOUR FREQUENCY</p>
            <div className="stage-chips">
              {STAGES.map((stage, index) => (
                <div className="stage-chip" data-stage-chip data-active={index === 0} key={stage.name}>
                  <span>0{index + 1}</span><strong>{stage.name}</strong><i />
                </div>
              ))}
            </div>
          </section>
          <section className="copy-beat stats-beat" data-beat data-start="0.665" data-end="0.785">
            <p className="eyebrow cyan">ASCENT / SYSTEM WIDE</p>
            <h2>SEE THE WHOLE<br />FREQUENCY.</h2>
            <div className="stats-row">
              <div><strong>03</strong><span>STAGES</span></div>
              <div><strong>18</strong><span>ARTISTS</span></div>
              <div><strong>01</strong><span>NIGHT</span></div>
              <div><strong>∞</strong><span>ENERGY</span></div>
            </div>
          </section>
          <section className="copy-beat final-headliners" data-beat data-start="0.78" data-end="0.91">
            <p className="eyebrow">FINAL TRANSMISSION</p>
            <p className="headliner"><span>KAIROS IX</span><span>STATIC BLOOM</span><span>ORBITAL GHOST</span></p>
          </section>
          <section className="copy-beat finale" data-beat data-start="0.91" data-end="1" data-hold="true">
            <p className="eyebrow">APKMASON</p>
            <h2>EDM <span className="rgb-glitch" data-text="MUSIC">MUSIC</span><br />FESTIVAL</h2>
            <p className="meta">22 AUG 2027 — NOVA DISTRICT</p>
            <p className="final-tagline">BEYOND THE DROP.</p>
            <FinaleActions reducedMotion={reducedMotion} />
          </section>
        </div>

        <aside className="lineup-viewport copy-beat" data-beat data-start="0.55" data-end="0.665" aria-label="Festival line-up">
          <div data-lineup-track><StageList /></div>
        </aside>
        <aside className="reduced-lineup" aria-label="Festival line-up for reduced motion"><StageList compact /></aside>

        <footer className="bottom-hud">
          <div className="act-indicator">
            <span className="act-name act-name--1">ARRIVAL</span>
            <span className="act-name act-name--2">IMMERSION</span>
            <span className="act-name act-name--3">ASCENT</span>
          </div>
          <div className="timeline" aria-hidden="true"><i /><b /></div>
          <div className="timeline-numbers" aria-label="Film progress"><span>01</span><span>02</span><span>03</span></div>
          <p>DESIGN FICTION / APKMASON.DEV</p>
        </footer>

        <div className={showLoader ? "loader" : "loader loader--ready"} role="status" aria-live="polite">
          <div className="loader-brand"><span className="brand-mark">A</span><strong>APKMASON</strong></div>
          <p>TUNING THE FREQUENCY</p>
          <div className="loader-line"><i /></div>
        </div>
      </main>
    </div>
  );
}
