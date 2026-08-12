import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The experience loads nothing from outside its own origin, so it can ship a tight policy.
// 'unsafe-inline' stays on style-src because the scroll engine writes inline style attributes.
// Injected at build time only: the dev server needs its own inline scripts and HMR socket.
//
// script-src also has to tolerate inline code: Cloudflare injects its bot-detection snippet at the
// edge, and that snippet carries per-request parameters, so its hash changes on every response and
// cannot be allowlisted. 'self' still blocks third-party script origins, and connect-src 'self'
// still prevents exfiltration, which is the protection that actually matters for a static page.
// Turning off Cloudflare JS Detections would let script-src go back to a bare 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const contentSecurityPolicy = (): Plugin => ({
  name: "apkmason-csp",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html) => html.replace(
      "<head>",
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
});
