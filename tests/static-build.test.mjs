import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

test("build contains the complete festival experience", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /APKMASON EDM Music Festival/);
  assert.match(html, /Interactive Design Fiction/);
  assert.match(html, /\.\/assets\/index-/);
  assert.doesNotMatch(html, /codex-preview|Starter Project/);
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
