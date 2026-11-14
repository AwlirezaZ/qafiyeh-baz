/*
 * Service worker: makes قافیه‌باز work offline and installable.
 * - App files (html/css/js/manifest): network first, cache as fallback → online users always get the latest deploy.
 * - Fonts, icons, beat MP3s: cache first → fast, and offline after the first play.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const SHELL = `qb-shell-${VERSION}`;
const MEDIA = `qb-media-${VERSION}`;

const PRECACHE = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css", "css/fonts.css",
  "js/words.js", "js/audio.js", "js/game.js", "js/recorder.js", "js/app.js",
  "fonts/vazirmatn-arabic-4.woff2", "fonts/vazirmatn-latin-5.woff2",
  "fonts/lalezar-arabic-0.woff2", "fonts/lalezar-latin-1.woff2",
  "fonts/reem-kufi-arabic-2.woff2", "fonts/reem-kufi-latin-3.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isMedia = /\.(woff2|png|mp3|wav|m4a|ogg)$/i.test(url.pathname);
  if (isMedia && !req.headers.has("range")) {
    e.respondWith(
      caches.open(MEDIA).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.status === 200) c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // app shell + manifest.json: network first, fall back to cache when offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
