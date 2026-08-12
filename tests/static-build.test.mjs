import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

test("build contains the complete festival experience", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
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

test("GitHub Pages output includes all optimized films", async () => {
  for (const size of ["desktop", "mobile"]) {
    for (const film of [
      "festival_01_logo_to_stage.mp4",
      "festival_02_crowd_flight.mp4",
      "festival_03_grand_finale.mp4",
    ]) {
      const url = new URL(`../dist/video/${size}/${film}`, import.meta.url);
      await access(url);
      assert.ok((await stat(url)).size > 1_000_000);
      const bytes = await readFile(url);
      const moov = bytes.indexOf(Buffer.from("moov"));
      const mdat = bytes.indexOf(Buffer.from("mdat"));
      assert.ok(moov > 0 && mdat > moov, `${size}/${film} is missing MP4 fast-start`);
      assert.equal(
        bytes.indexOf(Buffer.from("stss")),
        -1,
        `${size}/${film} is not All-I and will stutter during scroll scrubbing`,
      );
    }
  }
});

test("GitHub Pages output includes the loopable soundtrack", async () => {
  const soundtrack = new URL("../dist/audio/neon-skyfall.mp3", import.meta.url);
  await access(soundtrack);
  assert.ok((await stat(soundtrack)).size > 500_000);
});

test("GitHub Pages output includes the festival favicon", async () => {
  const favicon = new URL("../dist/favicon.svg", import.meta.url);
  await access(favicon);
  const svg = await readFile(favicon, "utf8");
  assert.match(svg, /linearGradient id="laser"/);
});

test("build excludes masters, duplicate media and obsolete starter files", async () => {
  const files = (await readdir(new URL("../dist/", import.meta.url), { recursive: true }))
    .map((file) => file.replaceAll("\\", "/"));

  for (const forbidden of [
    "masters/",
    "reference/02_transition_frame.png",
    "reference/03_finale_poster.png",
    "rendered-html.test.mjs",
  ]) {
    assert.ok(!files.some((file) => file === forbidden || file.startsWith(forbidden)), `Unexpected build file: ${forbidden}`);
  }
});

test("deployment configuration stays Pages-compatible", async () => {
  const [packageJson, viteConfig, workflow, html] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
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

test("scroll engine keeps its playback and lifecycle guarantees", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

  // Playback policy: films must never autoplay or go fullscreen, audio never starts on its own.
  assert.match(source, /muted\s+playsInline\s+preload=/);
  assert.match(source, /preload="none"\s+loop/);
  assert.doesNotMatch(source, /sessionStorage|localStorage|autoplay/);

  // Scroll listening must stay passive so the main thread is never blocked mid-gesture.
  assert.match(source, /window\.addEventListener\("scroll", updateTarget, \{ passive: true \}\)/);

  // Frame-accurate scrubbing: seeks are gated on presented frames, with a timeout escape hatch.
  assert.match(source, /requestVideoFrameCallback/);
  assert.match(source, /cancelVideoFrameCallback/);
  assert.match(source, /frameGateTimeouts/);

  // The render loop must be able to park when nothing is moving, and be woken again.
  assert.match(source, /const settled =/);
  assert.match(source, /frameId = 0;\s*\n\s*return;/);
  assert.match(source, /const wake = \(\) => \{/);

  // Detached films must hand their decoder and buffer back rather than waiting for GC.
  assert.match(source, /!video\.isConnected/);
  assert.match(source, /video\.removeAttribute\("src"\)/);

  // A dead film falls back to the static poster instead of a black screen.
  assert.match(source, /onError=\{handleFilmError\}/);
  assert.match(source, /data-film-fallback=\{filmFallback\}/);

  // Only film 1 competes for bandwidth up front.
  assert.match(source, /preload=\{reducedMotion \? "none" : index === 0 \? "auto" : "metadata"\}/);
  assert.match(source, /canplaythrough/);
});

test("soundtrack follows tab visibility without losing the user's intent", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
  // Hiding the tab pauses; it must not flip the toggle, or returning would come back silent.
  assert.match(source, /visibilityState === "hidden"[\s\S]{0,400}audio\.pause\(\)/);
  assert.match(source, /suspendedByTabRef/);
  // A manual mute has to survive a hide/show round trip.
  assert.match(source, /if \(!suspendedByTabRef\.current\) return;/);
  assert.match(source, /suspendedByTabRef\.current = false;\s*\n\s*if \(!soundOnRef\.current\) return;/);
});

test("the finale sigil is anchored to the film, not the viewport", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("../src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  // The mapping must come from the film's own cover geometry, including object-position.
  assert.match(source, /Math\.max\(boxWidth \/ video\.videoWidth, boxHeight \/ video\.videoHeight\)/);
  assert.match(source, /objectPosition/);
  assert.match(source, /--sigil-x/);
  assert.match(source, /stage\.dataset\.sigil = fits \? "on" : "off"/);
  assert.match(source, /stage\.dataset\.sigilActive = String\(nextSigilActive\)/);
  // Anchoring lives on the outer box; the beat system owns the inner frame's transform.
  assert.match(styles, /\.finale-sigil\s*\{[^}]*translate3d\(calc\(var\(--sigil-x/);
  assert.match(styles, /\.experience\[data-sigil="off"\] \.finale-sigil\s*\{[^}]*display:\s*none/);
  assert.match(source, /<div className="sigil-frame" data-beat/);
  assert.match(styles, /sigil-signal-tear 8\.4s steps/);
  assert.match(styles, /sigil-lock-pulse 8\.4s/);
  assert.match(styles, /data-sigil-active="true"/);
  assert.match(styles, /not\(\[data-sigil-active="true"\]\)[\s\S]{0,500}animation-name:\s*none/);
});

test("styles avoid per-frame layout and keep the reduced-motion path intact", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

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
  assert.match(timelineFill, /transform: scaleX\(var\(--progress\)\)/);
  assert.doesNotMatch(timelineFill, /width:\s*calc\(var\(--progress\)/);
  const sigilSweepStart = styles.indexOf("@keyframes sigil-sweep");
  const sigilSweepEnd = styles.indexOf("@keyframes sigil-signal-tear", sigilSweepStart);
  const sigilSweep = styles.slice(sigilSweepStart, sigilSweepEnd);
  assert.match(sigilSweep, /translate3d/);
  assert.doesNotMatch(sigilSweep, /\btop\s*:/);
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
