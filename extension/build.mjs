// Bundles the extension into extension/dist (load that folder as an unpacked extension).
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
await build({ entryPoints: [path.join(root, "src/background.js")], bundle: true, format: "esm", outfile: path.join(dist, "background.js"), target: "chrome116" });
await build({ entryPoints: [path.join(root, "src/content.js")], bundle: true, format: "iife", outfile: path.join(dist, "content.js"), target: "chrome116" });
await build({ entryPoints: [path.join(root, "src/popup.js")], bundle: true, format: "iife", outfile: path.join(dist, "popup.js"), target: "chrome116" });
for (const f of ["manifest.json"]) fs.copyFileSync(path.join(root, f), path.join(dist, f));
for (const f of ["popup.html", "popup.css"]) fs.copyFileSync(path.join(root, "src", f), path.join(dist, f));
console.log("Extension built to", dist);
