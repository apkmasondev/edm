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

test("source keeps Pages, media and audio behavior deployment-safe", async () => {
  const [source, styles, packageJson, viteConfig, workflow] = await Promise.all([
    readFile(new URL("../src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(packageJson).engines.node, ">=22.13.0");
  assert.match(viteConfig, /base:\s*["']\.\/["']/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version:\s*22\b/);
  assert.match(workflow, /path:\s*dist\b/);
  assert.match(source, /muted\s+playsInline\s+preload=/);
  assert.match(source, /preload="none"\s+loop/);
  assert.match(source, /fadeAudio\(audio, 0, 400/);
  assert.match(source, /fadeAudio\(audio, 0\.62, 800/);
  assert.doesNotMatch(source, /sessionStorage|localStorage|autoplay/);
  assert.match(source, /window\.addEventListener\("scroll", updateTarget, \{ passive: true \}\)/);
  assert.match(source, /targetProgress = scrollProgress\(\);\s*progressMemoryRef\.current = targetProgress/);
  assert.match(source, /function smoothDampProgress/);
  assert.match(source, /const smoothTime = 0\.11/);
  assert.match(source, /requestVideoFrameCallback/);
  assert.match(source, /cancelVideoFrameCallback/);
  assert.match(source, /frameGateTimeouts/);
  assert.match(source, /video\.currentTime = desired/);
  assert.match(source, /motionBlur.*0\.36/s);
  assert.match(source, /frameId = requestAnimationFrame\(tick\)/);
  assert.match(source, /preload=\{reducedMotion \? "none"/);
  assert.match(styles, /\.scroll-spacer\s*\{[^}]*1100svh/);
  assert.match(styles, /\.experience\s*\{[^}]*100dvh/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.experience\[data-motion-blur="true"\] \.video-stack/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.video-stack[^}]*display:\s*none\s*!important/);
});
