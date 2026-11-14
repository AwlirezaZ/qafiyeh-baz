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
| Beats | 6 original beats synthesized live (Web Audio) + upload your own MP3/WAV/M4A |
| Themes | پوستر خیابونی (default) · نوار کاست · شب کاشی |
| Review | bars, time, every rhyme used; replay with same or new words |
| Audio-lag calibration | Settings → for Bluetooth headphones |

## Files

```
index.html        screens + markup
css/style.css     all styling; themes are token sets on [data-theme]
css/fonts.css     @font-face rules for the bundled fonts
fonts/            woff2 font files + license
js/words.js       the rhyme bank  ← edit this to add words
js/audio.js       instruments, the 6 beats, scheduler (Transport), tempo detection
js/game.js        rhyme-scheme generator, grid + ball renderer, game controller
js/app.js         UI wiring, settings, uploads (IndexedDB), review
beats/            optional shared beat library (see below)
serve.js          tiny static dev server
```

## Adding words

`js/words.js` → `QB.RHYME_SOURCE`. Each entry is a rhyme group: `["soundKey", "word word word"]`.

- Group by **pronunciation**, not spelling (Persian drops short vowels — `مَرد` and `مُرد` don't rhyme). Avoid ambiguous spellings.
- Tag words with a suffix: `:l` literary, `:s` street/slang, `:m` mature (hidden in clean mode). No tag = everyday.
- A group needs ≥2 words to be used, ≥4 for the AAAA scheme.

## The beats

All 13 are composed in code (`js/audio.js`, section *the beats*) — no samples, so no licensing issues.
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
| ساحل | G-funk | 96 | funky bass, whistle lead, claps |
| اولد اسکول | Electro / old school | 104 | 808 cowbell, staccato bass, scratches |

Trap BPMs are written as the rap (half-time) tempo; the number in brackets is the producer's double-time BPM.

A beat is an object `{ id, family, name, genre, vibe, bpm, swing, drums(kit, bar, step, time, stepDur), music(...) }`,
called once per 16th note. `family` is one of `boombap | trap | persian | other`. Copy one to make a new one.
Instruments available on `kit`: kick, snare, clap, hat, rim, crash, sub (808 w/ glide), bass, piano, ep, pad,
bell, santur, zang, dum, tak, brass, scratch, cowbell, lead, saw, vinyl.

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
