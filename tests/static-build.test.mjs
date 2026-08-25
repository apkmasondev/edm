import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

// Line endings are pinned to LF by .gitattributes; normalise on read anyway, so a stray CRLF
// checkout fails the assertion it should fail rather than every assertion that slices on a
// newline.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")
  .then((text) => text.replace(/\r\n/g, "\n"));
const sizeOf = (path) => stat(new URL(`../${path}`, import.meta.url)).then(({ size }) => size);

/** Minimal MP4 box reader: enough to check fast-start and keyframe spacing without a dependency. */
function inspectMp4(bytes) {
  const moov = bytes.indexOf(Buffer.from("moov"));
  const mdat = bytes.indexOf(Buffer.from("mdat"));
  const stss = bytes.indexOf(Buffer.from("stss"));

  let keyframes = null;
  if (stss > 0) {
    const count = bytes.readUInt32BE(stss + 8);
    keyframes = [];
    for (let index = 0; index < count; index += 1) {
      keyframes.push(bytes.readUInt32BE(stss + 12 + index * 4));
    }
  }
  return { moov, mdat, keyframes };
}

test("build contains the complete festival experience", async () => {
  const html = await read("dist/index.html");
  assert.match(html, /APKMASON EDM Music Festival/);
  assert.match(html, /Interactive Design Fiction/);
  assert.match(html, /\.\/assets\/index-/);
  assert.doesNotMatch(html, /codex-preview|Starter Project/);

  const localUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => !/^(?:https?:|data:|#)/.test(url));
  assert.ok(localUrls.length > 0);
  assert.ok(localUrls.every((url) => url.startsWith("./")), `Non-relative build URL: ${localUrls.join(", ")}`);
});

test("the shipped films are single seekable masters, not a stack of act files", async () => {
  const files = (await readdir(new URL("../dist/video/", import.meta.url), { recursive: true }))
    .map((file) => file.replaceAll("\\", "/"));
  assert.deepEqual(
    files.sort(),
    ["festival-master-1280.mp4", "festival-master-960.mp4"],
    "one master per tier; three films per tier meant three live decoders",
  );

  // Byte budgets. The pre-master build shipped 37.4 MB to desktop and 22.5 MB to mobile; these caps
  // exist so a future re-encode cannot quietly walk that back.
  for (const [file, maxBytes] of [
    ["dist/video/festival-master-1280.mp4", 16_000_000],
    ["dist/video/festival-master-960.mp4", 10_000_000],
  ]) {
    const size = await sizeOf(file);
    assert.ok(size > 1_000_000, `${file} is suspiciously small at ${size} bytes`);
    assert.ok(size <= maxBytes, `${file} is ${size} bytes, budget is ${maxBytes}`);
  }
});

test("each master stays cheap to seek into", async () => {
  for (const file of ["festival-master-1280.mp4", "festival-master-960.mp4"]) {
    const bytes = await readFile(new URL(`../dist/video/${file}`, import.meta.url));
    const { moov, mdat, keyframes } = inspectMp4(bytes);

    assert.ok(moov > 0 && mdat > moov, `${file} is missing MP4 fast-start`);
    assert.ok(keyframes && keyframes.length > 1, `${file} has no seek index`);

    // Scroll scrubbing is random access. A keyframe every half second (12 frames at 24fps) bounds
    // how much the decoder has to replay for any seek; anything sparser starts to feel sticky.
    const gaps = keyframes.slice(1).map((frame, index) => frame - keyframes[index]);
    assert.ok(
      Math.max(...gaps) <= 12,
      `${file} has a ${Math.max(...gaps)}-frame keyframe gap and will stutter during scroll scrubbing`,
    );
    assert.equal(keyframes[0], 1, `${file} does not start on a keyframe`);
  }
});

test("GitHub Pages output includes the loopable soundtrack", async () => {
  const size = await sizeOf("dist/audio/neon-skyfall.mp3");
  assert.ok(size > 300_000, "the soundtrack looks truncated");
  assert.ok(size < 700_000, "the soundtrack is heavier than a looping ambient bed needs to be");
});

test("GitHub Pages output includes the festival favicon", async () => {
  const svg = await read("dist/favicon.svg");
  assert.match(svg, /linearGradient id="laser"/);
});

test("build excludes masters, duplicate media and obsolete starter files", async () => {
  const files = (await readdir(new URL("../dist/", import.meta.url), { recursive: true }))
    .map((file) => file.replaceAll("\\", "/"));

  for (const forbidden of [
    "masters/",
    "video/desktop/",
    "video/mobile/",
    "reference/02_transition_frame.png",
    "reference/03_finale_poster.png",
    "rendered-html.test.mjs",
  ]) {
    assert.ok(!files.some((file) => file === forbidden || file.startsWith(forbidden)), `Unexpected build file: ${forbidden}`);
  }
});

test("deployment configuration stays Pages-compatible", async () => {
  const [packageJson, viteConfig, workflow, html] = await Promise.all([
    read("package.json"),
    read("vite.config.ts"),
    read(".github/workflows/deploy-pages.yml"),
    read("dist/index.html"),
  ]);

  assert.equal(JSON.parse(packageJson).engines.node, ">=22.13.0");
  assert.match(viteConfig, /base:\s*["']\.\/["']/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version:\s*22\b/);
  assert.match(workflow, /path:\s*dist\b/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  // No third-party script, style, media or fetch origin may be reachable, whatever else the policy
  // has to tolerate for the CDN's edge-injected snippet.
  assert.doesNotMatch(html, /script-src[^;"]*https?:/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
});

test("playback policy: nothing autoplays and nothing is stored on the visitor", async () => {
  const app = await read("src/App.tsx");

  assert.match(app, /muted\s+playsInline\s+preload=/);
  assert.match(app, /preload="none"\s+loop/);
  assert.doesNotMatch(app, /sessionStorage|localStorage|autoplay/);
  // One <video>, one decoder. A regression back to a per-act stack would reintroduce the key line.
  assert.equal(app.match(/<video\b/g).length, 1);
});

test("scroll engine keeps its playback and lifecycle guarantees", async () => {
  const source = await read("src/useFilmScrubber.ts");

  // Scroll listening must stay passive so the main thread is never blocked mid-gesture...
  assert.match(source, /window\.addEventListener\("scroll", updateTarget, \{ passive: true \}\)/);
  // ...and must not read layout, which is what forces a synchronous reflow per scroll event.
  const onScroll = source.match(/const updateTarget = \(\) => \{[\s\S]*?\n {4}\};/)[0];
  assert.doesNotMatch(onScroll, /scrollHeight|clientHeight|getBoundingClientRect/);
  assert.match(source, /const measureScrollRange = \(\)/);

  // Frame-accurate scrubbing: seeks are gated on presented frames, with a timeout escape hatch.
  assert.match(source, /requestVideoFrameCallback/);
  assert.match(source, /cancelVideoFrameCallback/);
  assert.match(source, /frameGateTimeoutId/);

  // The render loop must be able to park when nothing is moving, and be woken again.
  assert.match(source, /const settled =/);
  assert.match(source, /frameId = 0;\s*\n\s*return;/);
  assert.match(source, /const wake = \(\) => \{/);

  // A detached film must hand its decoder and buffer back rather than waiting for GC.
  assert.match(source, /!video\.isConnected/);
  assert.match(source, /video\.removeAttribute\("src"\)/);

  // Every listener, timer, frame request and frame callback registered above has to be released.
  const cleanup = source.slice(source.indexOf("return () => {"));
  for (const released of [
    "clearTimeout(readyFallbackId)",
    "clearTimeout(readyDelayId)",
    "cancelVideoFrameCallback",
    "releaseFrameGate(true)",
    "cancelAnimationFrame(frameId)",
    'removeEventListener("scroll", updateTarget)',
    'removeEventListener("resize", onViewportChange)',
    'removeEventListener("orientationchange", retainProgressOnResize)',
    'removeEventListener("visibilitychange", onVisibility)',
    'removeEventListener("loadedmetadata", warm)',
  ]) {
    assert.ok(cleanup.includes(released), `cleanup never releases: ${released}`);
  }
});

test("a dead film falls back to the static poster instead of a black screen", async () => {
  const app = await read("src/App.tsx");
  assert.match(app, /onError=\{handleFilmError\}/);
  assert.match(app, /data-film-fallback=\{filmFallback\}/);
  // The loader must stand down on that path too, or the fallback poster sits behind it.
  assert.match(app, /const showLoader = !reducedMotion && !filmFallback && !ready;/);
});

test("soundtrack follows tab visibility without losing the user's intent", async () => {
  const source = await read("src/useSoundtrack.ts");

  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
  // Hiding the tab pauses; it must not flip the toggle, or returning would come back silent.
  assert.match(source, /visibilityState === "hidden"[\s\S]{0,400}audio\.pause\(\)/);
  assert.match(source, /suspendedByTabRef/);
  // A manual mute has to survive a hide/show round trip.
  assert.match(source, /if \(!suspendedByTabRef\.current\) return;/);
  assert.match(source, /suspendedByTabRef\.current = false;\s*\n\s*if \(!soundOnRef\.current\) return;/);
});

test("state that only one control cares about does not re-render the film stage", async () => {
  const app = await read("src/App.tsx");
  // useState in App would drag every copy beat and all eighteen artists through reconciliation on
  // a soundtrack toggle. Both toggles live in their own memoised leaves instead.
  assert.match(app, /const Soundtrack = memo\(/);
  assert.match(app, /const FinaleActions = memo\(/);
  assert.match(app, /useSoundtrack\(\)/);
  const appBody = app.slice(app.indexOf("export function App()"));
  assert.equal((appBody.match(/useState/g) ?? []).length, 1, "App itself should only own the film fallback");

  const stageList = await read("src/StageList.tsx");
  assert.match(stageList, /memo\(function StageList/);
});

test("the finale sigil is anchored to the film, not the viewport", async () => {
  const [source, config, app, styles] = await Promise.all([
    read("src/useFilmScrubber.ts"),
    read("src/config.ts"),
    read("src/App.tsx"),
    read("src/styles.css"),
  ]);

  // The mapping must come from the film's own cover geometry, including object-position.
  assert.match(source, /Math\.max\(boxWidth \/ video\.videoWidth, boxHeight \/ video\.videoHeight\)/);
  assert.match(source, /objectPosition/);
  assert.match(source, /--sigil-x/);
  assert.match(source, /stage\.dataset\.sigil = fits \? "on" : "off"/);
  assert.match(source, /stage\.dataset\.sigilActive = String\(nextSigilActive\)/);
  assert.match(config, /SIGIL_START = 0\.9\d+/);
  // Anchoring lives on the outer box; the beat system owns the inner frame's transform.
  assert.match(styles, /\.finale-sigil\s*\{[^}]*translate3d\(calc\(var\(--sigil-x/);
  assert.match(styles, /\.experience\[data-sigil="off"\] \.finale-sigil\s*\{[^}]*display:\s*none/);
  assert.match(app, /<div className="sigil-frame" data-beat/);
  assert.match(app, /\["cyan", "magenta", "core"\] as const/);
  assert.match(app, /sigil-stroke sigil-stroke--upper-left/);
  assert.match(app, /sigil-stroke sigil-stroke--lower-right/);
  assert.match(app, /sigil-stroke sigil-stroke--bar/);
  assert.match(styles, /sigil-letter-glitch 8\.4s steps/);
  assert.match(styles, /sigil-lock-pulse 8\.4s/);
  assert.match(styles, /data-sigil-active="true"/);
  assert.match(styles, /not\(\[data-sigil-active="true"\]\)[\s\S]{0,500}animation-name:\s*none/);
});

test("styles avoid per-frame layout and keep the reduced-motion path intact", async () => {
  const styles = await read("src/styles.css");

  assert.match(styles, /\.scroll-spacer\s*\{[^}]*1100svh/);
  assert.match(styles, /\.experience\s*\{[^}]*100dvh/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.experience\[data-motion-blur="true"\] \.video-stack/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.video-stack[^}]*display:\s*none\s*!important/);
  assert.match(styles, /\.experience\[data-film-fallback="true"\] \.static-poster/);

  // Scroll-driven properties must be compositor-only: no left/width animated per frame.
  const glow = styles.match(/\.festival-glow\s*\{[^}]*\}/)[0];
  assert.match(glow, /transform: translate3d\(calc\(var\(--light-x/);
  assert.doesNotMatch(glow, /left:\s*var\(--light-x/);
  const timelineFill = styles.match(/\.timeline b\s*\{[^}]*\}/)[0];
  assert.match(timelineFill, /transform: scaleX\(var\(--progress, 0\)\)/);
  assert.doesNotMatch(timelineFill, /width:\s*calc\(var\(--progress\)/);
  const sigilLockStart = styles.indexOf("@keyframes sigil-lock-pulse");
  const sigilLockEnd = styles.indexOf("\n\n.top-hud", sigilLockStart);
  const sigilLock = styles.slice(sigilLockStart, sigilLockEnd);
  assert.match(sigilLock, /translate3d/);
  assert.doesNotMatch(sigilLock, /\bleft\s*:/);

  // A backdrop blur over a film that repaints on every seek is the most expensive thing a phone in
  // this layout can be asked to do.
  const mobile = styles.slice(styles.indexOf("@media (max-width: 900px)"));
  assert.match(mobile, /backdrop-filter: none/);

  // Per-frame custom properties must not be written on the stage: an inherited custom property set
  // there invalidates style for the whole subtree on every frame.
  const engine = await read("src/useFilmScrubber.ts");
  assert.doesNotMatch(engine, /stage\.style\.setProperty\("--(progress|light-x|motion-blur|sigil)/);
  assert.match(engine, /timelineFill\?\.style\.setProperty\("--progress"/);
  assert.match(engine, /glow\?\.style\.setProperty\("--light-x"/);
});

test("shipped assets stay within the first-impression budget", async () => {
  const budgets = [
    ["reference/01_opening_logo.webp", 200_000],
    ["og.jpg", 400_000],
    ["reference/03_finale_poster_1280.jpg", 300_000],
  ];

  for (const [file, maxBytes] of budgets) {
    const url = new URL(`../dist/${file}`, import.meta.url);
    await access(url);
    const { size } = await stat(url);
    assert.ok(size <= maxBytes, `${file} is ${size} bytes, budget is ${maxBytes}`);
  }

  const files = (await readdir(new URL("../dist/", import.meta.url), { recursive: true }))
    .map((file) => file.replaceAll("\\", "/"));
  assert.ok(!files.includes("og.png"), "the uncompressed OG image must not ship");
  assert.ok(!files.includes("reference/01_opening_logo.png"), "the uncompressed poster must not ship");
});

test("the film pipeline is reproducible from a script, not from memory", async () => {
  const script = await read("scripts/build-media.sh");
  assert.match(script, /-crf 25/);
  assert.match(script, /-g 12/);
  assert.match(script, /-bf 0/);
  assert.match(script, /\+faststart/);
  assert.match(script, /xfade/);
  assert.match(script, /festival-master-\$\{width\}\.mp4/);
});
