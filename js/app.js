/*
 * App shell: screens, setup, settings, themes, uploads, review.
 */
(function () {
  var QB = window.QB, fa = QB.fa;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- persisted state ---------- */
  var DEFAULTS = {
    mode: "classic", level: "beginner", fill: "all", scheme: "aabb", speed: 1,
    list: "all", clean: false, beat: "golden", beatFilter: "all", bars: 16, switchEvery: 16,
    tapBpm: 90, click: false, theme: "poster", lag: 0, rec: false, cam: true,
    beatMood: "all", beatTempo: "all", beatSort: "suggested", onlyFavs: false, favs: [], beatOpts: {}, autoHalf: true
  };
  var S = {};
  try { S = JSON.parse(localStorage.getItem("qb.settings") || "{}") || {}; } catch (e) { S = {}; }
  Object.keys(DEFAULTS).forEach(function (k) { if (S[k] == null) S[k] = DEFAULTS[k]; });
  function save() { try { localStorage.setItem("qb.settings", JSON.stringify(S)); } catch (e) {} }

  var THEMES = [
    { id: "poster",   name: "پوستر خیابونی", sw: ["#0f0f0e", "#ff5b1f", "#efe9dc"], meta: "#0f0f0e" },
    { id: "cassette", name: "نوار کاست",     sw: ["#1b1511", "#e8a33d", "#d9553b"], meta: "#1b1511" },
    { id: "neon",     name: "شب کاشی",       sw: ["#080b1a", "#3ef2e0", "#ff4fb8"], meta: "#080b1a" }
  ];
  function applyTheme(id) {
    S.theme = id; save();
    document.documentElement.setAttribute("data-theme", id);
    var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
    $('meta[name="theme-color"]').setAttribute("content", t.meta);
    $$(".theme-dot").forEach(function (b) { b.setAttribute("aria-checked", b.dataset.theme === id); });
    $$(".theme-card input").forEach(function (i) { i.checked = i.value === id; });
    if (game) game.grid.measure();
  }

  /* ---------- screens ---------- */
  var current = "home";
  function show(name) {
    current = name;
    if (name === "home") renderHome();
    if (name === "stats") renderStats();
    $$(".screen").forEach(function (s) { s.classList.toggle("is-active", s.dataset.screen === name); });
    window.scrollTo(0, 0);
    if (name !== "setup") stopPreview();
  }

  /* ---------- streaks & stats (this device only) ---------- */
  var Stats = (function () {
    var KEY = "qb.stats", DAY_MIN = 8;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
    function load() {
      var s = null;
      try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
      s = s || {};
      ["days", "beats", "daily"].forEach(function (k) { s[k] = s[k] || {}; });
      ["totalBars", "games", "secs", "best"].forEach(function (k) { s[k] = s[k] || 0; });
      return s;
    }
    function store(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
    function counts(s, d) { return (s.days[dayKey(d)] || 0) >= DAY_MIN; }
    function streak(s) {
      var d = new Date(), n = 0;
      if (!counts(s, d)) d = addDays(d, -1);           // today not done yet → streak still alive from yesterday
      while (counts(s, d)) { n++; d = addDays(d, -1); }
      return n;
    }
    function longest(s) {
      var keys = Object.keys(s.days).filter(function (k) { return s.days[k] >= DAY_MIN; }).sort();
      var best = 0, run = 0, prev = null;
      keys.forEach(function (k) {
        var d = new Date(k + "T12:00:00");
        run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
        prev = d; best = Math.max(best, run);
      });
      return best;
    }
    function record(res, beatName, dailyKey) {
      var s = load(), before = streak(s);
      if (res.bars > 0) {
        var k = dayKey();
        s.days[k] = (s.days[k] || 0) + res.bars;
        s.totalBars += res.bars; s.games++; s.secs += res.secs; s.best = Math.max(s.best, res.bars);
        if (beatName) s.beats[beatName] = (s.beats[beatName] || 0) + 1;
      }
      if (dailyKey) s.daily[dailyKey] = true;
      store(s);
      return { before: before, after: streak(s), today: s.days[dayKey()] || 0 };
    }
    return { load: load, dayKey: dayKey, addDays: addDays, streak: streak, longest: longest, record: record, DAY_MIN: DAY_MIN };
  })();

  function jalali(d, opts) {
    try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", opts || { day: "numeric", month: "long" }).format(d); }
    catch (e) { return d.toLocaleDateString("fa-IR"); }
  }

  /* ---------- daily challenge: same beat + words for everyone today ---------- */
  function dailyInfo() {
    var d = new Date(), key = Stats.dayKey(d), seed = +key.replace(/-/g, "");
    var rng = QB.seededRandom(seed * 7 + 13);
    var pool = QB.BEATS.filter(function (b) { return b.family === "boombap" || b.family === "trap"; });
    var pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    var beat = pick(pool);
    var scheme = pick(["aabb", "abab", "aabb", "aaaa"]);
    var fill = pick(["all", "first", "first", "last"]);
    var list = rng() < 0.35 ? "multi" : "all";
    return { key: key, seed: seed, beat: beat, scheme: scheme, fill: fill, list: list, bars: 16, date: jalali(d) };
  }
  function renderHome() {
    var s = Stats.load(), n = Stats.streak(s);
    $("#streakNum").textContent = fa(n);
    $(".streak-chip").classList.toggle("is-hot", (s.days[Stats.dayKey()] || 0) >= Stats.DAY_MIN);
    var info = dailyInfo(), done = !!s.daily[info.key];
    $("#dailyDate").textContent = info.date;
    $("#dailyMeta").textContent = [info.beat.name + " (" + info.beat.genre + ")", QB.SCHEMES[info.scheme].label,
      QB.FILLS[info.fill].label, info.list === "multi" ? "چندهجایی" : null, fa(info.bars) + " بار"].filter(Boolean).join(" · ");
    $("#dailyCard").classList.toggle("is-done", done);
    $("#dailyBtnText").textContent = done ? "دوباره" : "قبول";
    $(".daily-tag span").textContent = done ? "چالش امروز ✓" : "چالش امروز";
  }
  function startDaily() {
    var info = dailyInfo();
    var cfg = { mode: "classic", scheme: info.scheme, fill: info.fill, list: info.list, clean: true, speed: 1,
                bars: info.bars, switchEvery: 16, lagMs: S.lag, daily: info.key, seed: info.seed,
                source: { kind: "synth", beats: [info.beat] } };
    startGame(null, cfg);
  }

  function renderStats() {
    var s = Stats.load(), today = new Date(), todayBars = s.days[Stats.dayKey(today)] || 0;
    $("#stStreak").textContent = fa(Stats.streak(s));
    $("#stStreakHint").textContent = todayBars >= Stats.DAY_MIN ? "امروز حساب شد ✓"
      : "امروز " + fa(Stats.DAY_MIN - todayBars) + " بار دیگه بخونی، حساب می‌شه";
    var cal = $("#cal"); cal.innerHTML = "";
    for (var i = 27; i >= 0; i--) {
      var d = Stats.addDays(today, -i), bars = s.days[Stats.dayKey(d)] || 0;
      var lv = bars === 0 ? 0 : bars < Stats.DAY_MIN ? 1 : bars < 32 ? 2 : 3;
      var cell = document.createElement("i");
      cell.className = "l" + lv + (i === 0 ? " today" : "");
      cell.title = jalali(d, { weekday: "long", day: "numeric", month: "long" }) + " — " + fa(bars) + " بار";
      cell.setAttribute("aria-label", cell.title);
      cal.appendChild(cell);
    }
    $("#stLongest").textContent = fa(Stats.longest(s));
    $("#stBars").textContent = fa(s.totalBars);
    $("#stGames").textContent = fa(s.games);
    $("#stTime").textContent = fa(Math.round(s.secs / 60));
    $("#stDaily").textContent = fa(Object.keys(s.daily).length);
    $("#stBest").textContent = fa(s.best);
    var top = Object.keys(s.beats).sort(function (a, b) { return s.beats[b] - s.beats[a]; }).slice(0, 3);
    $("#topBeats").innerHTML = top.length ? top.map(function (n) {
      return "<li><b>" + esc(n) + "</b><span>" + fa(s.beats[n]) + " بار بازی</span></li>";
    }).join("") : '<li class="empty">هنوز بازی نکردی</li>';
  }

  var toastTimer;
  function toast(msg, ms) {
    var el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }
  function globalToast(msg, ms) {
    var el = $(".global-toast");
    if (!el) { el = document.createElement("div"); el.className = "toast global-toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2600);
  }

  /* ---------- storage for uploaded beats ---------- */
  var DB = (function () {
    var p = null;
    function open() {
      if (p) return p;
      p = new Promise(function (res, rej) {
        try {
          var r = indexedDB.open("qafiyeh-baz", 1);
          r.onupgradeneeded = function () { r.result.createObjectStore("beats", { keyPath: "id" }); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        } catch (e) { rej(e); }
      });
      return p;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction("beats", mode), req = fn(t.objectStore("beats"));
          t.oncomplete = function () { res(req && req.result); };
          t.onerror = function () { rej(t.error); };
        });
      });
    }
    return {
      all: function () { return tx("readonly", function (s) { return s.getAll(); }); },
      put: function (r) { return tx("readwrite", function (s) { return s.put(r); }); },
      del: function (id) { return tx("readwrite", function (s) { return s.delete(id); }); }
    };
  })();

  /* beat descriptors shown in the picker */
  var library = QB.BEATS.map(function (b) {
    return { id: b.id, kind: "synth", family: b.family, name: b.name, genre: b.genre, vibe: b.vibe, bpm: b.bpm,
             moods: b.moods, added: b.added };
  });
  var mine = [];          // user uploads (IndexedDB)
  var decoded = {};       // id -> AudioBuffer cache
  var waves = {};         // id -> [peaks]

  function findBeat(id) {
    return library.concat(mine).filter(function (b) { return b.id === id; })[0] || null;
  }
  function beatOpts(id) { return (S.beatOpts && S.beatOpts[id]) || {}; }
  function setBeatOpt(id, k, v) {
    S.beatOpts = S.beatOpts || {};
    var o = S.beatOpts[id] = Object.assign({}, S.beatOpts[id]);
    if (v == null) delete o[k]; else o[k] = v;
    if (!Object.keys(o).length) delete S.beatOpts[id];
    save();
  }
  /* bpm the player will actually hear (tempo setting applies to built-in beats) */
  function effBpm(b) { return b.bpm ? b.bpm * (b.kind === "synth" ? (beatOpts(b.id).tempo || 1) : 1) : null; }
  function synthFor(id) { return QB.beatVariant(QB.beatById(id), beatOpts(id)); }
  function isNew(b) { return b.added && (Date.now() - new Date(b.added + "T00:00:00")) < 30 * 864e5; }
  function isFav(id) { return (S.favs || []).indexOf(id) >= 0; }
  function introBars(b) { var o = beatOpts(b.id); return o.skip != null ? o.skip : (b.intro || 0); }
  /* everything needed to play an MP3 beat with its settings */
  function bufferSource(b, buf) {
    var bar = 240 / b.bpm;
    return { kind: "buffer", buffer: buf, bpm: b.bpm, offset: (b.offset || 0) + introBars(b) * bar, name: b.name, gain: b.level || 1 };
  }
  function fmtTime(s) { s = Math.round(s); return fa(Math.floor(s / 60)) + ":" + QB.pad2(s % 60); }

  function loadBuffer(desc) {
    if (decoded[desc.id]) return Promise.resolve(decoded[desc.id]);
    var ctx = QB.audio.ensure();
    var get = desc.kind === "mine" ? Promise.resolve(desc.data.slice(0))
      : fetch(desc.src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    return get.then(function (ab) {
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); });
    }).then(function (buf) {
      decoded[desc.id] = buf;
      ensureMeta(desc, buf);
      return buf;
    });
  }

  /* MP3 beats: measure tempo (if not given), intro length, loudness, duration and waveform once, then cache */
  function metaKey(desc) { return "qb.meta." + (desc.src || desc.id); }
  function readMeta(desc) { try { return JSON.parse(localStorage.getItem(metaKey(desc)) || "null"); } catch (e) { return null; } }
  function applyMeta(desc, m) {
    if (!m) return;
    if (!desc.bpm && m.bpm) { desc.bpm = m.bpm; desc.offset = m.offset; }
    if (m.intro != null) desc.intro = m.intro;
    if (m.level) desc.level = m.level;
    if (m.dur) desc.dur = m.dur;
    if (m.wave) waves[desc.id] = m.wave;
  }
  function ensureMeta(desc, buf) {
    var m = readMeta(desc) || {};
    if (!desc.bpm && !m.bpm) { var r = QB.detectTempo(buf); m.bpm = r.bpm; m.offset = r.offset; }
    var bpm = desc.bpm || m.bpm, off = desc.bpm ? desc.offset : m.offset;
    if (m.intro == null) m.intro = QB.detectIntro(buf, bpm, off);
    if (!m.level) m.level = Math.round(QB.bufferLevel(buf) * 100) / 100;
    if (!m.dur) m.dur = Math.round(buf.duration);
    if (!m.wave) m.wave = QB.peaks(buf, 40);
    try { localStorage.setItem(metaKey(desc), JSON.stringify(m)); } catch (e) {}
    applyMeta(desc, m);
    if (current === "setup") { renderBeats(); updateSummary(); }
  }

  /* optional shared library: beats/manifest.json (works when served over http).
     Entries whose audio file isn't there are skipped; bpm/offset may be omitted (auto-detected). */
  function loadManifest() {
    if (location.protocol === "file:") return;
    fetch("beats/manifest.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        return Promise.all(list.map(function (e) {
          if (!e || !e.file) return null;
          var src = "beats/" + encodeURI(e.file);
          if (QB.native.is) return { e: e, src: src };   // the app's build already dropped entries without files
          return fetch(src, { method: "HEAD" }).then(function (r) { return r.ok ? { e: e, src: src } : null; }).catch(function () { return null; });
        })).then(function (found) {
          found.forEach(function (f) {
            if (!f) return;
            var e = f.e;
            var credit = [e.artist, e.license].filter(Boolean).join(" · ");
            var desc = { id: "lib-" + e.file, kind: "file", src: f.src, name: e.name || e.file, family: e.family || null,
                         genre: e.genre || "بیت", vibe: e.vibe ? e.vibe + (credit ? " · " + credit : "") : credit,
                         artist: e.artist || "", moods: e.moods || [], added: e.added || null,
                         bpm: +e.bpm || null, offset: +e.offset || 0 };
            applyMeta(desc, readMeta(desc));
            library.push(desc);
          });
        });
      }).catch(function () {}).then(function () {
        libReady.manifest = true;
        renderBeats(); renderLengths(); updateSummary();
      });
  }

  /* ---------- setup screen ---------- */
  function chip(label, sub, active, attrs) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (active ? " is-on" : "");
    b.setAttribute("aria-pressed", !!active);
    b.innerHTML = "<span>" + label + "</span>" + (sub ? "<small>" + sub + "</small>" : "");
    Object.keys(attrs || {}).forEach(function (k) { b.dataset[k] = attrs[k]; });
    return b;
  }

  function matchLevel() {
    var lv = null;
    Object.keys(QB.LEVELS).forEach(function (k) {
      var L = QB.LEVELS[k]; if (L.fill === S.fill && L.scheme === S.scheme) lv = k;
    });
    return lv;
  }

  function schemeBars(pattern) {
    if (!pattern) return '<span class="sb free"></span><span class="sb free"></span><span class="sb free"></span><span class="sb free"></span>';
    return pattern.split("").map(function (L) { return '<span class="sb ' + (L === "A" ? "c0" : "c1") + '"></span>'; }).join("");
  }

  function renderLevels() {
    var box = $("#levelChips"); box.innerHTML = "";
    var cur = matchLevel();
    Object.keys(QB.LEVELS).forEach(function (k) {
      var L = QB.LEVELS[k];
      var c = chip(L.label, QB.FILLS[L.fill].label + " · " + QB.SCHEMES[L.scheme].label, cur === k, { level: k });
      c.classList.add("level-chip");
      c.insertAdjacentHTML("beforeend", '<span class="scheme-viz">' + schemeBars(QB.SCHEMES[L.scheme].pattern) + "</span>");
      box.appendChild(c);
    });
  }
  function renderSeg(id, items, val, key) {
    var box = $(id); box.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (String(it.v) === String(val) ? " is-on" : "");
      b.setAttribute("aria-pressed", String(it.v) === String(val));
      b.dataset[key] = it.v;
      b.innerHTML = it.html || it.label;
      if (it.hint) b.title = it.hint;
      box.appendChild(b);
    });
  }
  function renderAdvanced() {
    renderSeg("#fillSeg", Object.keys(QB.FILLS).map(function (k) { return { v: k, label: QB.FILLS[k].label, hint: QB.FILLS[k].hint }; }), S.fill, "fill");
    renderSeg("#schemeSeg", Object.keys(QB.SCHEMES).map(function (k) {
      var s = QB.SCHEMES[k];
      return { v: k, hint: s.hint, html: '<span class="scheme-viz">' + schemeBars(s.pattern) + "</span>" + s.label };
    }), S.scheme, "scheme");
    renderSeg("#speedSeg", [{ v: 0.5, label: "نصف" }, { v: 1, label: "عادی" }, { v: 2, label: "دو برابر" }], S.speed, "speed");
  }
  function renderLists() {
    var box = $("#listChips"); box.innerHTML = "";
    Object.keys(QB.WORD_LISTS).forEach(function (k) {
      var L = QB.WORD_LISTS[k];
      box.appendChild(chip(L.label, L.hint, S.list === k, { list: k }));
    });
    $("#cleanToggle").checked = S.clean;
    $("#cleanToggle2").checked = S.clean;
  }
  function renderLengths() {
    var box = $("#lengthChips"); box.innerHTML = "";
    if (S.mode === "classic") {
      $("#lengthTitle").textContent = "چند بار؟";
      var sel = findBeat(S.beat), isTrack = sel && sel.kind !== "synth";
      if (S.bars === "full" && sel && !isTrack) S.bars = 16;   // (sel unknown = library still loading → keep)
      [8, 16, 32, 64].forEach(function (n) {
        var b = chip(fa(n), n === 8 ? "زیر یه دقیقه" : n === 64 ? "خیلی طولانی" : "بار", S.bars === n, { bars: n });
        box.appendChild(b);
      });
      if (isTrack) box.appendChild(chip("کل ترک", sel.dur ? fmtTime(sel.dur) : "تا آخر آهنگ", S.bars === "full", { bars: "full" }));
    } else {
      $("#lengthTitle").textContent = "هر چند بار بیت عوض شه؟";
      [8, 16, 32].forEach(function (n) { box.appendChild(chip(fa(n), "بار", S.switchEvery === n, { every: n })); });
    }
  }

  var MOOD_LABEL = {}; QB.MOODS.forEach(function (m) { MOOD_LABEL[m[0]] = m[1]; });
  var TEMPOS = [["all", "هر سرعتی"], ["slow", "زیر ۸۰"], ["mid", "۸۰ تا ۹۵"], ["fast", "بالای ۹۵"]];
  var SORTS = [["suggested", "پیشنهادی"], ["played", "بیشترین بازی"], ["new", "جدیدترین"], ["fast", "تندترین"], ["slow", "آروم‌ترین"], ["name", "اسم"]];
  var beatQuery = "";

  function waveSVG(peaks) {
    if (!peaks) return '<svg class="beat-wave is-empty" viewBox="0 0 160 20" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="9.5" width="160" height="1"/></svg>';
    var w = 160 / peaks.length;
    return '<svg class="beat-wave" viewBox="0 0 160 20" preserveAspectRatio="none" aria-hidden="true">' + peaks.map(function (p, i) {
      var h = Math.max(1.5, p * 20); return '<rect x="' + (i * w + 0.6).toFixed(1) + '" y="' + ((20 - h) / 2).toFixed(1) + '" width="' + (w - 1.2).toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
    }).join("") + "</svg>";
  }

  function beatCard(b, plays) {
    var el = document.createElement("div"), on = S.beat === b.id, bpm = effBpm(b), fav = isFav(b.id);
    el.className = "beat-card" + (on ? " is-on" : "");
    el.dataset.beat = b.id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", on);
    var moods = (b.moods || []).map(function (m) { return '<span class="mood">' + MOOD_LABEL[m] + "</span>"; }).join("");
    var tempoTag = b.kind === "synth" && (beatOpts(b.id).tempo || 1) !== 1 ? '<span class="tag">' + fa(Math.round((beatOpts(b.id).tempo) * 100)) + "٪</span>" : "";
    el.innerHTML =
      '<button type="button" class="beat-play" data-preview="' + b.id + '" aria-label="پیش‌نمایش ' + esc(b.name) + '"><svg><use href="#i-play"/></svg></button>' +
      '<div class="beat-info">' +
        '<span class="beat-genre">' + esc(b.genre) + moods + "</span>" +
        '<b class="beat-name">' + esc(b.name) + (isNew(b) ? '<span class="badge-new">جدید</span>' : "") + tempoTag + "</b>" +
        (b.vibe ? '<span class="beat-vibe">' + esc(b.vibe) + "</span>" : "") +
        '<span class="beat-wave-wrap" data-wave="' + b.id + '">' + waveSVG(waves[b.id]) + "</span>" +
      "</div>" +
      '<span class="beat-bpm"><b>' + (bpm ? fa(Math.round(bpm)) : "؟") + "</b><small>BPM</small>" +
        (b.dur ? '<small class="beat-len">' + fmtTime(b.dur) + "</small>" : "") +
        (plays ? '<small class="beat-plays">' + fa(plays) + "× بازی</small>" : "") + "</span>" +
      '<span class="beat-side">' +
        '<button type="button" class="beat-fav' + (fav ? " is-on" : "") + '" data-fav="' + b.id + '" aria-pressed="' + fav + '" aria-label="' + (fav ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها") + '"><svg><use href="#i-heart"/></svg></button>' +
        (b.kind === "mine" ? '<button type="button" class="beat-del" data-del="' + b.id + '" aria-label="حذف"><svg><use href="#i-trash"/></svg></button>' : "") +
      "</span>";
    return el;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function inFilter(b) { return S.beatFilter === "all" || b.family === S.beatFilter; }
  function tempoOk(b) {
    var t = effBpm(b); if (S.beatTempo === "all" || !t) return S.beatTempo === "all" || !t;
    return S.beatTempo === "slow" ? t < 80 : S.beatTempo === "mid" ? t >= 80 && t <= 95 : t > 95;
  }
  function matchesQuery(b) {
    if (!beatQuery) return true;
    var hay = [b.name, b.genre, b.vibe, b.artist].concat((b.moods || []).map(function (m) { return MOOD_LABEL[m]; })).join(" ").toLowerCase();
    return beatQuery.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function filtersActive() { return S.beatFilter !== "all" || S.beatMood !== "all" || S.beatTempo !== "all" || S.onlyFavs || !!beatQuery; }
  /* the list the picker shows (and Endless rotates through) */
  function visibleBeats() {
    var plays = Stats.load().beats;
    var pool = library.concat(S.mode === "classic" ? mine : []);
    var list = pool.filter(function (b) {
      return (S.mode !== "endless" || b.kind === "synth") && inFilter(b) &&
             (S.beatMood === "all" || (b.moods || []).indexOf(S.beatMood) >= 0) &&
             tempoOk(b) && (!S.onlyFavs || isFav(b.id)) && matchesQuery(b);
    });
    var by = {
      played: function (a, b) { return (plays[b.name] || 0) - (plays[a.name] || 0); },
      new: function (a, b) { return (b.added || "").localeCompare(a.added || ""); },
      fast: function (a, b) { return (effBpm(b) || 0) - (effBpm(a) || 0); },
      slow: function (a, b) { return (effBpm(a) || 999) - (effBpm(b) || 999); },
      name: function (a, b) { return a.name.localeCompare(b.name, "fa"); }
    }[S.beatSort];
    if (by) list = list.slice().sort(by);
    return { list: list, plays: plays };
  }

  var libReady = { manifest: location.protocol === "file:", mine: false };
  function renderBeats() {
    // don't drop a selected MP3/upload while those lists are still loading
    var waiting = (/^lib-/.test(S.beat) && !libReady.manifest) || (/^mine-/.test(S.beat) && !libReady.mine);
    if (!waiting && (!findBeat(S.beat) || (S.mode === "endless" && findBeat(S.beat).kind !== "synth"))) S.beat = "golden";
    var base = library.filter(function (b) { return S.mode !== "endless" || b.kind === "synth"; });
    // genre chips
    var fbox = $("#beatFilter"); fbox.innerHTML = "";
    QB.BEAT_FAMILIES.forEach(function (f) {
      var n = base.filter(function (b) { return f[0] === "all" || b.family === f[0]; }).length;
      var c = chip(f[1] + ' <small class="count">' + fa(n) + "</small>", "", S.beatFilter === f[0], { bfilter: f[0] });
      c.classList.add("sm"); fbox.appendChild(c);
    });
    // favourites + mood + tempo chips
    var mbox = $("#beatMoods"); mbox.innerHTML = "";
    var favChip = chip('<svg class="i-heart"><use href="#i-heart"/></svg> علاقه‌مندی‌ها <small class="count">' + fa((S.favs || []).length) + "</small>", "", S.onlyFavs, { onlyfavs: 1 });
    favChip.classList.add("sm", "fav-chip"); mbox.appendChild(favChip);
    QB.MOODS.forEach(function (m) {
      var c = chip(m[1], "", S.beatMood === m[0], { mood: S.beatMood === m[0] ? "all" : m[0] }); c.classList.add("sm"); mbox.appendChild(c);
    });
    var sep = document.createElement("span"); sep.className = "chip-sep"; mbox.appendChild(sep);
    TEMPOS.forEach(function (t) {
      var c = chip(t[1], "", S.beatTempo === t[0], { tempo: t[0] }); c.classList.add("sm"); mbox.appendChild(c);
    });
    $("#beatSort").value = S.beatSort;

    var v = visibleBeats(), box = $("#beatList"); box.innerHTML = "";
    v.list.forEach(function (b) {
      box.appendChild(beatCard(b, v.plays[b.name]));
      if (b.id === S.beat) box.appendChild(beatSettingsPanel(b));
    });
    $("#beatCount").innerHTML = fa(v.list.length) + " بیت" + (filtersActive() ? ' · <button type="button" class="link-btn" id="clearFilters">پاک کردن فیلترها</button>' : "");
    if (!v.list.length) box.innerHTML = '<p class="note empty-list">بیتی با این فیلترها پیدا نشد.</p>';
    // selected beat hidden by filters → keep it visible on top so the choice is clear
    var sel = findBeat(S.beat);
    if (sel && v.list.indexOf(sel) < 0) {
      var pinned = beatCard(sel, v.plays[sel.name]); pinned.classList.add("is-pinned");
      box.insertBefore(beatSettingsPanel(sel), box.firstChild);
      box.insertBefore(pinned, box.firstChild);
    }
    $("#mineHead").hidden = true; $("#mineList").innerHTML = "";
    $(".upload-card").hidden = S.mode !== "classic";
    var note = $("#endlessNote");
    if (S.mode === "endless") {
      var n = v.list.filter(function (b) { return b.kind === "synth" && b.id !== S.beat; }).length;
      note.hidden = false;
      note.textContent = n ? "بی‌پایان: بعد از «" + (sel ? sel.name : "") + "»، " + fa(n) + " بیتِ همین لیست به‌نوبت و قاطی پخش می‌شن. با فیلتر یا علاقه‌مندی‌ها پلی‌لیست خودت رو بساز."
                           : "بی‌پایان: فقط همین یه بیت تکرار می‌شه — فیلتر رو باز کن تا بیت‌های بیشتری بیاد.";
    } else note.hidden = true;
    updatePreviewButtons();
    loadWaves(v.list);
  }

  /* settings for the selected beat, shown right under its card */
  function beatSettingsPanel(b) {
    var p = document.createElement("div"), o = beatOpts(b.id);
    p.className = "beat-settings";
    var html = '<div class="bs-head"><b>تنظیمات این بیت</b>' + (Object.keys(o).length ? '<button type="button" class="link-btn" data-bsreset="' + b.id + '">برگردون به پیش‌فرض</button>' : "") + "</div>";
    if (b.kind === "synth") {
      var t = Math.round((o.tempo || 1) * 100);
      html += '<div class="bs-row"><label for="bsTempo">سرعت</label>' +
        '<input type="range" id="bsTempo" min="85" max="115" step="1" value="' + t + '">' +
        '<output id="bsTempoOut">' + fa(Math.round(b.bpm * t / 100)) + " BPM · " + fa(t) + "٪</output></div>";
      html += '<div class="bs-row"><label>لایه‌ها</label><div class="seg">' +
        [["all", "کامل"], ["drums", "فقط درام"], ["nodrums", "بدون درام"]].map(function (l) {
          var on = (o.layers || "all") === l[0];
          return '<button type="button" class="seg-btn' + (on ? " is-on" : "") + '" aria-pressed="' + on + '" data-layers="' + l[0] + '">' + l[1] + "</button>";
        }).join("") + "</div></div>";
    } else {
      var auto = b.intro != null ? "خودکار (" + fa(b.intro) + ")" : "خودکار";
      var cur = o.skip == null ? "auto" : String(o.skip);
      html += '<div class="bs-row"><label>رد کردن اینترو</label><div class="seg">' +
        [["auto", auto], ["0", "هیچی"], ["1", fa(1)], ["2", fa(2)], ["4", fa(4)], ["8", fa(8)]].map(function (s) {
          var on = cur === s[0];
          return '<button type="button" class="seg-btn' + (on ? " is-on" : "") + '" aria-pressed="' + on + '" data-skip="' + s[0] + '">' + s[1] + "</button>";
        }).join("") + '</div><small class="bs-hint">بار</small></div>';
      html += '<p class="bs-hint">صدای این بیت خودکار هم‌سطح بقیه می‌شه.' + (b.dur ? " طول ترک: " + fmtTime(b.dur) : "") + "</p>";
    }
    html += '<label class="toggle bs-toggle"><input type="checkbox" id="bsAutoHalf"' + (S.autoHalf ? " checked" : "") + '><span class="toggle-ui"></span><span>نیم‌سرعت خودکار <small>(وقتی بیت بالای ۱۱۵ BPM باشه، توپ نصف سرعت می‌ره)</small></span></label>';
    p.innerHTML = html;
    return p;
  }

  /* waveforms: built-in beats are rendered offline (silently), MP3s come from their cached analysis */
  var waveQueue = [], waveBusy = false;
  function loadWaves(list) {
    list.forEach(function (b) {
      if (b.kind !== "synth" || waves[b.id]) return;
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem("qb.wave1." + b.id) || "null"); } catch (e) {}
      if (cached) { waves[b.id] = cached; $$('[data-wave="' + b.id + '"]').forEach(function (el) { el.innerHTML = waveSVG(cached); }); }
      else if (waveQueue.indexOf(b.id) < 0) waveQueue.push(b.id);
    });
    if (waveBusy || !waveQueue.length || !window.OfflineAudioContext) return;
    waveBusy = true;
    QB.audio.ensure();
    (function next() {
      var id = waveQueue.shift();
      if (!id) { waveBusy = false; return; }
      QB.beatWave(QB.beatById(id)).then(function (pk) {
        waves[id] = pk;
        try { localStorage.setItem("qb.wave1." + id, JSON.stringify(pk)); } catch (e) {}
        $$('[data-wave="' + id + '"]').forEach(function (el) { el.innerHTML = waveSVG(pk); });
      }).catch(function () {}).then(function () { setTimeout(next, 30); });
    })();
  }

  function renderSetup() {
    var titles = { classic: "بازی کلاسیک", endless: "بازی بی‌پایان", tap: "حالت تپ" };
    $("#setupTitle").textContent = titles[S.mode];
    $("#beatField").hidden = S.mode === "tap";
    $("#tapField").hidden = S.mode !== "tap";
    $("#lengthField").hidden = S.mode === "tap";
    $("#beatTitle").textContent = S.mode === "endless" ? "بیت اول (بقیه پشت‌سرش میان)" : "بیت";
    // number the fields in visual order
    $("#lengthField .field-num").textContent = fa(4);
    renderLevels(); renderAdvanced(); renderLists(); renderLengths(); renderBeats();
    $("#tapBpmInput").value = S.tapBpm;
    $("#tapBpm").textContent = fa(S.tapBpm);
    $("#clickToggle").checked = S.click;
    var canRec = QB.Recorder.supported();
    $("#recToggle").checked = canRec && S.rec;
    $("#recToggle").disabled = !canRec;
    $("#camToggle").checked = S.cam;
    $("#camRow").hidden = !(canRec && S.rec);
    $(".rec-note").textContent = canRec
      ? "ویدیو فقط روی دستگاه خودت ساخته می‌شه و جایی آپلود نمی‌شه. با هدفون بهتر درمیاد."
      : "مرورگرت ضبط ویدیو رو پشتیبانی نمی‌کنه.";
    $("#recField .field-num").textContent = fa(S.mode === "tap" ? 4 : 5);
    if (!matchLevel()) $("#advanced").open = true;
    updateSummary();
  }

  function updateSummary() {
    var lv = matchLevel();
    var parts = [lv ? QB.LEVELS[lv].label : "دستی"];
    if (S.mode === "tap") parts.push(fa(S.tapBpm) + " BPM");
    else {
      var b = findBeat(S.beat); if (b) parts.push(b.name + (effBpm(b) ? " · " + fa(Math.round(effBpm(b))) + " BPM" : ""));
      parts.push(S.mode === "classic" ? (S.bars === "full" ? "کل ترک" : fa(S.bars) + " بار") : "بی‌پایان");
    }
    $("#summary").innerHTML = parts.map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("");
  }

  /* ---------- previews ---------- */
  var preview = null, previewId = null;
  function stopPreview() {
    if (preview) preview.stop(0.15);
    preview = null; previewId = null;
    updatePreviewButtons();
  }
  function startPreview(id) {
    stopPreview();
    var b = findBeat(id); if (!b) return;
    previewId = id;
    updatePreviewButtons();
    if (b.kind === "synth") {
      preview = new QB.Transport();
      preview.start({ kind: "synth", beats: [synthFor(id)], preview: true, intro: false, volume: 0.8 });
    } else {
      loadBuffer(b).then(function (buf) {
        if (previewId !== id) return;
        preview = new QB.Transport();
        var src = bufferSource(b, buf);   // starts after the intro, at the beat's level
        src.volume = 0.8;
        preview.start(src);
        preview.onEnd = stopPreview;
      }).catch(function () { previewId = null; updatePreviewButtons(); globalToast("فایل این بیت باز نشد"); });
    }
  }
  function restartPreviewIf(id) { if (previewId === id) startPreview(id); }
  function updatePreviewButtons() {
    $$(".beat-play").forEach(function (btn) {
      var on = btn.dataset.preview === previewId;
      btn.classList.toggle("is-playing", on);
      btn.innerHTML = '<svg><use href="#i-' + (on ? "stop" : "play") + '"/></svg>';
    });
  }

  /* ---------- tap tempo ---------- */
  var taps = [];
  function tapBpmFrom(list) {
    if (list.length < 2) return null;
    var iv = [];
    for (var i = 1; i < list.length; i++) iv.push(list[i] - list[i - 1]);
    iv.sort(function (a, b) { return a - b; });
    var med = iv[Math.floor(iv.length / 2)];
    return 60000 / med;
  }
  function onTap() {
    QB.audio.ensure();
    var now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 12) taps.shift();
    var pad = $("#tapPad"); pad.classList.remove("pulse"); void pad.offsetWidth; pad.classList.add("pulse");
    var bpm = tapBpmFrom(taps);
    if (bpm) {
      while (bpm > 180) bpm /= 2;
      while (bpm < 55) bpm *= 2;
      S.tapBpm = Math.round(bpm); save();
      $("#tapBpmInput").value = S.tapBpm;
    }
    $("#tapBpm").textContent = taps.length >= 2 ? fa(S.tapBpm) : "—";
    $("#tapLabel").textContent = taps.length >= 4 ? "آماده‌ای! (بازم بزنی دقیق‌تر می‌شه)" : "باز هم… " + fa(Math.max(0, 4 - taps.length));
    updateSummary();
  }

  /* ---------- game ---------- */
  var game = null, lastResult = null, lastCfg = null;
  var meterBars = [];

  function buildMeter() {
    var m = $("#meter"); m.innerHTML = "";
    meterBars = [];
    for (var i = 0; i < 14; i++) { var s = document.createElement("i"); m.appendChild(s); meterBars.push(s); }
  }
  var freq = null;
  function drawMeter() {
    var an = QB.audio.analyser; if (!an) return;
    if (!freq) freq = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(freq);
    for (var i = 0; i < meterBars.length; i++) {
      var idx = Math.floor(Math.pow(i / meterBars.length, 1.6) * (freq.length * 0.7)) + 1;
      meterBars[i].style.transform = "scaleY(" + Math.max(0.06, freq[idx] / 255).toFixed(3) + ")";
    }
  }

  function legendFor(cfg) {
    var s = QB.SCHEMES[cfg.scheme];
    return '<span class="scheme-viz">' + schemeBars(s.pattern) + "</span><span>" + s.label + " · " + QB.FILLS[cfg.fill].label + "</span>";
  }

  var ui = {
    grid: null,
    onStart: function (g) {
      var c = g.cfg;
      $("#barTotal").textContent = g.totalBars ? "/ " + QB.pad2(g.totalBars) : "/ ∞";
      $("#schemeLegend").innerHTML = legendFor(c);
      $(".progress").classList.toggle("is-hidden", !g.totalBars);
      $("#gameHint").textContent = c.mode === "tap" ? "توپ با ضربی که زدی می‌ره — همراه آهنگ بخون" : "توپ رو دنبال کن — قافیه رو روی ضرب چهارم بکوب";
      ui._first = true;
    },
    onSegment: function (seg, g) {
      var b = seg.beat;
      $("#npName").textContent = b.name || "—";
      $("#npMeta").textContent = (b.genre ? b.genre + " · " : "") + fa(Math.round(b.bpm)) + " BPM" + (g.speed !== 1 ? " · توپ " + (g.speed < 1 ? "نصف" : "دو برابر") : "");
      if (!ui._first) toast("بیت بعدی: " + b.name);
      ui._first = false;
    },
    onFrame: function (gb, g) {
      var bar = Math.max(0, Math.floor(gb / 4));
      if (g.totalBars) bar = Math.min(bar, g.totalBars);
      var txt = QB.pad2(bar);
      if (ui._barTxt !== txt) { $("#barNow").textContent = txt; ui._barTxt = txt; }
      if (g.totalBars) $("#progressFill").style.transform = "scaleX(" + Math.min(1, Math.max(0, (gb / 4 - 1) / g.totalBars)).toFixed(4) + ")";
      drawMeter();
    },
    onFinish: function (res) {
      lastResult = res;
      var src = res.cfg.source || {};
      var beatName = src.beats ? src.beats[0].name : src.kind === "buffer" ? src.name : "ضرب دستی";
      res.dailyDone = !!res.cfg.daily && !res.early && res.bars >= res.cfg.bars;
      res.streak = Stats.record(res, beatName, res.dailyDone ? res.cfg.daily : null);
      showReview(res);
      $("#recDot").hidden = true;
      if (recActive) {
        recActive = false;
        $("#recResult").hidden = false;
        $("#recResult").classList.add("is-loading");
        QB.Recorder.stop().then(showRecording);
      } else $("#recResult").hidden = true;
    }
  };

  /* ---------- recording ---------- */
  var recActive = false, recUrl = null, recFile = null;
  function showRecording(r) {
    var box = $("#recResult");
    box.classList.remove("is-loading");
    if (!r) { box.hidden = true; globalToast("ضبط ویدیو انجام نشد"); return; }
    if (recUrl) URL.revokeObjectURL(recUrl);
    recUrl = r.url;
    var name = "qafiyeh-baz-" + Stats.dayKey() + "." + r.ext;
    recFile = new File([r.blob], name, { type: r.mime });
    $("#recVideo").src = r.url;
    $("#recSave").href = r.url;
    $("#recSave").setAttribute("download", name);
    $("#recShare").hidden = !(QB.native.is || (navigator.canShare && navigator.canShare({ files: [recFile] })));
  }

  function buildCfg() {
    return { mode: S.mode, scheme: S.scheme, fill: S.fill, list: S.list, clean: S.clean, speed: +S.speed,
             bars: S.bars === "full" ? 16 : S.bars, switchEvery: S.switchEvery, lagMs: S.lag };
  }
  /* Auto half-time: very fast tempos get a half-speed ball so they stay rappable */
  function autoHalf(cfg, bpm) { if (S.autoHalf && bpm > 115 && cfg.mode !== "endless") cfg.speed = cfg.speed * 0.5; }

  function startGame(reuseGen, cfgOverride) {
    stopPreview();
    var cfg = cfgOverride || buildCfg();
    QB.audio.ensure();
    var go = function (source) {
      cfg.source = source;
      lastCfg = cfg;
      var begin = function (withRec) {
        show("game");
        $("#recDot").hidden = !withRec;
        requestAnimationFrame(function () {
          game.start(cfg, reuseGen || null);
          recActive = withRec && QB.Recorder.start(game);
        });
      };
      if (!(S.rec && QB.Recorder.supported())) return begin(false);
      QB.Recorder.prepare(S.cam).then(function () { begin(true); }).catch(function () {
        globalToast("اجازه‌ی میکروفون یا دوربین داده نشد — بدون ضبط ادامه می‌دیم", 3200);
        begin(false);
      });
    };
    if (cfg.source) return go(cfg.source);
    if (S.mode === "tap") {
      var ctx = QB.audio.ctx, t0 = null, bpm = S.tapBpm;
      var lastTap = taps[taps.length - 1];
      if (taps.length >= 4 && performance.now() - lastTap < 6000) {
        var period = 60 / bpm, lastAudio = ctx.currentTime - (performance.now() - lastTap) / 1000;
        t0 = lastAudio + period * Math.ceil((ctx.currentTime + 0.15 - lastAudio) / period);
      }
      autoHalf(cfg, bpm);
      return go({ kind: "click", bpm: bpm, audible: S.click, t0: t0 });
    }
    var b = findBeat(S.beat);
    if (!b) return;
    if (b.kind === "synth") {
      var beats = [synthFor(b.id)];
      if (S.mode === "endless") {
        // Endless rotates through the list the player filtered (genre, mood, tempo, favourites, search)
        var pool = visibleBeats().list.filter(function (x) { return x.kind === "synth" && x.id !== b.id; });
        beats = beats.concat(QB.shuffle(pool.map(function (x) { return synthFor(x.id); })));
      }
      autoHalf(cfg, beats[0].bpm);
      return go({ kind: "synth", beats: beats });
    }
    $("#startBtn").disabled = true;
    loadBuffer(b).then(function (buf) {
      $("#startBtn").disabled = false;
      var src = bufferSource(b, buf);
      if (S.bars === "full" && cfg.mode === "classic") {
        // whole track: as many bars as the file has after the intro (even, so any ball speed divides it)
        var n = Math.floor((buf.duration - src.offset) / (240 / b.bpm)) - 1;
        cfg.bars = Math.max(4, n - (n % 2));
      }
      autoHalf(cfg, b.bpm);
      go(src);
    }).catch(function () { $("#startBtn").disabled = false; globalToast("فایل این بیت باز نشد"); });
  }

  function quitGame() { if (game && game.running) game.finish(true); }

  var CHEERS = [
    [0, "گرم شدی؟", "دوباره بزن"],
    [4, "شروع خوبی بود", "ادامه بده"],
    [12, "دمت گرم!", "داری راه می‌افتی"],
    [28, "ترکوندی!", "این دیگه فری‌استایله"],
    [60, "اسطوره!", "میکروفون مال توئه"]
  ];
  function showReview(res) {
    var c = CHEERS[0];
    CHEERS.forEach(function (x) { if (res.bars >= x[0]) c = x; });
    var title = $("#reviewTitle");
    title.textContent = c[1]; title.dataset.text = c[1];
    $("#reviewKicker").textContent = c[2];
    $("#statBars").textContent = fa(res.bars);
    var m = Math.floor(res.secs / 60), s = Math.floor(res.secs % 60);
    $("#statTime").textContent = fa(m) + ":" + QB.pad2(s);
    $("#statWords").textContent = fa(res.words.length);
    var wall = $("#wordWall"); wall.innerHTML = "";
    for (var i = 0; i < res.words.length; i += 4) {
      var line = document.createElement("div"); line.className = "wall-line";
      res.words.slice(i, i + 4).forEach(function (w) {
        var sp = document.createElement("span");
        sp.className = "wall-word c" + w.color + (w.visible ? "" : " was-hidden");
        sp.textContent = w.word;
        if (!w.visible) sp.title = "این یکی رو خودت پیدا کردی";
        line.appendChild(sp);
      });
      wall.appendChild(line);
    }
    if (!res.words.length) wall.innerHTML = '<p class="note">' + (QB.SCHEMES[res.cfg.scheme].pattern ? "هنوز به اولین قافیه نرسیده بودی." : "حالت بی‌قافیه — فقط فلو.") + "</p>";
    $("#replaySame").hidden = !res.words.length;

    // streak feedback
    var st = res.streak, line = $("#streakLine"), msg = "";
    if (st) {
      if (st.after > st.before) msg = st.after === 1 ? "زنجیره شروع شد! فردا هم بیا." : "زنجیره‌ت شد " + fa(st.after) + " روز!";
      else if (st.today < Stats.DAY_MIN) msg = "امروز " + fa(Stats.DAY_MIN - st.today) + " بار دیگه بخونی، تو زنجیره حساب می‌شه.";
      else if (st.after) msg = "زنجیره: " + fa(st.after) + " روز";
    }
    line.textContent = msg; line.hidden = !msg;
    $("#dailyDone").hidden = !res.dailyDone;
    show("review");
  }

  function shareDaily() {
    var info = dailyInfo();
    var url = location.origin + location.pathname.replace(/index\.html$/, "");
    var text = "چالش امروز قافیه‌باز (" + info.date + ") رو کامل کردم — " + fa(info.bars) + " بار روی «" + info.beat.name + "». تو هم امتحان کن:";
    if (QB.native.is) { url = "https://awlirezaz.github.io/qafiyeh-baz/"; QB.native.shareText("قافیه‌باز", text, url).catch(function () {}); }
    else if (navigator.share) navigator.share({ title: "قافیه‌باز", text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(function () { globalToast("متن کپی شد — بفرستش برای رفیقات"); });
  }

  /* ---------- upload flow ---------- */
  var up = null, upPreview = null, upRaf = 0;
  function openUpload(file) {
    var dlg = $("#uploadDlg");
    $("#analyzing").hidden = false; $("#uploadForm").hidden = true; $("#upSave").disabled = true;
    dlg.showModal();
    var ctx = QB.audio.ensure();
    file.arrayBuffer().then(function (ab) {
      var keep = ab.slice(0);
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); }).then(function (buf) {
        return new Promise(function (res) {
          setTimeout(function () { res({ buf: buf, keep: keep, tempo: QB.detectTempo(buf) }); }, 30);
        });
      });
    }).then(function (r) {
      up = { buf: r.buf, data: r.keep, bpm: r.tempo.bpm, offset: r.tempo.offset, name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) };
      $("#upName").value = up.name;
      syncUpForm();
      $("#analyzing").hidden = true; $("#uploadForm").hidden = false; $("#upSave").disabled = false;
    }).catch(function () {
      dlg.close();
      globalToast("این فایل خونده نشد. یه MP3 یا WAV دیگه امتحان کن.");
    });
  }
  function syncUpForm() {
    $("#upBpm").value = up.bpm;
    $("#upOffset").textContent = fa((up.offset).toFixed(2)).replace(".", "٫") + " ثانیه";
  }
  function stopUpPreview() {
    if (upPreview) upPreview.stop(0.1);
    upPreview = null; cancelAnimationFrame(upRaf);
    $("#upPlay").innerHTML = '<svg><use href="#i-play"/></svg>گوش بده';
    $$("#upDots i").forEach(function (d) { d.className = ""; });
  }
  function restartUpPreview() { if (upPreview) { stopUpPreview(); playUpPreview(); } }
  function playUpPreview() {
    stopPreview();
    upPreview = new QB.Transport();
    upPreview.start({ kind: "buffer", buffer: up.buf, bpm: up.bpm, offset: up.offset, name: up.name, audible: true, volume: 0.85 });
    upPreview.onEnd = stopUpPreview;
    $("#upPlay").innerHTML = '<svg><use href="#i-stop"/></svg>بسه';
    var dots = $$("#upDots i");
    (function loop() {
      if (!upPreview) return;
      var t = QB.audio.ctx.currentTime - QB.audio.latency() - S.lag / 1000;
      var b = upPreview.beatPos(t);
      var i = ((Math.floor(b) % 4) + 4) % 4, f = b - Math.floor(b);
      dots.forEach(function (d, k) { d.className = (b >= 0 && k === i && f < 0.35) ? "on" + (k === 0 ? " one" : "") : ""; });
      upRaf = requestAnimationFrame(loop);
    })();
  }

  /* ---------- wire up ---------- */
  function init() {
    // theme dots + cards
    var dots = $$(".theme-dots");
    dots.forEach(function (box) {
      THEMES.forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "theme-dot"; b.dataset.theme = t.id;
        b.setAttribute("role", "radio"); b.setAttribute("aria-label", t.name); b.title = t.name;
        b.style.background = "linear-gradient(135deg," + t.sw[0] + " 0 50%," + t.sw[1] + " 50% 100%)";
        box.appendChild(b);
      });
    });
    var cards = $("#themeCards");
    THEMES.forEach(function (t) {
      var l = document.createElement("label");
      l.className = "theme-card theme-card--" + t.id;
      l.innerHTML = '<input type="radio" name="theme" value="' + t.id + '"><span class="tc-swatch">' +
        t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") + "</span><b>" + t.name + "</b>";
      cards.appendChild(l);
    });
    applyTheme(S.theme);

    ui.grid = $("#grid");
    game = new QB.Game(ui);
    buildMeter();

    document.addEventListener("click", function (e) {
      if (e.target.id === "clearFilters") {
        S.beatFilter = "all"; S.beatMood = "all"; S.beatTempo = "all"; S.onlyFavs = false; beatQuery = "";
        $("#beatSearch").value = ""; save(); renderBeats(); return;
      }
      var t = e.target.closest("[data-fav],[data-onlyfavs],[data-mood],[data-tempo],[data-layers],[data-skip],[data-bsreset],[data-bfilter],[data-go],[data-mode],[data-open],[data-level],[data-fill],[data-scheme],[data-speed],[data-list],[data-bars],[data-every],[data-preview],[data-del],[data-beat],[data-bpm],.theme-dot");
      if (!t) return;
      var d = t.dataset;
      if (d.fav) {
        e.stopPropagation();
        S.favs = (S.favs || []).filter(function (x) { return x !== d.fav; });
        if (t.getAttribute("aria-pressed") !== "true") S.favs.push(d.fav);
        save(); renderBeats(); return;
      }
      if (d.onlyfavs) { S.onlyFavs = !S.onlyFavs; save(); renderBeats(); return; }
      if (d.mood) { S.beatMood = d.mood; save(); renderBeats(); return; }
      if (d.tempo) { S.beatTempo = d.tempo; save(); renderBeats(); return; }
      if (d.layers) { setBeatOpt(S.beat, "layers", d.layers === "all" ? null : d.layers); renderBeats(); restartPreviewIf(S.beat); return; }
      if (d.skip) { setBeatOpt(S.beat, "skip", d.skip === "auto" ? null : +d.skip); renderBeats(); restartPreviewIf(S.beat); return; }
      if (d.bsreset) { S.beatOpts && delete S.beatOpts[d.bsreset]; save(); renderBeats(); updateSummary(); restartPreviewIf(d.bsreset); return; }
      if (d.bfilter) { S.beatFilter = d.bfilter; save(); renderBeats(); return; }
      if (d.go) { e.preventDefault(); if (game.running) game.stop(true); show(d.go); return; }
      if (d.mode && !t.closest(".setup")) { S.mode = d.mode; save(); renderSetup(); show("setup"); return; }
      if (d.open === "settings") { $("#settingsDlg").showModal(); return; }
      if (t.classList.contains("theme-dot")) { applyTheme(d.theme); return; }
      if (d.level) { var L = QB.LEVELS[d.level]; S.fill = L.fill; S.scheme = L.scheme; save(); renderLevels(); renderAdvanced(); updateSummary(); return; }
      if (d.fill) { S.fill = d.fill; save(); renderLevels(); renderAdvanced(); updateSummary(); return; }
      if (d.scheme) { S.scheme = d.scheme; save(); renderLevels(); renderAdvanced(); updateSummary(); return; }
      if (d.speed) { S.speed = +d.speed; save(); renderAdvanced(); return; }
      if (d.list) { S.list = d.list; save(); renderLists(); return; }
      if (d.bars) { S.bars = d.bars === "full" ? "full" : +d.bars; save(); renderLengths(); updateSummary(); return; }
      if (d.every) { S.switchEvery = +d.every; save(); renderLengths(); return; }
      if (d.bpm) { S.tapBpm = Math.min(200, Math.max(50, S.tapBpm + +d.bpm)); save(); $("#tapBpmInput").value = S.tapBpm; $("#tapBpm").textContent = fa(S.tapBpm); updateSummary(); return; }
      if (d.preview) { e.stopPropagation(); if (previewId === d.preview) stopPreview(); else startPreview(d.preview); return; }
      if (d.del) {
        e.stopPropagation();
        var b = findBeat(d.del);
        if (b && confirm("«" + b.name + "» از بیت‌های تو پاک بشه؟")) {
          if (previewId === b.id) stopPreview();
          mine = mine.filter(function (x) { return x.id !== b.id; });
          delete decoded[b.id];
          DB.del(b.id).catch(function () {});
          if (S.beat === b.id) S.beat = "golden";
          save(); renderBeats(); updateSummary();
        }
        return;
      }
      if (d.beat) { if (S.beat === d.beat) return; S.beat = d.beat; save(); renderBeats(); renderLengths(); updateSummary(); return; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest && e.target.closest(".beat-card");
      if (card && e.target === card) { e.preventDefault(); card.click(); }
    });

    $("#cleanToggle").addEventListener("change", function (e) { S.clean = e.target.checked; save(); $("#cleanToggle2").checked = S.clean; });
    $("#cleanToggle2").addEventListener("change", function (e) { S.clean = e.target.checked; save(); $("#cleanToggle").checked = S.clean; });
    $("#clickToggle").addEventListener("change", function (e) { S.click = e.target.checked; save(); });
    // beat library: search, sort, random, per-beat tempo + auto half-time
    $("#beatSearch").addEventListener("input", function (e) { beatQuery = e.target.value.trim(); renderBeats(); });
    $("#beatSort").addEventListener("change", function (e) { S.beatSort = e.target.value; save(); renderBeats(); });
    $("#beatRandom").addEventListener("click", function () {
      var pool = visibleBeats().list.filter(function (b) { return b.id !== S.beat; });
      if (!pool.length) { globalToast("بیت دیگه‌ای تو این لیست نیست"); return; }
      var pick = pool[Math.floor(Math.random() * pool.length)];
      S.beat = pick.id; save(); renderBeats(); renderLengths(); updateSummary();
      var card = $('.beat-card[data-beat="' + pick.id + '"]');
      if (card) card.scrollIntoView({ block: "center", behavior: "smooth" });
      startPreview(pick.id);
    });
    var tempoTimer;
    $("#beatList").addEventListener("input", function (e) {
      if (e.target.id !== "bsTempo") return;
      var pct = +e.target.value, b = findBeat(S.beat);
      $("#bsTempoOut").textContent = fa(Math.round(b.bpm * pct / 100)) + " BPM · " + fa(pct) + "٪";
      clearTimeout(tempoTimer);
      tempoTimer = setTimeout(function () {
        setBeatOpt(S.beat, "tempo", pct === 100 ? null : pct / 100);
        var card = $('.beat-card[data-beat="' + S.beat + '"] .beat-bpm b');
        if (card) card.textContent = fa(Math.round(effBpm(b)));
        updateSummary(); restartPreviewIf(S.beat);
      }, 180);
    });
    $("#beatList").addEventListener("change", function (e) {
      if (e.target.id === "bsTempo") renderBeats();
      if (e.target.id === "bsAutoHalf") { S.autoHalf = e.target.checked; save(); }
    });

    $("#recToggle").addEventListener("change", function (e) { S.rec = e.target.checked; save(); $("#camRow").hidden = !S.rec; });
    $("#camToggle").addEventListener("change", function (e) { S.cam = e.target.checked; save(); });
    $("#dailyBtn").addEventListener("click", startDaily);
    $("#dailyShare").addEventListener("click", shareDaily);
    $("#recShare").addEventListener("click", function () {
      if (!recFile) return;
      if (QB.native.is) QB.native.shareFile(recFile, recFile.name).catch(function () { globalToast("اشتراک انجام نشد"); });
      else if (navigator.canShare && navigator.canShare({ files: [recFile] }))
        navigator.share({ files: [recFile], title: "قافیه‌باز" }).catch(function () {});
    });
    // in the Android app a download link can't save files — write to Documents/Qafiyeh-Baz instead
    $("#recSave").addEventListener("click", function (e) {
      if (!QB.native.is || !recFile) return;
      e.preventDefault();
      QB.native.saveFile(recFile, recFile.name)
        .then(function () { globalToast("ذخیره شد: Documents/Qafiyeh-Baz", 3500); })
        .catch(function () { globalToast("ذخیره نشد — از «اشتراک» استفاده کن", 3500); });
    });

    // Android back button: close dialogs, leave the game, go back to home, then exit
    QB.native.onBack(function () {
      var open = $("dialog[open]");
      if (open) { open.close(); return; }
      if (current === "game") { quitGame(); return; }
      if (current !== "home") { if (game.running) game.stop(true); show("home"); return; }
      QB.native.exit();
    });

    // install as an app (Android/desktop prompt; iOS needs Share → Add to Home Screen)
    var installEvt = null, standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvt = e; $("#installBtn").hidden = false; });
    window.addEventListener("appinstalled", function () { $("#installBtn").hidden = true; installEvt = null; });
    if (isIOS && !standalone && !QB.native.is) $("#installBtn").hidden = false;
    $("#installBtn").addEventListener("click", function () {
      if (installEvt) {
        installEvt.prompt();
        installEvt.userChoice.then(function () { installEvt = null; $("#installBtn").hidden = true; });
      } else if (isIOS) globalToast("توی سافاری دکمه‌ی Share رو بزن، بعد «Add to Home Screen»", 5000);
    });
    if (!QB.native.is && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    $("#tapBpmInput").addEventListener("change", function (e) {
      var v = Math.round(+e.target.value); if (!v) return;
      S.tapBpm = Math.min(200, Math.max(50, v)); e.target.value = S.tapBpm; $("#tapBpm").textContent = fa(S.tapBpm); save(); updateSummary();
    });
    $("#tapPad").addEventListener("pointerdown", function (e) { e.preventDefault(); onTap(); });

    $("#themeCards").addEventListener("change", function (e) { if (e.target.name === "theme") applyTheme(e.target.value); });
    var lag = $("#lagRange");
    lag.value = S.lag; $("#lagOut").textContent = fa(S.lag) + " ms";
    lag.addEventListener("input", function () { S.lag = +lag.value; $("#lagOut").textContent = fa(S.lag) + " ms"; save(); });

    $("#startBtn").addEventListener("click", function () { startGame(); });
    $("#quitBtn").addEventListener("click", quitGame);
    $("#replaySame").addEventListener("click", function () { if (lastResult) startGame(lastResult.gen, lastCfg); });
    $("#replayNew").addEventListener("click", function () {
      if (lastCfg) startGame();
    });
    $("#toSetup").addEventListener("click", function () { renderSetup(); show("setup"); });

    document.addEventListener("keydown", function (e) {
      if (current === "game" && (e.key === "Escape" || e.code === "Space")) { e.preventDefault(); quitGame(); }
    });

    // upload
    $("#fileInput").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = "";
      if (f) openUpload(f);
    });
    $("#uploadDlg").addEventListener("close", function () {
      stopUpPreview();
      var dlg = $("#uploadDlg");
      if (dlg.returnValue === "save" && up) {
        var rec = { id: "mine-" + Date.now().toString(36), kind: "mine", name: ($("#upName").value || up.name).trim() || "بیت من",
                    genre: "بیت خودم", vibe: "", bpm: up.bpm, offset: up.offset, data: up.data };
        mine.push(rec); decoded[rec.id] = up.buf; ensureMeta(rec, up.buf);
        S.beat = rec.id; save();
        DB.put({ id: rec.id, name: rec.name, bpm: rec.bpm, offset: rec.offset, data: rec.data, created: Date.now() })
          .catch(function () { globalToast("این مرورگر اجازه‌ی ذخیره نداد؛ بیت فقط تا بستن صفحه می‌مونه."); });
        renderBeats(); updateSummary();
      }
      up = null; dlg.returnValue = "";
    });
    $("#upPlay").addEventListener("click", function () { if (upPreview) stopUpPreview(); else playUpPreview(); });
    $("#upBpm").addEventListener("change", function (e) { var v = +e.target.value; if (v >= 40 && v <= 220) { up.bpm = Math.round(v * 10) / 10; } syncUpForm(); restartUpPreview(); });
    $("#uploadDlg").addEventListener("click", function (e) {
      var t = e.target.closest("[data-upbpm],[data-upmul],[data-upoff],[data-upbeat]"); if (!t || !up) return;
      var d = t.dataset, beat = 60 / up.bpm;
      if (d.upbpm) up.bpm = Math.round((up.bpm + +d.upbpm) * 10) / 10;
      if (d.upmul) up.bpm = Math.round(Math.min(200, Math.max(45, up.bpm * +d.upmul)) * 10) / 10;
      if (d.upoff) up.offset = Math.max(0, Math.round((up.offset + +d.upoff) * 1000) / 1000);
      if (d.upbeat) { up.offset += +d.upbeat * beat; if (up.offset < 0) up.offset += beat * 4; up.offset = Math.round(up.offset * 1000) / 1000; }
      syncUpForm(); restartUpPreview();
    });

    DB.all().then(function (rows) {
      mine = (rows || []).sort(function (a, b) { return a.created - b.created; }).map(function (r) {
        var m = { id: r.id, kind: "mine", name: r.name, genre: "بیت خودم", vibe: "", bpm: r.bpm, offset: r.offset, data: r.data, moods: [] };
        applyMeta(m, readMeta(m));
        return m;
      });
    }).catch(function () {}).then(function () {
      libReady.mine = true;
      renderBeats(); renderLengths(); updateSummary();
    });
    loadManifest();
    renderSetup();
    renderHome();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
