import React, { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";

const BASE_URL = import.meta.env.BASE_URL;

const FILMS = [
  "festival_01_logo_to_stage.mp4",
  "festival_02_crowd_flight.mp4",
  "festival_03_grand_finale.mp4",
] as const;

const SEGMENTS = [
  [0, 0.345],
  [0.325, 0.68],
  [0.655, 1],
] as const;

const STAGES = [
  {
    name: "MAINFRAME",
    artists: ["VANTA//ZERO", "LUMEN ARC", "KAIROS IX", "STATIC BLOOM", "CHROMA UNIT", "NOVA CIRCUIT"],
  },
  {
    name: "PULSE DOME",
    artists: ["NEON VALE", "ORBITAL GHOST", "ECHO//STATE", "PULSE THEORY", "LUX//VOID", "GLASS//HEART"],
  },
  {
    name: "AFTERGLOW",
    artists: ["MIDNIGHT SYNTAX", "AETHER CLUB", "DUSK PROTOCOL", "HEXA", "SONIC REVERIE", "MIRROR SIGNAL"],
  },
] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return x * x * (3 - 2 * x);
};

function beatOpacity(progress: number, start: number, end: number, hold: boolean) {
  const fade = Math.min(0.014, Math.max(0.005, (end - start) * 0.18));
  const enter = smoothstep(start, start + fade, progress);
  const exit = hold ? 1 : 1 - smoothstep(end - fade, end, progress);
  return enter * exit;
}

