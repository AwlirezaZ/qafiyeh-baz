# قافیه‌باز (Qafiyeh-Baz)

A Persian freestyle-rap trainer. A beat plays, rhyme words scroll up on a 4-beat grid,
a bouncing ball marks every beat — you fill the first three beats and land the rhyme on beat four.

Plain HTML/CSS/JS. **No build step, no backend, no dependencies.**

## Run it

- Quickest: open `index.html` in a browser.
- With the dev server (needed only for the shared `beats/` library):

  ```bash
  node serve.js
  ```
  → http://localhost:5173

Everything is self-contained — fonts included — so it also works offline and from a zip.

## Put it online (free)

It's a static site: upload the folder, get a link. Upload the **contents** of `qafiyeh-baz/` so `index.html`
is at the root (`serve.js` and `.claude/` aren't needed online, but they're harmless).

**Cloudflare Pages (recommended)** — static bandwidth is unmetered on the free plan, no git needed:
1. Create a free Cloudflare account → *Workers & Pages* → *Create* → *Pages* → *Upload assets* (direct upload).
2. Name the project (e.g. `qafiyeh-baz`) → drag in the folder (or a zip of it) → *Deploy*.
3. You get `https://qafiyeh-baz.pages.dev`. To update, upload a new version to the same project.

**GitHub Pages** — free for public repos, 100 GB/month soft bandwidth limit, 1 GB site size:
push the folder to a public repo → *Settings* → *Pages* → deploy from the `main` branch, root folder.
You get `https://<username>.github.io/<repo>/`.

Notes: free tiers can change, so check the host's current limits page. Both hosts may be slow or
filtered for some players inside Iran — test the link with someone there before sharing widely.
Keep the shared `beats/` library modest; hosts' free terms don't allow using them mainly as a file/media CDN.

## Features

| | |
|---|---|
| Modes | **کلاسیک** (one beat, 8/16/32/64 bars, review screen) · **بی‌پایان** (beats rotate every 8/16/32 bars) · **تپ** (tap the tempo of any music playing around you) |
| Fill modes | all words · first only · last only · none |
| Rhyme schemes | AABB · ABAB · AAAA · no rhymes |
| Levels | مبتدی / متوسط / پیشرفته / حرفه‌ای (presets of fill + scheme) |
| Ball speed | half / normal / double |
| Word lists | همه · روزمره · ادبی · خیابونی, plus a **clean mode** filter |
| Beats | 13 original beats synthesized live (Web Audio) + CC-licensed MP3 library + upload your own MP3/WAV/M4A |
| **Beat library** | search, sort (suggested / most played / newest / fastest / slowest / name), genre, mood «حال‌وهوا», tempo range, favourites ♥, random 🎲, waveform, length, play count, "new" badge |
| **Per-beat settings** | built-in: tempo 85–115 %, layers (full / drums only / no drums) · MP3: skip intro (auto-detected), auto loudness levelling, "full track" length · global Auto Half-Time (>115 BPM → half-speed ball) |
| Endless playlist | rotates through the beats you filtered (e.g. only favourites) |
| Themes | پوستر خیابونی (default) · نوار کاست · شب کاشی |
| Review | bars, time, every rhyme used; replay with same or new words |
| Audio-lag calibration | Settings → for Bluetooth headphones |
| **Daily challenge** | چالش امروز: same beat + words for everyone each day (seeded by the date, no server), shareable result |
| **Streaks & stats** | 8+ bars a day keeps the streak; 28-day calendar, totals, favourite beats (stored on the device) |
| **Multi-syllable rhymes** | «چندهجایی» word list: only groups that rhyme on 2–3 syllables |
| **Record & share** | 9:16 MP4/WebM video of the grid (optionally over the selfie camera) with beat + mic; save or share. Never uploaded |
| **Installable / offline** | PWA: add to home screen; works offline after first visit (service worker) |
| **Link previews** | Open Graph image + tags for Telegram/WhatsApp/Instagram/X |

## Files

```
index.html        screens + markup
css/style.css     all styling; themes are token sets on [data-theme]
css/fonts.css     @font-face rules for the bundled fonts
fonts/            woff2 font files + license
js/words.js       the rhyme bank  ← edit this to add words
js/audio.js       instruments, the 6 beats, scheduler (Transport), tempo detection
js/game.js        rhyme-scheme generator, grid + ball renderer, game controller
js/recorder.js    record & share: canvas compositor + MediaRecorder
js/app.js         UI wiring, settings, uploads (IndexedDB), review, stats, daily challenge
sw.js             service worker (offline + install) — bump VERSION when you change cached files
manifest.webmanifest  app name, icons, colours for "install"
icons/            app icons, favicon, og.png (link preview)
beats/            optional shared beat library (see below)
serve.js          tiny static dev server
```

