// Renders promo/teaser.html to an MP4 using the local Chrome (headless) — frame by frame, not in real time.
//   node scripts/render-teaser.mjs [output-file]
// Needs: npm install (for the "mediabunny" dev dependency that writes the MP4).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
//   --sheet <file.png>  also saves a contact sheet of 6 frames decoded back from the finished MP4 (to check it)
const args = process.argv.slice(2), si = args.indexOf("--sheet");
const sheetFile = si >= 0 ? args.splice(si, 2)[1] : null;
//   --times 1.9,4.8,…   which 6 moments (seconds) go on the contact sheet
const ti = args.indexOf("--times");
const sheetTimes = ti >= 0 ? args.splice(ti, 2)[1].split(",").map(Number) : [1.9, 4.8, 9.2, 14.0, 17.4, 20.0];
const outFile = args[0] || path.join(root, "promo", "qafiyeh-baz-teaser.mp4");
const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error("Chrome not found — set CHROME=path/to/chrome"); process.exit(1); }
if (!fs.existsSync(path.join(root, "node_modules", "mediabunny"))) { console.error("Run `npm install` first (needs mediabunny)."); process.exit(1); }

// a tiny static server for the project (ES modules don't load from file://)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const page = `http://127.0.0.1:${server.address().port}/promo/teaser.html`;

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "qb-teaser-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--autoplay-policy=no-user-gesture-required", "--window-size=540,960", "--hide-scrollbars", "--no-first-run", page
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === "page" && x.url.includes("teaser.html"));
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome didn't open the teaser page");
}

let ws, seq = 0;
const pending = new Map();
function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

try {
  ws = new WebSocket(await target());
  ws.onmessage = (m) => {
    const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
    const p = msg.id && pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("DevTools connection failed")); });
  for (let i = 0; i < 40 && !(await evaluate("document.readyState === 'complete' && !!window.renderTeaser")); i++) await sleep(250);

  console.log("Rendering the teaser frame by frame…");
  const t0 = Date.now();
  const r = await evaluate("window.renderTeaser()");
  fs.writeFileSync(outFile, Buffer.from(r.base64, "base64"));
  console.log(`Saved ${outFile}`);
  console.log(`  ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB · ${r.mime} · ${r.seconds.toFixed(1)} s · ${r.frames} frames at ${r.bpm.toFixed(2)} BPM · took ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  if (sheetFile) {
    // decode the finished file again and grab frames from each scene
    const b64 = await evaluate(`(async () => {
      const MB = await import("../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs");
      const bin = atob(${JSON.stringify(r.base64)}), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(new Blob([bytes])) });
      const track = await input.getPrimaryVideoTrack();
      const sink = new MB.CanvasSink(track, { width: 270, height: 480, fit: "fill" });
      const times = ${JSON.stringify(sheetTimes)}, sheet = document.createElement("canvas");
      sheet.width = 810; sheet.height = 960;
      const c = sheet.getContext("2d");
      for (let i = 0; i < times.length; i++) {
        const w = await sink.getCanvas(times[i]);
        if (w) c.drawImage(w.canvas, (i % 3) * 270, Math.floor(i / 3) * 480);
        c.fillStyle = "#fff"; c.font = "18px sans-serif"; c.fillText(times[i] + " s", (i % 3) * 270 + 8, Math.floor(i / 3) * 480 + 22);
      }
      return sheet.toDataURL("image/png").split(",")[1];
    })()`);
    fs.writeFileSync(sheetFile, Buffer.from(b64, "base64"));
    console.log(`Contact sheet: ${sheetFile}`);
  }
} catch (e) {
  console.error("Render failed:", e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 500);
}
