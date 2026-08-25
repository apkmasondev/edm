import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "./easing";

const TARGET_GAIN = 0.62;

/**
 * The soundtrack toggle.
 *
 * Two invariants hold this together. `commandRef` is a monotonic ticket: every play/pause intent
 * takes one, and any async continuation that no longer holds the current ticket abandons its work,
 * which is what stops a slow play() from unmuting after the user already muted. `soundOnRef`
 * mirrors the state so those continuations read the intent without re-subscribing.
 */
export function useSoundtrack() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const commandRef = useRef(0);
  const soundOnRef = useRef(false);
  const suspendedByTabRef = useRef(false);
  const [soundOn, setSoundOn] = useState(false);

  const setSound = useCallback((enabled: boolean) => {
    soundOnRef.current = enabled;
    setSoundOn(enabled);
  }, []);

  const cancelFade = useCallback(() => {
    if (fadeFrameRef.current !== null) {
      cancelAnimationFrame(fadeFrameRef.current);
      fadeFrameRef.current = null;
    }
  }, []);

  const fadeAudio = useCallback((
    audio: HTMLAudioElement,
    targetVolume: number,
    duration: number,
    onComplete?: () => void,
  ) => {
    cancelFade();
    const startVolume = audio.volume;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      audio.volume = clamp(startVolume + (targetVolume - startVolume) * eased);
      audio.dataset.gain = audio.volume.toFixed(3);
      if (progress < 1) fadeFrameRef.current = requestAnimationFrame(tick);
      else {
        fadeFrameRef.current = null;
        onComplete?.();
      }
    };

    fadeFrameRef.current = requestAnimationFrame(tick);
  }, [cancelFade]);

  const toggleSound = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    const shouldTurnOn = !soundOnRef.current;
    const command = ++commandRef.current;
    suspendedByTabRef.current = false;
    setSound(shouldTurnOn);

    if (!shouldTurnOn) {
      fadeAudio(audio, 0, 400, () => {
        if (command === commandRef.current && !soundOnRef.current) audio.pause();
      });
      return;
    }

    cancelFade();
    audio.volume = 0;
    audio.dataset.gain = "0.000";
    try {
      await audio.play();
      if (command !== commandRef.current || !soundOnRef.current) {
        audio.pause();
        return;
      }
      fadeAudio(audio, TARGET_GAIN, 800);
    } catch {
      if (command === commandRef.current) setSound(false);
    }
  }, [cancelFade, fadeAudio, setSound]);

  const handleAudioError = useCallback(() => {
    commandRef.current += 1;
    suspendedByTabRef.current = false;
    setSound(false);
    cancelFade();
    audioRef.current?.pause();
  }, [cancelFade, setSound]);

  // A background tab should be silent. The toggle keeps reading ON, because the intent to hear the
  // soundtrack has not changed — only the tab's visibility has — so returning resumes it.
  useEffect(() => {
    const onVisibilityChange = () => {
      const audio = audioRef.current;
      if (!audio) return;

      if (document.visibilityState === "hidden") {
        if (!soundOnRef.current) return;
        commandRef.current += 1;
        cancelFade();
        audio.pause();
        suspendedByTabRef.current = true;
        return;
      }

      if (!suspendedByTabRef.current) return;
      suspendedByTabRef.current = false;
      if (!soundOnRef.current) return;

      const command = ++commandRef.current;
      audio.volume = 0;
      audio.dataset.gain = "0.000";
      audio.play().then(() => {
        if (command !== commandRef.current || !soundOnRef.current) {
          audio.pause();
          return;
        }
        fadeAudio(audio, TARGET_GAIN, 600);
      }).catch(() => {
        if (command === commandRef.current) setSound(false);
      });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [cancelFade, fadeAudio, setSound]);

  // Unmount must not leave a fade loop or a playing element behind.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      commandRef.current += 1;
      if (fadeFrameRef.current !== null) {
        cancelAnimationFrame(fadeFrameRef.current);
        fadeFrameRef.current = null;
      }
      audio?.pause();
    };
  }, []);

  return { audioRef, soundOn, toggleSound, handleAudioError };
}