## Adding words

`js/words.js` → `QB.RHYME_SOURCE`. Each entry is a rhyme group: `["soundKey", "word word word"]`.

- Group by **pronunciation**, not spelling (Persian drops short vowels — `مَرد` and `مُرد` don't rhyme). Avoid ambiguous spellings.
- Tag words with a suffix: `:l` literary, `:s` street/slang, `:m` mature (hidden in clean mode). No tag = everyday.
- A group needs ≥2 words to be used, ≥4 for the AAAA scheme.

## The beats

All 18 are composed in code (`js/audio.js`, section *the beats*) — no samples, so no licensing issues.
The picker has a genre filter (همه / بوم‌بپ / ترپ و دریل / ایرانی / بقیه); Endless mode rotates only through the selected genre.

| Name | Genre | BPM | Notes |
|---|---|---|---|
| خاکی | Boom bap | 88 | swung drums, dusty piano, vinyl crackle |
| طلایی | 90s boom bap | 94 | horn stabs, hard dry drums, scratch fills |
| کوچه | Jazzy boom bap | 92 | walking bass, piano comps, busy kick |
| بمب | Hard boom bap | 98 | dark piano riff, whip snare, scratches |
| دودِ شب | Trap | 70 (≈140) | 808s, FM bell, hat rolls |
| سرد | Drill | 71 (≈142) | sliding 808s, triplet-feel hats |
| آتیش | Fast trap | 78 (≈156) | punchy 808 pattern, machine-gun hats, bell arp |
| خشم | Rage trap | 80 (≈160) | supersaw stabs, distorted 808 |
| شور | Persian trap | 74 | santur riff in Dastgah-e Shur with a real quarter-tone (E-koron) |
| زورخونه | Zarb | 84 | zarb dum/tak, zang bell, drone |
| شب‌های تهران | Lo-fi | 76 | jazzy EP chords with tape wobble |
| بانس | Old-school bounce | 95 | kick on the "and"s, octave-pop bass, offbeat piano stabs |
| بریک | Funky breakbeat | 100 | ghost-note snares, organ stabs, funky bass |
| نیوجک | New jack swing | 104 | heavy swing, gated snare + clap, synth stabs |
| بیت‌باکس | Beatbox | 92 | only mouth sounds: lip kick, "pf" snare, "ts" hats, hummed bass |
| باکس تند | Fast beatbox | 100 | busier lip kicks, 16th "ts" hats, inward snares |
| ساحل | G-funk | 96 | funky bass, whistle lead, claps |
| اولد اسکول | Electro / old school | 104 | 808 cowbell, staccato bass, scratches |

Trap BPMs are written as the rap (half-time) tempo; the number in brackets is the producer's double-time BPM.

A beat is an object `{ id, family, name, genre, vibe, bpm, swing, drums(kit, bar, step, time, stepDur), music(...) }`,
called once per 16th note. `family` is one of `oldschool | boombap | beatbox | trap | persian | other`. Copy one to make a new one.
Instruments available on `kit`: kick, snare, clap, hat, rim, crash, sub (808 w/ glide), bass, piano, ep, pad,
bell, santur, zang, dum, tak, brass, scratch, cowbell, lead, saw, organ, vinyl, and a beatbox kit: bbKick, bbSnare, bbInward, bbHat, bbClick, bbBass.

**Linking a beat from another website** (no download): use `"src"` with the full file URL instead of `"file"`:
```json
{"src":"https://cdn.freesound.org/previews/203/203532_1126957-hq.mp3","name":"Matt's Beatbox Loop","artist":"Mattc90","family":"beatbox","genre":"بیت‌باکس واقعی","bpm":100,"loop":true,"license":"CC0","url":"https://freesound.org/people/Mattc90/sounds/203532/"}
```
- Only works if that site allows other sites to load its audio (CORS). Freesound previews (`cdn.freesound.org`) and
  Wikimedia (`upload.wikimedia.org`) do; incompetech.com does not. Check with:
  `curl -sI -H "Origin: https://awlirezaz.github.io" <url> | grep -i access-control-allow-origin`
- Linked beats need internet (also in the Android app); the website caches them after the first play.
- `"loop": true` for short loops: the game repeats the file in whole bars, so a 10-second loop can last a whole round.
  Give `"bpm"` for loops (the tempo is fine-tuned so the bars fit the file exactly).
- Add new hosts to `LINKED_BEAT_HOSTS` in `sw.js` if you want them cached for offline use.

Shared-library MP3s can join a genre filter by adding `"family": "boombap"` (etc.) to their manifest entry.

## User uploads vs. an admin library

- **Uploads** (the "بیت خودت" card): the file is decoded in the browser, BPM + first downbeat are
  auto-detected (user can nudge them), and it's saved in the browser's IndexedDB. Nothing leaves the device.
  Each player only sees their own uploads.
- **Shared library for everyone (admin):** no backend needed. Put audio files in `beats/` and list them
  in `beats/manifest.json`; they appear for all players (works when served over http, not `file://`):

  ```json
  [
    { "file": "night-drive.mp3", "name": "رانندگی شبانه", "genre": "بوم‌بپ", "vibe": "خاکی و آروم", "bpm": 90, "offset": 0.42 }
  ]
  ```
  `offset` = seconds until the first downbeat. Both are optional: leave them out and the game measures them
  the first time the beat loads (cached per browser). Entries whose file is missing are skipped, and
  `artist` + `license` are shown on the beat card. Credit every CC BY track in `CREDITS.md`.

  Only beats you have the rights to distribute.

- If you later want admins to upload **through a web page** (no file copying), that is the point where a small
  backend + storage is needed (e.g. Supabase / Firebase storage + a table for the manifest).

## Notes

- Fonts (Vazirmatn, Lalezar, Reem Kufi — SIL Open Font License) are bundled in `fonts/` and declared in
  `css/fonts.css`; arabic + latin subsets only, ~180 KB total. No requests go to Google or any other server.
- Timing is driven by the Web Audio clock (not timers), so the ball stays locked to the beat.

## Android app (Cafe Bazaar)

The Android app is the **same code** wrapped with [Capacitor](https://capacitorjs.com): `npm run build:web` copies the
game into `www/`, and `android/` is the native project that packs it. Everything is bundled inside the APK, so the app works
fully offline and doesn't depend on the website being reachable. App id: `com.awlirezaz.qafiyehbaz` (`capacitor.config.json`)
— **this can't change after the first Bazaar upload**.

App-only behaviour lives in `js/native.js`: Android back button, saving videos to `Documents/Qafiyeh-Baz`, the share sheet
for videos and the daily challenge. On the website that file does nothing.

### Get an APK (no Android SDK needed on your PC)
GitHub Actions builds it on every push to `main` (`.github/workflows/android.yml`):
GitHub → **Actions** → **Android app** → latest run → **Artifacts** → `qafiyeh-baz-debug-apk`.
Copy it to your phone and open it (allow "install unknown apps"). Each CI run signs debug builds with a different
throwaway key, so **uninstall the old debug build before installing a newer one**.

### Release signing (needed for Bazaar)
1. Create your key once (asks for a password; the files are written *next to* the project folder, never inside it):
   ```bash
   npm run make-key
   ```
2. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**, add:
   `ANDROID_KEYSTORE_BASE64` (content of `qafiyeh-baz-release.base64.txt`), `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS` (default `qafiyehbaz`), `ANDROID_KEY_PASSWORD` (same password).
3. Actions → **Android app** → **Run workflow**. The run now also uploads `qafiyeh-baz-release` with a signed
   **APK** and **AAB**.
4. **Back up `qafiyeh-baz-release.p12` and the password.** Every future update must be signed with the same key.

`versionCode` = the GitHub run number, so each build is automatically newer than the last (Bazaar requires that).

### Publishing on Cafe Bazaar
1. Developer account: pishkhan.cafebazaar.ir (identity verification as a developer).
2. New app → upload the **release APK** (or AAB if the panel offers it).
3. Listing: name «قافیه‌باز», short + full Persian description, screenshots from your phone, icon `icons/icon-512.png`,
   category (music / entertainment), age rating.
4. Privacy policy URL: `https://awlirezaz.github.io/qafiyeh-baz/privacy.html`
   (microphone + camera are only used for the optional video recording; nothing is uploaded).
5. Updates: push to `main` → download the new release artifact → upload it in the Bazaar panel.

### Working on the Android project locally (optional)
Install Android Studio, then `npm install`, `npm run android:sync` and open the `android/` folder in Android Studio.
