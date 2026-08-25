import { SCROLL_SMOOTH_TIME } from "./config";

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return x * x * (3 - 2 * x);
};

/** Fade a copy beat in over its own leading edge and out over its trailing one. */
export function beatOpacity(progress: number, start: number, end: number, hold: boolean) {
  const fade = Math.min(0.014, Math.max(0.005, (end - start) * 0.18));
  const enter = smoothstep(start, start + fade, progress);
  const exit = hold ? 1 : 1 - smoothstep(end - fade, end, progress);
  return enter * exit;
}

/**
 * Critically damped follower (Game Programming Gems 4). Frame-rate independent, so a 120Hz display
 * and a throttled 30Hz one settle over the same wall-clock time.
 */
export function smoothDampProgress(
  current: number,
  target: number,
  velocity: number,
  deltaSeconds: number,
) {
  const omega = 2 / SCROLL_SMOOTH_TIME;
  const x = omega * deltaSeconds;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * deltaSeconds;
  let nextVelocity = (velocity - omega * temp) * decay;
  let nextProgress = target + (change + temp) * decay;

  // Overshoot guard: snap rather than ring around the target.
  if ((target - current > 0) === (nextProgress > target)) {
    nextProgress = target;
    nextVelocity = 0;
  }

  return [nextProgress, nextVelocity] as const;
}
