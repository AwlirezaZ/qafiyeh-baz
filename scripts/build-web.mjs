// Copies the web app into www/ — the folder Capacitor packs into the Android app.
// Only the files the game needs at runtime go in (no android/, node_modules, docs, dev server).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "www");
const INCLUDE = ["index.html", "privacy.html", "manifest.webmanifest", "css", "js", "fonts", "icons", "img", "beats"];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0, bytes = 0;
function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else {
    fs.copyFileSync(src, dst); files++; bytes += st.size;
  }
}
for (const item of INCLUDE) {
  const src = path.join(root, item);
  if (fs.existsSync(src)) copy(src, path.join(out, item));
}
// the service worker is for the website only; the app is already offline

// (js/native.js talks to the native plugins through Capacitor's built-in bridge — no JS bundles to copy)

// The app ships only the beats that are actually in beats/ — drop manifest entries without a file
const mf = path.join(out, "beats", "manifest.json");
if (fs.existsSync(mf)) {
  const list = JSON.parse(fs.readFileSync(mf, "utf8"));
  const kept = list.filter((e) => e && ((e.src && /^https?:\/\//.test(e.src)) ||          // linked from another site
                                        (e.file && fs.existsSync(path.join(out, "beats", e.file)))));
  fs.writeFileSync(mf, JSON.stringify(kept, null, 1));
  console.log(`beats: ${kept.length} of ${list.length} manifest entries kept (local file present, or linked by URL)`);
}
console.log(`www/ ready: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
