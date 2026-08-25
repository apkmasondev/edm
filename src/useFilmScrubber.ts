import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ACT_BOUNDARIES,
  FILM_END_SEEK_OFFSET,
  FRAME_GATE_TIMEOUT,
  MEDIA_QUERIES,
  SEEK_EPSILON,
  SIGIL,
  SIGIL_START,
  type FilmTier,
} from "./config";
import { beatOpacity, clamp, smoothDampProgress } from "./easing";

type ScrubberOptions = {
  stageRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  tier: FilmTier;
  reducedMotion: boolean;
};

/**
 * The scroll engine.
 *
 * Scroll position drives a single master film's currentTime, plus every derived surface (copy
 * beats, HUD, stage chips, the finale reticle). Three rules keep it cheap:
 *
 *   1. Nothing reads layout during a scroll event. The scroll range is measured on resize and
 *      cached; a scroll event only reads window.scrollY, which is free.
 *   2. Every write is guarded by the value it last wrote. The loop runs at display rate but only
 *      touches the DOM when a number actually changed.
 *   3. The loop parks itself once the follower has settled and no seek is outstanding, and is woken
 *      by scroll, resize or a late metadata event.
 *
 * Returns whether the first frame has been presented, which is what dismisses the loader.
 */
export function useFilmScrubber({ stageRef, videoRef, tier, reducedMotion }: ScrubberOptions) {
  const [ready, setReady] = useState(false);
  // Survives a tier switch, so resizing across the 900px boundary does not jump the film.
  const progressMemoryRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) return;

    const stage = stageRef.current;
    // Snapshot the element this effect owns. A tier switch remounts the <video>, and by cleanup
    // time videoRef.current already points at the *next* render's element.
    const video = videoRef.current;
    if (!stage || !video) return;

    setReady(false);

    let destroyed = false;
    let resizing = false;
    let frameId = 0;
    let resizeFrameId: number | null = null;
    let previousNow = performance.now();

    let targetProgress = 0;
    let renderProgress = 0;
    let renderVelocity = 0;
    let scrollRange = 1;
    let rangeStale = false;

    let lastRenderedProgress = Number.NaN;
    let lastMotionBlur = -1;
    let lastAct = "";
    let lastLineupTransform = "";
    let activeStageChip = -1;
    let sigilActive = false;
    let sigilFits: boolean | null = null;

    let queuedSeekTime: number | null = null;
    let seekInFlight = false;
    let frameCallbackId: number | null = null;
    let frameGateTimeoutId: number | null = null;
    let lastSeekAt = 0;

    let warmed = false;
    let revealed = false;
    let revealFrameCallbackId: number | null = null;
    let readyDelayId: number | null = null;

    const compactQuery = window.matchMedia(MEDIA_QUERIES.compactLineup);
    const finePointerQuery = window.matchMedia(MEDIA_QUERIES.finePointer);
    let compactLineup = compactQuery.matches;

    // Beat ranges are parsed once. Re-reading and re-coercing eleven data attributes on every
    // animation frame was pure overhead.
    const beatElements = Array.from(stage.querySelectorAll<HTMLElement>("[data-beat]"));
    const beatRanges = beatElements.map((element) => ({
      start: Number(element.dataset.start ?? 0),
      end: Number(element.dataset.end ?? 1),
      hold: element.dataset.hold === "true",
    }));
    const beatVisible: Array<boolean | null> = beatElements.map(() => null);
    const stageChips = Array.from(stage.querySelectorAll<HTMLElement>("[data-stage-chip]"));
    const lineup = stage.querySelector<HTMLElement>("[data-lineup-track]");

    // Per-frame custom properties are written onto the one element that consumes each of them.
    // Writing an inherited custom property on the stage would invalidate style for everything under
    // it — the whole HUD and every copy beat — on every single frame.
    const glow = stage.querySelector<HTMLElement>(".festival-glow");
    const timelineFill = stage.querySelector<HTMLElement>(".timeline b");
    const videoStack = stage.querySelector<HTMLElement>(".video-stack");
    const sigilBox = stage.querySelector<HTMLElement>(".finale-sigil");

    const supportsFrameCallback = typeof video.requestVideoFrameCallback === "function";
    // Motion blur is a full-screen filter over the film. It buys atmosphere on a desktop GPU and
    // costs real frames on a phone, so it is opt-in by device class.
    const allowMotionBlur = tier === "desktop" && finePointerQuery.matches;
    stage.dataset.frameSync = supportsFrameCallback ? "video-frame" : "raf";
    stage.dataset.motionBlur = String(allowMotionBlur);

    // ---- scroll position -------------------------------------------------------------------

    const measureScrollRange = () => (
      Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    );

    /**
     * scrollHeight is a layout read, and reading it on every scroll event is what turns a scroll
     * into a forced style/layout flush — the loop has already written custom properties by then.
     * So it is cached, and re-measured only when something could actually have changed it: a
     * resize marks it stale, and a scrollY beyond the cached maximum proves it stale.
     */
    const scrollProgress = () => {
      if (rangeStale) {
        rangeStale = false;
        scrollRange = measureScrollRange();
      }
      const y = window.scrollY;
      if (y > scrollRange) scrollRange = measureScrollRange();
      return clamp(y / scrollRange);
    };

    scrollRange = measureScrollRange();
    const actualProgress = scrollProgress();
    targetProgress = progressMemoryRef.current ?? actualProgress;
    renderProgress = targetProgress;
    progressMemoryRef.current = targetProgress;

    // ---- seeking ---------------------------------------------------------------------------

    const releaseFrameGate = (cancelCallback: boolean) => {
      if (cancelCallback && frameCallbackId !== null) {
        try { video.cancelVideoFrameCallback(frameCallbackId); } catch { /* may already be completing */ }
      }
      frameCallbackId = null;
      if (frameGateTimeoutId !== null) clearTimeout(frameGateTimeoutId);
      frameGateTimeoutId = null;
      seekInFlight = false;
    };

    /**
     * Seeks are gated on the frame they produce: issuing the next one before the previous frame is
     * presented makes the decoder drop work it already started, which is what a scrub feels like
     * when it "sticks". The timeout is the escape hatch for a seek whose frame never arrives.
     */
    const flushSeek = (now: number) => {
      const desired = queuedSeekTime;
      if (desired === null || seekInFlight || destroyed) return;
      queuedSeekTime = null;

      if (Math.abs(desired - video.currentTime) < SEEK_EPSILON) return;

      if (!supportsFrameCallback) {
        if (video.seeking && now - lastSeekAt < 32) {
          queuedSeekTime = desired;
          return;
        }
        try {
          video.currentTime = desired;
          lastSeekAt = now;
        } catch { /* source can briefly be unavailable while switching tiers */ }
        return;
      }

      try {
        seekInFlight = true;
        video.currentTime = desired;
        lastSeekAt = now;
        const callbackId = video.requestVideoFrameCallback(() => {
          if (frameCallbackId !== callbackId) return;
          releaseFrameGate(false);
          flushSeek(performance.now());
        });
        frameCallbackId = callbackId;
        frameGateTimeoutId = window.setTimeout(() => {
          if (frameCallbackId !== callbackId) return;
          releaseFrameGate(true);
          flushSeek(performance.now());
        }, FRAME_GATE_TIMEOUT);
      } catch {
        releaseFrameGate(true);
      }
    };

    const queueSeek = (progress: number) => {
      if (video.readyState < 1 || !Number.isFinite(video.duration)) return;
      const maxTime = Math.max(0, video.duration - FILM_END_SEEK_OFFSET);
      queuedSeekTime = clamp(progress) * maxTime;
    };

    // ---- painting --------------------------------------------------------------------------

    const renderUI = (progress: number) => {
      timelineFill?.style.setProperty("--progress", progress.toFixed(5));
      // vw rather than %: the glow is positioned with a transform, where % would resolve against
      // the element's own box instead of the viewport.
      glow?.style.setProperty("--light-x", `${(16 + progress * 70).toFixed(3)}vw`);

      const act = progress < ACT_BOUNDARIES[0] ? "01" : progress < ACT_BOUNDARIES[1] ? "02" : "03";
      if (act !== lastAct) {
        lastAct = act;
        stage.dataset.act = act;
      }

      const nextSigilActive = progress >= SIGIL_START;
      if (nextSigilActive !== sigilActive) {
        sigilActive = nextSigilActive;
        stage.dataset.sigilActive = String(nextSigilActive);
      }

      for (let index = 0; index < beatElements.length; index += 1) {
        const element = beatElements[index];
        const { start, end, hold } = beatRanges[index];
        const opacity = beatOpacity(progress, start, end, hold);
        const visible = opacity >= 0.006;
        // Only the handful of beats currently on screen are worth a compositor layer; promoting all
        // of them permanently costs real VRAM on phones.
        if (beatVisible[index] !== visible) {
          beatVisible[index] = visible;
          element.style.visibility = visible ? "visible" : "hidden";
          element.style.willChange = visible ? "transform, opacity" : "auto";
        }
        if (!visible) continue;
        element.style.opacity = opacity.toFixed(4);
        element.style.transform = `translate3d(0, ${((1 - opacity) * 18).toFixed(2)}px, 0)`;
      }

      const chipPhase = clamp((progress - 0.43) / 0.12) * 2.999;
      const nextStageChip = Math.min(2, Math.floor(chipPhase));
      if (nextStageChip !== activeStageChip) {
        activeStageChip = nextStageChip;
        for (let index = 0; index < stageChips.length; index += 1) {
          stageChips[index].dataset.active = String(index === activeStageChip);
        }
      }

      if (lineup) {
        const transform = compactLineup
          ? `translate3d(${(clamp((progress - 0.55) / 0.11) * -66.6666).toFixed(4)}%, 0, 0)`
          : "none";
        if (transform !== lastLineupTransform) {
          lastLineupTransform = transform;
          lineup.style.transform = transform;
        }
      }
    };

    /**
     * Re-derives the sigil's pixel box from the film's actual cover geometry. object-fit: cover
     * scales the frame by whichever axis overflows and crops the other, so a fixed % overlay would
     * slide off the letter as soon as the viewport aspect changed. This solves the same mapping the
     * browser does, including any object-position offset.
     */
    const syncSigil = () => {
      if (!video.videoWidth || !video.videoHeight) return;

      const boxWidth = stage.clientWidth;
      const boxHeight = stage.clientHeight;
      const scale = Math.max(boxWidth / video.videoWidth, boxHeight / video.videoHeight);
      const frameWidth = video.videoWidth * scale;
      const frameHeight = video.videoHeight * scale;

      const [rawX, rawY] = window.getComputedStyle(video).objectPosition.split(" ");
      const axisOffset = (raw: string | undefined, slack: number) => {
        if (!raw) return slack * 0.5;
        if (raw.endsWith("%")) return slack * (parseFloat(raw) / 100);
        if (raw.endsWith("px")) return parseFloat(raw);
        return slack * 0.5;
      };
      const offsetX = axisOffset(rawX, boxWidth - frameWidth);
      const offsetY = axisOffset(rawY, boxHeight - frameHeight);

      const centerX = offsetX + SIGIL.centerX * frameWidth;
      const centerY = offsetY + SIGIL.centerY * frameHeight;
      const width = SIGIL.width * frameWidth;
      const height = SIGIL.height * frameHeight;

      sigilBox?.style.setProperty("--sigil-x", `${centerX.toFixed(2)}px`);
      sigilBox?.style.setProperty("--sigil-y", `${centerY.toFixed(2)}px`);
      sigilBox?.style.setProperty("--sigil-w", `${width.toFixed(2)}px`);
      sigilBox?.style.setProperty("--sigil-h", `${height.toFixed(2)}px`);

      // On a narrow portrait viewport, cover crops the letter itself off both edges. Tracking it
      // faithfully then means the brackets sit outside the screen and only a stray scan line shows,
      // so the reticle stands down instead of half-rendering.
      const margin = 6;
      const fits = centerX - width / 2 >= margin
        && centerX + width / 2 <= boxWidth - margin
        && centerY - height / 2 >= margin
        && centerY + height / 2 <= boxHeight - margin;
      if (fits !== sigilFits) {
        sigilFits = fits;
        stage.dataset.sigil = fits ? "on" : "off";
      }
    };

    const renderFrame = (progress: number, now: number) => {
      if (progress !== lastRenderedProgress) {
        lastRenderedProgress = progress;
        renderUI(progress);
      }
      queueSeek(progress);
      flushSeek(now);
    };

    // ---- the loop --------------------------------------------------------------------------

    const tick = (now: number) => {
      const delta = Math.min(64, Math.max(1, now - previousNow));
      previousNow = now;
      [renderProgress, renderVelocity] = smoothDampProgress(
        renderProgress,
        targetProgress,
        renderVelocity,
        delta / 1000,
      );
      if (Math.abs(targetProgress - renderProgress) < 0.00001 && Math.abs(renderVelocity) < 0.0001) {
        renderProgress = targetProgress;
        renderVelocity = 0;
      }

      const motionBlur = allowMotionBlur
        ? clamp((Math.abs(renderVelocity) - 0.015) * 0.9, 0, 0.36)
        : 0;
      if ((motionBlur === 0 && lastMotionBlur !== 0) || Math.abs(motionBlur - lastMotionBlur) >= 0.004) {
        lastMotionBlur = motionBlur;
        videoStack?.style.setProperty("--motion-blur", `${motionBlur.toFixed(3)}px`);
      }

      renderFrame(renderProgress, now);

      // Nothing left to drive: let the loop sleep instead of rewriting identical styles at 60fps.
      // A queued or in-flight seek still needs frames to drain, even once scrolling has stopped.
      const settled = renderProgress === targetProgress && renderVelocity === 0;
      if (settled && queuedSeekTime === null && !seekInFlight) {
        frameId = 0;
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (frameId || destroyed) return;
      previousNow = performance.now();
      frameId = requestAnimationFrame(tick);
    };

    const updateTarget = () => {
      if (resizing) return;
      targetProgress = scrollProgress();
      progressMemoryRef.current = targetProgress;
      wake();
    };

    /** Snap follower and film to the current scroll position without easing through the gap. */
    const snapTo = (progress: number) => {
      targetProgress = progress;
      renderProgress = progress;
      renderVelocity = 0;
      progressMemoryRef.current = progress;
      previousNow = performance.now();
      lastRenderedProgress = Number.NaN;
      renderFrame(progress, previousNow);
      wake();
    };

    /**
     * Everything that depends on viewport geometry is re-measured in one coalesced frame, whichever
     * kind of resize asked for it. There is exactly one scheduled pass and one owner of the
     * `resizing` latch: a second scheduler cancelling the first one's frame is how the scroll
     * reader ends up frozen with that latch stuck true.
     */
    let pendingReanchor = false;
    let reanchorProgress = 0;

    const runGeometryPass = () => {
      resizeFrameId = null;
      compactLineup = compactQuery.matches;
      rangeStale = false;
      scrollRange = measureScrollRange();
      syncSigil();
      // The lineup track's transform depends on compactLineup, which may have just flipped.
      lastLineupTransform = "";

      if (pendingReanchor) {
        pendingReanchor = false;
        // A resize changes the scroll range, so the same scrollY now lands on a different frame.
        // Put the page back on the progress the visitor was actually at — captured when the resize
        // was observed, not now, because the browser's own scroll adjustment lands in between.
        const retainedProgress = reanchorProgress;
        const retainedY = retainedProgress * scrollRange;
        if (Math.abs(window.scrollY - retainedY) > 1) {
          window.scrollTo({ top: retainedY, left: 0, behavior: "auto" });
        }
        resizing = false;
        snapTo(retainedProgress);
        return;
      }

      resizing = false;
      lastRenderedProgress = Number.NaN;
      updateTarget();
    };

    const scheduleGeometryPass = (reanchor: boolean) => {
      rangeStale = true;
      if (reanchor && !pendingReanchor) {
        pendingReanchor = true;
        reanchorProgress = progressMemoryRef.current ?? targetProgress;
        // Freeze the scroll reader until the pass runs, so the browser's own scroll adjustment
        // during the resize cannot overwrite the progress we are about to restore.
        resizing = true;
      }
      if (resizeFrameId === null) resizeFrameId = requestAnimationFrame(runGeometryPass);
    };

    const retainProgressOnResize = () => scheduleGeometryPass(true);

    let lastViewportWidth = window.innerWidth;
    let lastViewportHeight = window.innerHeight;

    /**
     * Mobile browsers fire resize while the URL bar slides away: same width, a chrome-sized change
     * in height, and it happens *during* a scroll gesture. Re-anchoring scrollY there would fight
     * the very gesture that caused it, so that case only refreshes the derived geometry and lets
     * the follower ease to whatever progress the new range implies.
     */
    const onViewportChange = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const chromeOnly = width === lastViewportWidth
        && Math.abs(height - lastViewportHeight) < lastViewportHeight * 0.25;
      lastViewportWidth = width;
      lastViewportHeight = height;
      scheduleGeometryPass(!chromeOnly);
    };

    // ---- first frame -----------------------------------------------------------------------

    const reveal = () => {
      if (revealed || destroyed) return;
      revealed = true;
      clearTimeout(readyFallbackId);
      if (readyDelayId !== null) {
        clearTimeout(readyDelayId);
        readyDelayId = null;
      }
      if (revealFrameCallbackId !== null) {
        try { video.cancelVideoFrameCallback(revealFrameCallbackId); } catch { /* already fired */ }
        revealFrameCallbackId = null;
      }
      setReady(true);
    };

    /**
     * Metadata has landed, so duration and intrinsic size are known. Put the film on the frame the
     * current scroll position actually calls for, and hold the loader until that frame is on
     * screen — revealing earlier shows a black stage for a beat.
     */
    const warm = () => {
      if (warmed || destroyed || !Number.isFinite(video.duration)) return;
      warmed = true;
      rangeStale = true;
      syncSigil();
      lastRenderedProgress = Number.NaN;
      renderFrame(renderProgress, performance.now());
      wake();

      if (supportsFrameCallback) {
        try {
          revealFrameCallbackId = video.requestVideoFrameCallback(() => {
            revealFrameCallbackId = null;
            reveal();
          });
        } catch { /* fall through to the timer below */ }
      }
      readyDelayId = window.setTimeout(reveal, supportsFrameCallback ? 600 : 220);
    };

    const readyFallbackId = window.setTimeout(reveal, 3000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        rangeStale = true;
        snapTo(scrollProgress());
      }
    };

    video.pause();
    if (video.readyState >= 1) warm();
    else video.addEventListener("loadedmetadata", warm);

    if (Math.abs(actualProgress - targetProgress) > 0.0001) retainProgressOnResize();
    syncSigil();
    renderFrame(renderProgress, previousNow);
    frameId = requestAnimationFrame(tick);
    window.addEventListener("scroll", updateTarget, { passive: true });
    window.addEventListener("resize", onViewportChange, { passive: true });
    window.addEventListener("orientationchange", retainProgressOnResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      destroyed = true;
      clearTimeout(readyFallbackId);
      if (readyDelayId !== null) clearTimeout(readyDelayId);
      if (revealFrameCallbackId !== null) {
        try { video.cancelVideoFrameCallback(revealFrameCallbackId); } catch { /* already fired */ }
      }
      releaseFrameGate(true);
      queuedSeekTime = null;
      cancelAnimationFrame(frameId);
      if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
      video.removeEventListener("loadedmetadata", warm);
      window.removeEventListener("scroll", updateTarget);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", retainProgressOnResize);
      document.removeEventListener("visibilitychange", onVisibility);
      // A detached <video> holds its decoded buffer and its connection until GC eventually runs.
      // isConnected keeps this from touching an element that is merely being re-configured.
      if (!video.isConnected) {
        video.removeAttribute("src");
        video.load();
      }
      timelineFill?.style.removeProperty("--progress");
      glow?.style.removeProperty("--light-x");
      videoStack?.style.removeProperty("--motion-blur");
      for (const name of ["--sigil-x", "--sigil-y", "--sigil-w", "--sigil-h"]) {
        sigilBox?.style.removeProperty(name);
      }
      delete stage.dataset.sigil;
      delete stage.dataset.sigilActive;
      delete stage.dataset.frameSync;
      delete stage.dataset.motionBlur;
    };
  }, [stageRef, videoRef, tier, reducedMotion]);

  return ready;
}
