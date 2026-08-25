import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root")!;

// The cached root only exists to survive dev-server hot reloads; production ships a bare root
// rather than a global handle on the whole React tree.
const rootScope = globalThis as typeof globalThis & { __APKMASON_ROOT__?: Root };
let root: Root;
if (import.meta.env.DEV) {
  root = rootScope.__APKMASON_ROOT__ ?? createRoot(container);
  rootScope.__APKMASON_ROOT__ = root;
} else {
  root = createRoot(container);
}

root.render(
  <React.StrictMode><App /></React.StrictMode>,
);
