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
    tapBpm: 90, click: false, theme: "poster", lag: 0
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
    $$(".screen").forEach(function (s) { s.classList.toggle("is-active", s.dataset.screen === name); });
    window.scrollTo(0, 0);
    if (name !== "setup") stopPreview();
  }

  var toastTimer;
  function toast(msg, ms) {
    var el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }
  function globalToast(msg) {
    var el = $(".global-toast");
    if (!el) { el = document.createElement("div"); el.className = "toast global-toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
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
    return { id: b.id, kind: "synth", family: b.family, name: b.name, genre: b.genre, vibe: b.vibe, bpm: b.bpm };
  });
  var mine = [];          // user uploads (IndexedDB)
  var decoded = {};       // id -> AudioBuffer cache

  function findBeat(id) {
    return library.concat(mine).filter(function (b) { return b.id === id; })[0] || null;
  }

  function loadBuffer(desc) {
    if (decoded[desc.id]) return Promise.resolve(decoded[desc.id]);
    var ctx = QB.audio.ensure();
    var get = desc.kind === "mine" ? Promise.resolve(desc.data.slice(0))
      : fetch(desc.src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    return get.then(function (ab) {
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); });
    }).then(function (buf) { decoded[desc.id] = buf; return buf; });
  }

  /* optional shared library: beats/manifest.json (works when served over http) */
  function loadManifest() {
    if (location.protocol === "file:") return;
    fetch("beats/manifest.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (e, i) {
          if (!e || !e.file || !e.bpm) return;
          library.push({ id: "lib-" + i, kind: "file", src: "beats/" + e.file, name: e.name || e.file, family: e.family || null,
                         genre: e.genre || "بیت", vibe: e.vibe || "", bpm: +e.bpm, offset: +e.offset || 0 });
        });
        renderBeats();
      }).catch(function () {});
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
      [8, 16, 32, 64].forEach(function (n) {
        var b = chip(fa(n), n === 8 ? "زیر یه دقیقه" : n === 64 ? "یه ترک کامل" : "بار", S.bars === n, { bars: n });
        box.appendChild(b);
      });
    } else {
      $("#lengthTitle").textContent = "هر چند بار بیت عوض شه؟";
      [8, 16, 32].forEach(function (n) { box.appendChild(chip(fa(n), "بار", S.switchEvery === n, { every: n })); });
    }
  }

  function beatCard(b) {
    var el = document.createElement("div");
    el.className = "beat-card" + (S.beat === b.id ? " is-on" : "");
    el.dataset.beat = b.id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", S.beat === b.id);
    el.innerHTML =
      '<button type="button" class="beat-play" data-preview="' + b.id + '" aria-label="پیش‌نمایش"><svg><use href="#i-play"/></svg></button>' +
      '<div class="beat-info"><span class="beat-genre">' + esc(b.genre) + '</span><b class="beat-name">' + esc(b.name) + "</b>" +
      (b.vibe ? '<span class="beat-vibe">' + esc(b.vibe) + "</span>" : "") + "</div>" +
      '<span class="beat-bpm"><b>' + fa(Math.round(b.bpm)) + "</b><small>BPM</small></span>" +
      (b.kind === "mine" ? '<button type="button" class="beat-del" data-del="' + b.id + '" aria-label="حذف"><svg><use href="#i-trash"/></svg></button>' : "");
    return el;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function inFilter(b) { return S.beatFilter === "all" || b.family === S.beatFilter; }

  function renderBeats() {
    var fbox = $("#beatFilter"); fbox.innerHTML = "";
    QB.BEAT_FAMILIES.forEach(function (f) {
      var n = library.filter(function (b) { return (f[0] === "all" || b.family === f[0]) && (S.mode !== "endless" || b.kind === "synth"); }).length;
      var c = chip(f[1] + " <small class=\"count\">" + fa(n) + "</small>", "", S.beatFilter === f[0], { bfilter: f[0] });
      c.classList.add("sm");
      fbox.appendChild(c);
    });
    var box = $("#beatList"); box.innerHTML = "";
    var list = library.filter(function (b) { return inFilter(b) && (S.mode !== "endless" || b.kind === "synth"); });
    list.forEach(function (b) { box.appendChild(beatCard(b)); });
    var mbox = $("#mineList"); mbox.innerHTML = "";
    var showMine = S.mode === "classic" && mine.length > 0 && S.beatFilter === "all";
    $("#mineHead").hidden = !showMine;
    if (showMine) mine.forEach(function (b) { mbox.appendChild(beatCard(b)); });
    $(".upload-card").hidden = S.mode !== "classic";
    if (!findBeat(S.beat) || (S.mode === "endless" && findBeat(S.beat).kind !== "synth")) { S.beat = "golden"; renderBeats(); }
    updatePreviewButtons();
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
    if (!matchLevel()) $("#advanced").open = true;
    updateSummary();
  }

  function updateSummary() {
    var lv = matchLevel();
    var parts = [lv ? QB.LEVELS[lv].label : "دستی"];
    if (S.mode === "tap") parts.push(fa(S.tapBpm) + " BPM");
    else {
      var b = findBeat(S.beat); if (b) parts.push(b.name);
      parts.push(S.mode === "classic" ? fa(S.bars) + " بار" : "بی‌پایان");
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
      preview.start({ kind: "synth", beats: [QB.beatById(id)], preview: true, intro: false, volume: 0.8 });
    } else {
      loadBuffer(b).then(function (buf) {
        if (previewId !== id) return;
        preview = new QB.Transport();
        preview.start({ kind: "buffer", buffer: buf, bpm: b.bpm, offset: b.offset, name: b.name, volume: 0.8 });
        preview.onEnd = stopPreview;
      }).catch(function () { previewId = null; updatePreviewButtons(); globalToast("فایل این بیت باز نشد"); });
    }
  }
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
      showReview(res);
    }
  };

  function buildCfg() {
    return { mode: S.mode, scheme: S.scheme, fill: S.fill, list: S.list, clean: S.clean, speed: +S.speed,
             bars: S.bars, switchEvery: S.switchEvery, lagMs: S.lag };
  }

  function startGame(reuseGen, cfgOverride) {
    stopPreview();
    var cfg = cfgOverride || buildCfg();
    QB.audio.ensure();
    var go = function (source) {
      cfg.source = source;
      lastCfg = cfg;
      show("game");
      requestAnimationFrame(function () { game.start(cfg, reuseGen || null); });
    };
    if (cfg.source && reuseGen) return go(cfg.source);
    if (S.mode === "tap") {
      var ctx = QB.audio.ctx, t0 = null, bpm = S.tapBpm;
      var lastTap = taps[taps.length - 1];
      if (taps.length >= 4 && performance.now() - lastTap < 6000) {
        var period = 60 / bpm, lastAudio = ctx.currentTime - (performance.now() - lastTap) / 1000;
        t0 = lastAudio + period * Math.ceil((ctx.currentTime + 0.15 - lastAudio) / period);
      }
      return go({ kind: "click", bpm: bpm, audible: S.click, t0: t0 });
    }
    var b = findBeat(S.beat);
    if (!b) return;
    if (b.kind === "synth") {
      var beats = [QB.beatById(b.id)];
      if (S.mode === "endless") {
        var pool = QB.BEATS.filter(function (x) { return x.id !== b.id && inFilter(x); });
        if (!pool.length) pool = QB.BEATS.filter(function (x) { return x.id !== b.id; });
        beats = beats.concat(QB.shuffle(pool));
      }
      return go({ kind: "synth", beats: beats });
    }
    $("#startBtn").disabled = true;
    loadBuffer(b).then(function (buf) {
      $("#startBtn").disabled = false;
      go({ kind: "buffer", buffer: buf, bpm: b.bpm, offset: b.offset, name: b.name });
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
    show("review");
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
      var t = e.target.closest("[data-bfilter],[data-go],[data-mode],[data-open],[data-level],[data-fill],[data-scheme],[data-speed],[data-list],[data-bars],[data-every],[data-preview],[data-del],[data-beat],[data-bpm],.theme-dot");
      if (!t) return;
      var d = t.dataset;
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
      if (d.bars) { S.bars = +d.bars; save(); renderLengths(); updateSummary(); return; }
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
      if (d.beat) { S.beat = d.beat; save(); renderBeats(); updateSummary(); return; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest && e.target.closest(".beat-card");
      if (card && e.target === card) { e.preventDefault(); card.click(); }
    });

    $("#cleanToggle").addEventListener("change", function (e) { S.clean = e.target.checked; save(); $("#cleanToggle2").checked = S.clean; });
    $("#cleanToggle2").addEventListener("change", function (e) { S.clean = e.target.checked; save(); $("#cleanToggle").checked = S.clean; });
    $("#clickToggle").addEventListener("change", function (e) { S.click = e.target.checked; save(); });
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
        mine.push(rec); decoded[rec.id] = up.buf;
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
        return { id: r.id, kind: "mine", name: r.name, genre: "بیت خودم", vibe: "", bpm: r.bpm, offset: r.offset, data: r.data };
      });
      if (current === "setup") renderBeats();
    }).catch(function () {});
    loadManifest();
    renderSetup();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
