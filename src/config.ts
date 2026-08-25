/**
 * Everything the experience is tuned against, in one place.
 *
 * Scroll progress (0..1) is the single source of truth: it drives the film's currentTime, the copy
 * beats, the HUD and the finale sigil. Every constant below is expressed in that space so the
 * relationships between them stay readable.
 */

export const BASE_URL = import.meta.env.BASE_URL;

/**
 * One master per tier rather than three films per tier. See scripts/build-media.sh for how they are
 * cut and why; the short version is that three <video> elements meant three decoders and three
 * frame buffers alive at once, which is what made phones struggle.
 */
export const FILM_TIERS = {
  desktop: { file: "festival-master-1280.mp4", width: 1280, height: 720 },
  mobile: { file: "festival-master-960.mp4", width: 960, height: 540 },
} as const;

export type FilmTier = keyof typeof FILM_TIERS;

export const filmSource = (tier: FilmTier) => `${BASE_URL}video/${FILM_TIERS[tier].file}`;
export const OPENING_POSTER = `${BASE_URL}reference/01_opening_logo.webp`;
export const FINALE_POSTER = `${BASE_URL}reference/03_finale_poster_1280.jpg`;
export const SOUNDTRACK = `${BASE_URL}audio/neon-skyfall.mp3`;

/**
 * The master is 24fps. Backing the final seek off the exact duration by half a frame avoids landing
 * past the last decodable frame, which some decoders answer with a black flash.
 */
export const FILM_END_SEEK_OFFSET = 1 / 48;

/** Below this, a queued seek is closer than one frame and would decode the frame already on screen. */
export const SEEK_EPSILON = 1 / 120;

/** How long a gated seek waits for its frame before the loop stops trusting the frame callback. */
export const FRAME_GATE_TIMEOUT = 120;

/**
 * Where the firework "A" sits inside the master's final frame, in normalized frame coordinates.
 * Measured off the decoded frame itself, so the overlay is anchored to the artwork rather than to
 * the viewport: the mapping in useFilmScrubber re-derives its pixel position from the film's own
 * cover geometry on every resize, which is what keeps it from drifting off the letter.
 * The box is padded slightly beyond the letter so its glow is not clipped.
 */
export const SIGIL = { centerX: 0.5, centerY: 0.4, width: 0.38, height: 0.56 } as const;

/**
 * Progress at which the reticle locks on. The old three-film build used 0.94 of a piecewise
 * mapping; on the single 29s master the same frame of footage lands here instead.
 */
export const SIGIL_START = 0.938;

/** Act boundaries, used only for the HUD label. The film itself is continuous. */
export const ACT_BOUNDARIES = [0.325, 0.655] as const;

/** Smoothing constant for the scroll follower, in seconds to reach the target. */
export const SCROLL_SMOOTH_TIME = 0.11;

export const STAGES = [
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

export const MEDIA_QUERIES = {
  mobileAssets: "(max-width: 900px)",
  compactLineup: "(max-width: 700px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  finePointer: "(hover: hover) and (pointer: fine)",
} as const;