export function StageList({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "stage-list stage-list--compact" : "stage-list"}>
      {STAGES.map((stage, stageIndex) => (
        <section className="stage-column" key={stage.name} aria-label={stage.name}>
          <p className="stage-name"><span>0{stageIndex + 1}</span>{stage.name}</p>
          <ol>
            {stage.artists.map((artist, index) => (
              <li className={index < 2 ? "artist artist--major" : "artist"} key={artist}>{artist}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function App() {
  const stageRef = useRef<HTMLElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioFadeFrameRef = useRef<number | null>(null);
  const progressMemoryRef = useRef<number | null>(null);
  const resizingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mobileAssets, setMobileAssets] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const [soundOn, setSoundOn] = useState(false);
  const [festivalModeRevealed, setFestivalModeRevealed] = useState(false);

  const fadeAudio = (
    audio: HTMLAudioElement,
    targetVolume: number,
    duration: number,
    onComplete?: () => void,
  ) => {
    if (audioFadeFrameRef.current !== null) cancelAnimationFrame(audioFadeFrameRef.current);
    const startVolume = audio.volume;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      audio.volume = clamp(startVolume + (targetVolume - startVolume) * eased);
      audio.dataset.gain = audio.volume.toFixed(3);
      if (progress < 1) audioFadeFrameRef.current = requestAnimationFrame(tick);
      else {
        audioFadeFrameRef.current = null;
        onComplete?.();
      }
    };

    audioFadeFrameRef.current = requestAnimationFrame(tick);
  };

  const toggleSound = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (soundOn) {
      setSoundOn(false);
      sessionStorage.setItem("apkmason-sound", "off");
      fadeAudio(audio, 0, 400, () => audio.pause());
      return;
    }

    if (audioFadeFrameRef.current !== null) cancelAnimationFrame(audioFadeFrameRef.current);
    audio.volume = 0;
    audio.dataset.gain = "0.000";
    try {
      await audio.play();
      setSoundOn(true);
      sessionStorage.setItem("apkmason-sound", "on");
      fadeAudio(audio, 0.62, 800);
    } catch {
      setSoundOn(false);
      sessionStorage.setItem("apkmason-sound", "off");
    }
  };

  const replayExperience = () => {
    setFestivalModeRevealed(false);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    const constrained = Boolean(connection?.saveData || /2g/.test(connection?.effectiveType || ""));
    const chooseAssets = () => setMobileAssets(media.matches || constrained);
    chooseAssets();
    media.addEventListener("change", chooseAssets);
    return () => media.removeEventListener("change", chooseAssets);
  }, []);

  useEffect(() => () => {
    if (audioFadeFrameRef.current !== null) cancelAnimationFrame(audioFadeFrameRef.current);
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const videos = videoRefs.current;
    if (!stage || videos.length !== 3 || videos.some((video) => !video)) return;

    resizingRef.current = false;
    setReady(false);
    let targetProgress = 0;
    let renderProgress = 0;
    let frameId = 0;
    let resizeFrameId = 0;
    let previousNow = performance.now();
    let firstReady = false;
    let destroyed = false;
    const lastSeekAt = [0, 0, 0];
    const warmed = [false, false, false];

    const scrollProgress = () => {
      const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return clamp(window.scrollY / range);
    };

    const actualProgress = scrollProgress();
    targetProgress = progressMemoryRef.current ?? actualProgress;
    renderProgress = targetProgress;
    progressMemoryRef.current = targetProgress;

    const updateTarget = () => {
      if (resizingRef.current) return;
      targetProgress = scrollProgress();
      progressMemoryRef.current = targetProgress;
    };

    const warmVideo = (video: HTMLVideoElement, index: number) => {
      if (warmed[index] || !Number.isFinite(video.duration)) return;
      warmed[index] = true;
      let finished = false;
      const finish = () => {
        if (finished || destroyed) return;
        finished = true;
        try { video.currentTime = 0; } catch { /* RAF retries after metadata settles. */ }
        if (index === 0 && !firstReady) {
          firstReady = true;
          window.setTimeout(() => !destroyed && setReady(true), 80);
        }
      };

      try {
        video.currentTime = Math.min(0.001, Math.max(0, video.duration - 0.001));
        video.addEventListener("seeked", finish, { once: true });
        window.setTimeout(finish, 750);
      } catch { finish(); }
    };

    videos.forEach((video, index) => {
      if (!video) return;
      video.pause();
      if (video.readyState >= 1) warmVideo(video, index);
      else video.addEventListener("loadedmetadata", () => warmVideo(video, index), { once: true });
    });

    const setVideoOpacity = (progress: number) => {
      const opacities = [
        1 - smoothstep(0.325, 0.345, progress),
        smoothstep(0.325, 0.345, progress) * (1 - smoothstep(0.655, 0.68, progress)),
        smoothstep(0.655, 0.68, progress),
      ];
      videos.forEach((video, index) => {
        if (!video) return;
        video.style.opacity = opacities[index].toFixed(4);
        video.style.visibility = opacities[index] < 0.002 ? "hidden" : "visible";
      });
    };

    const seekVideos = (progress: number, now: number) => {
      videos.forEach((video, index) => {
        if (!video || video.readyState < 1 || !Number.isFinite(video.duration)) return;
        const [start, end] = SEGMENTS[index];
        const local = clamp((progress - start) / (end - start));
        const desired = Math.min(video.duration - 1 / 48, Math.max(0, local * video.duration));
        const difference = desired - video.currentTime;
        if (Math.abs(difference) < 1 / 48) return;
        if (video.seeking && now - lastSeekAt[index] < 44) return;

        const maxStep = Math.abs(difference) > 1.4 ? 0.55 : Math.abs(difference) > 0.55 ? 0.28 : 0.125;
        const nextTime = video.currentTime + clamp(difference, -maxStep, maxStep);
        try {
          video.currentTime = clamp(nextTime, 0, Math.max(0, video.duration - 1 / 48));
          lastSeekAt[index] = now;
        } catch { /* Source can briefly be unavailable while switching resolution. */ }
      });
    };

    const renderUI = (progress: number) => {
      stage.style.setProperty("--progress", progress.toFixed(5));
      stage.style.setProperty("--light-x", `${16 + progress * 70}%`);
      stage.dataset.act = progress < 0.325 ? "01" : progress < 0.655 ? "02" : "03";

      stage.querySelectorAll<HTMLElement>("[data-beat]").forEach((element) => {
        const start = Number(element.dataset.start || 0);
        const end = Number(element.dataset.end || 1);
        const opacity = beatOpacity(progress, start, end, element.dataset.hold === "true");
        element.style.opacity = opacity.toFixed(4);
        element.style.transform = `translate3d(0, ${((1 - opacity) * 18).toFixed(2)}px, 0)`;
        element.style.visibility = opacity < 0.006 ? "hidden" : "visible";
      });

      stage.querySelectorAll<HTMLElement>("[data-stage-chip]").forEach((chip, index) => {
        const phase = clamp((progress - 0.43) / 0.12) * 2.999;
        chip.dataset.active = String(Math.min(2, Math.floor(phase)) === index);
      });

      const lineup = stage.querySelector<HTMLElement>("[data-lineup-track]");
      if (lineup && window.innerWidth <= 700) {
        const phase = clamp((progress - 0.55) / 0.11) * 2;
        lineup.style.transform = `translate3d(${-phase * 33.3333}%, 0, 0)`;
      } else if (lineup) lineup.style.transform = "none";
    };

    const tick = (now: number) => {
      const delta = Math.min(64, Math.max(1, now - previousNow));
      previousNow = now;
      const smoothing = 1 - Math.pow(1 - 0.11, delta / 16.667);
      renderProgress += (targetProgress - renderProgress) * smoothing;
      if (Math.abs(targetProgress - renderProgress) < 0.00002) renderProgress = targetProgress;
      setVideoOpacity(renderProgress);
      seekVideos(renderProgress, now);
      renderUI(renderProgress);
      frameId = requestAnimationFrame(tick);
    };

    const sync = () => {
      targetProgress = scrollProgress();
      renderProgress = targetProgress;
      progressMemoryRef.current = targetProgress;
      previousNow = performance.now();
      setVideoOpacity(renderProgress);
      renderUI(renderProgress);
    };

    const retainProgressOnResize = () => {
      const retainedProgress = progressMemoryRef.current ?? targetProgress;
      resizingRef.current = true;
      cancelAnimationFrame(resizeFrameId);
      resizeFrameId = requestAnimationFrame(() => {
        const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const retainedY = retainedProgress * range;
        if (Math.abs(window.scrollY - retainedY) > 1) {
          window.scrollTo({ top: retainedY, left: 0, behavior: "auto" });
        }
        targetProgress = retainedProgress;
        renderProgress = retainedProgress;
        progressMemoryRef.current = retainedProgress;
        resizingRef.current = false;
        previousNow = performance.now();
        setVideoOpacity(renderProgress);
        renderUI(renderProgress);
      });
    };

    const onVisibility = () => { if (document.visibilityState === "visible") sync(); };
    if (Math.abs(actualProgress - targetProgress) > 0.0001) retainProgressOnResize();
    renderUI(renderProgress);
    frameId = requestAnimationFrame(tick);
    window.addEventListener("scroll", updateTarget, { passive: true });
    window.addEventListener("resize", retainProgressOnResize, { passive: true });
    window.addEventListener("orientationchange", retainProgressOnResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      destroyed = true;
      resizingRef.current = false;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(resizeFrameId);
      window.removeEventListener("scroll", updateTarget);
      window.removeEventListener("resize", retainProgressOnResize);
      window.removeEventListener("orientationchange", retainProgressOnResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mobileAssets]);

  const assetFolder = mobileAssets ? "mobile" : "desktop";
  const poster = `${BASE_URL}reference/03_finale_poster_1280.jpg`;

  return (
    <div className="scroll-spacer">
      <main
        className="experience"
        ref={stageRef}
        aria-label="APKMASON EDM Music Festival interactive film"
        style={{ "--poster-url": `url(${poster})` } as React.CSSProperties}
      >
        <div className="video-stack" aria-hidden="true">
          {FILMS.map((film, index) => (
            <video
              key={`${assetFolder}-${film}`}
              ref={(node) => { videoRefs.current[index] = node; }}
              className={`festival-film festival-film--${index + 1}`}
              muted
              playsInline
              preload={index === 0 || !mobileAssets ? "auto" : "metadata"}
              poster={index === 0 ? `${BASE_URL}reference/01_opening_logo.png` : undefined}
              src={`${BASE_URL}video/${assetFolder}/${film}`}
              tabIndex={-1}
            />
          ))}
        </div>

        <audio
          ref={audioRef}
          src={`${BASE_URL}audio/neon-skyfall.mp3`}
          preload="metadata"
          loop
          data-gain="0.000"
          onError={() => setSoundOn(false)}
        />

        <div className="static-poster" aria-hidden="true" />
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
            <small>ACCESS // 27</small>
            <strong>DESIGN FICTION</strong>
            <i aria-hidden="true" />
          </span>
          <button
            className="sound-toggle"
            type="button"
            aria-label={soundOn ? "Turn festival soundtrack off" : "Turn festival soundtrack on"}
            aria-pressed={soundOn}
            data-active={soundOn}
            onClick={toggleSound}
          >
            <i aria-hidden="true" /><span>SOUND</span><b>{soundOn ? "ON" : "OFF"}</b>
          </button>
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
            <div className="finale-actions">
              <button
                className="festival-mode"
                type="button"
                data-revealed={festivalModeRevealed}
                aria-expanded={festivalModeRevealed}
                aria-label={festivalModeRevealed ? "Festival mode coming soon" : "Enter festival mode"}
                onClick={() => setFestivalModeRevealed(true)}
              >
                <span className="mode-copy mode-copy--default" aria-hidden={festivalModeRevealed}>
                  <small>UNLOCK NEXT SIGNAL</small>
                  <strong>ENTER FESTIVAL MODE</strong>
                </span>
                <span className="mode-copy mode-copy--revealed" aria-hidden={!festivalModeRevealed}>
                  <small>TRANSMISSION 02 / QUEUED</small>
                  <strong>COMING SOON</strong>
                </span>
                <i className="mode-symbol" aria-hidden="true">↗</i>
              </button>
              <button className="replay-button" type="button" aria-label="Replay experience" onClick={replayExperience}>
                <i aria-hidden="true">↺</i><span>REPLAY EXPERIENCE</span>
              </button>
            </div>
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

        <div className={`loader ${ready ? "loader--ready" : ""}`} role="status" aria-live="polite">
          <div className="loader-brand"><span className="brand-mark">A</span><strong>APKMASON</strong></div>
          <p>TUNING THE FREQUENCY</p>
          <div className="loader-line"><i /></div>
        </div>
      </main>
    </div>
  );
}

const container = document.getElementById("root")!;
const rootScope = globalThis as typeof globalThis & { __APKMASON_ROOT__?: Root };
const root = rootScope.__APKMASON_ROOT__ ?? createRoot(container);
rootScope.__APKMASON_ROOT__ = root;

root.render(
  <React.StrictMode><App /></React.StrictMode>,
);
