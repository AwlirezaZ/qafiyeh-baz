// Tiny static server for local development: `node serve.js` → http://localhost:5173
// No dependencies. Needed only for the optional beats/manifest.json library;
// the game itself also runs by opening index.html directly.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = +process.env.PORT || 5173;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".webmanifest": "application/manifest+json"
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("not found"); }
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    if (range && type.startsWith("audio/")) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = +s, end = e ? +e : st.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => console.log(`قافیه‌باز → http://localhost:${port}`));
