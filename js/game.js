/*
 * Game: rhyme-scheme word generator, the scrolling beat grid with the
 * bouncing ball, and the game controller that ties it to the Transport.
 */
(function () {
  var QB = window.QB;

  QB.SCHEMES = {
    aabb: { label: "جفت‌جفت", hint: "۱ و ۲، ۳ و ۴", pattern: "AABB" },
    abab: { label: "یکی‌درمیون", hint: "۱ و ۳، ۲ و ۴", pattern: "ABAB" },
    aaaa: { label: "تک‌قافیه", hint: "هر چهار تا یکی", pattern: "AAAA" },
    custom: { label: "دلخواه", hint: "خودت بچینش", pattern: null, custom: true },
    none: { label: "بی‌قافیه", hint: "فقط فلو", pattern: null }
  };
  /* how many bars one rhyme sound lasts before a new one is picked (0 = the whole round) */
  QB.HOLDS = [[4, "هر ۴ بار"], [8, "هر ۸ بار"], [16, "هر ۱۶ بار"], [0, "هیچ‌وقت"]];
  /* custom pattern: 4 lines, each A / B / C or "-" (no rhyme) */
  QB.cleanPattern = function (p) { return (String(p || "").toUpperCase().replace(/[^ABC-]/g, "") + "AAAA").slice(0, 4); };
  QB.patternOf = function (cfg) {
    var p = cfg.scheme === "custom" ? QB.cleanPattern(cfg.pattern) : (QB.SCHEMES[cfg.scheme] || QB.SCHEMES.aabb).pattern;
    return p && /[ABC]/.test(p) ? p : null;
  };
  QB.FILLS = {
    all:   { label: "همه‌ی کلمه‌ها", hint: "همه‌چی جلوته" },
    first: { label: "فقط اولی",     hint: "جفتش رو خودت پیدا کن" },
    last:  { label: "فقط آخری",     hint: "به سمت کلمه بنویس" },
    none:  { label: "هیچی",          hint: "فقط رنگ‌ها" }
  };
  QB.LEVELS = {
    beginner:     { label: "مبتدی",   fill: "all",   scheme: "aabb" },
    intermediate: { label: "متوسط",   fill: "first", scheme: "aabb" },
    advanced:     { label: "پیشرفته", fill: "last",  scheme: "aabb" },
    expert:       { label: "حرفه‌ای", fill: "last",  scheme: "aaaa" }
  };

  var FA = "۰۱۲۳۴۵۶۷۸۹";
  QB.fa = function (n) { return String(n).replace(/[0-9]/g, function (d) { return FA[+d]; }); };
  QB.pad2 = function (n) { return QB.fa(n < 10 ? "0" + n : n); };

  function rand(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rand(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  QB.shuffle = shuffle;

  /* deterministic PRNG (mulberry32) — same seed, same words for everyone (daily challenge) */
  QB.seededRandom = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- word generator ---------- */
  function WordGen(cfg) {
    var list = QB.WORD_LISTS[cfg.list] || QB.WORD_LISTS.all;
    var allow = list.allow.filter(function (t) { return !(cfg.clean && t === "m"); });
    this.rng = cfg.seed != null ? QB.seededRandom(cfg.seed) : Math.random;
    this.boost = list.boost;
    this.fill = cfg.fill || "all";
    this.pattern = QB.patternOf(cfg);
    this.hold = cfg.hold == null ? 4 : +cfg.hold;   // bars one rhyme sound lasts; 0 = the whole round
    var keys = list.multi ? QB.MULTI_KEYS : null;
    this.pools = QB.RHYMES.filter(function (g) { return !keys || keys.indexOf(g.key) >= 0; }).map(function (g) {
      return { id: g.id, key: g.key, words: g.words.filter(function (w) { return allow.indexOf(w.tag) >= 0; }) };
    }).filter(function (g) { return g.words.length >= 2; });
    this.blocks = [];
    this.epochs = {};          // epoch → { groupFor: {letter: pool}, used: {letter: {word: true}} }
    this.recentGroups = [];
    this.recentWords = {};
  }
  WordGen.prototype.epochOf = function (k) { return this.hold ? Math.floor(k * 4 / this.hold) : 0; };

  /* a rhyme group with enough words for how long it will be held */
  WordGen.prototype.pickGroup = function (need, exclude) {
    var self = this, ok = function (g) { return exclude.indexOf(g.id) < 0; };
    var cands = this.pools.filter(function (g) { return ok(g) && g.words.length >= need && self.recentGroups.indexOf(g.id) < 0; });
    if (!cands.length) cands = this.pools.filter(function (g) { return ok(g) && g.words.length >= need; });
    if (!cands.length) cands = this.pools.filter(ok).sort(function (a, b) { return b.words.length - a.words.length; }).slice(0, 6);
    return cands[Math.floor(this.rng() * cands.length)];
  };
  /* n words from a group; a held rhyme goes through its whole group before any word repeats */
  WordGen.prototype.pickWords = function (pool, n, used) {
    var self = this, out = [];
    var cand = pool.words.filter(function (w) { return !used[w.w]; });
    if (cand.length < n) { Object.keys(used).forEach(function (k) { delete used[k]; }); cand = pool.words.slice(); }
    var fresh = cand.filter(function (w) { return !self.recentWords[w.w]; });
    if (fresh.length >= n) cand = fresh;
    while (out.length < n && cand.length) {
      var total = 0, weights = cand.map(function (w) { var x = self.boost.indexOf(w.tag) >= 0 ? 3 : 1; total += x; return x; });
      var r = self.rng() * total, i = 0;
      while (r > weights[i]) { r -= weights[i]; i++; }
      out.push(cand[i].w); cand.splice(i, 1);
    }
    out.forEach(function (w) { self.recentWords[w] = true; used[w] = true; });
    var keys = Object.keys(this.recentWords);
    if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function (k) { delete self.recentWords[k]; });
    return out;
  };
  WordGen.prototype.makeBlock = function (k) {
    var pat = this.pattern, block = [];
    if (!pat) { for (var i = 0; i < 4; i++) block.push({ letter: null }); return block; }
    var letters = [], counts = {};
    pat.split("").forEach(function (L) { if (L === "-") return; if (!(L in counts)) { letters.push(L); counts[L] = 0; } counts[L]++; });
    var self = this, e = this.epochOf(k), ep = this.epochs[e];
    if (!ep) {
      // new rhyme sounds for this stretch; long holds need groups with many words
      ep = this.epochs[e] = { groupFor: {}, used: {} };
      var blocks = this.hold ? this.hold / 4 : 8, taken = [];
      letters.forEach(function (L) {
        var g = self.pickGroup(Math.min(counts[L] * blocks, 40), taken);
        taken.push(g.id); ep.groupFor[L] = g; ep.used[L] = {};
      });
      this.recentGroups = this.recentGroups.concat(taken).slice(-8);
    }
    var wordsFor = {};
    letters.forEach(function (L) { wordsFor[L] = self.pickWords(ep.groupFor[L], counts[L], ep.used[L]); });
    var seen = {};
    pat.split("").forEach(function (L) {
      if (L === "-") { block.push({ letter: null }); return; }
      var j = seen[L] = (seen[L] == null ? 0 : seen[L] + 1), c = counts[L], li = letters.indexOf(L);
      var vis = self.fill === "all" || (self.fill === "first" && j === 0) || (self.fill === "last" && j === c - 1);
      // same colour for the whole time a rhyme is held, so you can see it's the same sound
      block.push({ letter: L, word: wordsFor[L][j], visible: vis, color: (e * 2 + li) % 4, group: ep.groupFor[L].key });
    });
    return block;
  };
  /* gameplay bar g >= 1 */
  WordGen.prototype.bar = function (g) {
    var k = Math.floor((g - 1) / 4);
    while (this.blocks.length <= k) this.blocks.push(this.makeBlock(this.blocks.length));
    return this.blocks[k][(g - 1) % 4];
  };
  QB.WordGen = WordGen;

  /* ---------- grid renderer ---------- */
  var ROWS = 5, ANCHOR = 1;

  function Grid(root) {
    this.root = root;
    this.rows = {};
    this.ball = document.createElement("div");
    this.ball.className = "ball";
    this.shadow = document.createElement("div");
    this.shadow.className = "ball-shadow";
    root.appendChild(this.shadow);
    root.appendChild(this.ball);
    this.lastBeat = -99;
    this.measure();
    var self = this;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self.refit(); });
  }
  Grid.prototype.reset = function (gen, totalBars) {
    var self = this;
    Object.keys(this.rows).forEach(function (k) { self.rows[k].remove(); });
    this.rows = {};
    this.gen = gen;
    this.total = totalBars; // null = endless
    this.lastBeat = -99;
  };
  Grid.prototype.measure = function () {
    var h = this.root.clientHeight || 400;
    this.rowH = h / ROWS;
    this.root.style.setProperty("--row-h", this.rowH + "px");
    this.cx = null;
    if (this.rows) this.refit();
  };
  Grid.prototype.cellCenters = function (row) {
    var cells = row.children[1].children, base = this.root.getBoundingClientRect(), out = [];
    for (var i = 0; i < 4; i++) {
      var r = cells[i].getBoundingClientRect();
      out.push({ x: r.left - base.left + r.width / 2, top: r.top - row.getBoundingClientRect().top });
    }
    return out;
  };
  Grid.prototype.makeRow = function (g) {
    var row = document.createElement("div");
    row.className = "row";
    var label = document.createElement("div");
    label.className = "row-num";
    var cells = document.createElement("div");
    cells.className = "cells";
    row.appendChild(label); row.appendChild(cells);
    var end = this.total != null && g > this.total;
    for (var i = 0; i < 4; i++) {
      var c = document.createElement("div");
      c.className = i === 3 ? "cell slot" : "cell beat";
      if (g === 0) {
        if (i < 3) { c.textContent = QB.fa(i + 1); c.classList.add("count"); }
        else { c.textContent = "برو!"; c.classList.add("go"); }
      } else if (end) {
        if (i === 3) { c.textContent = "تمام"; c.classList.add("go"); }
      } else if (i === 3) {
        var b = this.gen.bar(g);
        if (b.letter) {
          c.classList.add("rhyme", "c" + b.color);
          var w = document.createElement("span");
          w.className = "word";
          w.textContent = b.visible ? b.word : "؟";
          if (!b.visible) c.classList.add("hidden-word");
          else if (b.word.length > 7) c.classList.add("long");
          c.appendChild(w);
        } else c.classList.add("free");
      } else {
        c.innerHTML = "<i></i>";
      }
      cells.appendChild(c);
    }
    if (g === 0) { row.classList.add("intro"); label.textContent = ""; }
    else if (end) { row.classList.add("end"); label.textContent = ""; }
    else label.textContent = QB.pad2(g);
    this.root.appendChild(row);
    fitWord(cells.children[3]);
    return row;
  };
  /* shrink a rhyme word until it fits its pill (never cut it off) */
  function fitWord(cell) {
    var w = cell && cell.querySelector(".word");
    if (!w) return;
    w.style.fontSize = "";
    var avail = cell.clientWidth - 6, need = w.scrollWidth;
    if (need > avail && avail > 0) {
      var fs = parseFloat(getComputedStyle(w).fontSize);
      w.style.fontSize = Math.max(14, Math.floor(fs * avail / need)) + "px";
    }
  }
  Grid.prototype.refit = function () {
    var self = this;
    Object.keys(this.rows).forEach(function (k) { fitWord(self.rows[k].children[1].children[3]); });
  };
  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* gb = grid position in beats (can be negative before the start) */
  Grid.prototype.render = function (gb) {
    var self = this, rowH = this.rowH;
    var pos = Math.max(0, gb / 4);
    var whole = Math.floor(pos), frac = pos - whole;
    var scroll = whole + (frac > 0.8 ? easeInOut((frac - 0.8) / 0.2) : 0);
    var maxBar = this.total != null ? this.total + 1 : Infinity;
    var lo = Math.max(0, whole - ANCHOR - 1), hi = Math.min(maxBar, whole + ROWS);

    Object.keys(this.rows).forEach(function (k) {
      if (k < lo || k > hi) { self.rows[k].remove(); delete self.rows[k]; }
    });
    for (var g = lo; g <= hi; g++) {
      var row = this.rows[g] || (this.rows[g] = this.makeRow(g));
      var y = (g - scroll + ANCHOR) * rowH;
      row.style.transform = "translateY(" + y.toFixed(1) + "px)";
      var d = g - whole;
      row.classList.toggle("now", d === 0);
      row.classList.toggle("past", d < 0);
      row.style.opacity = d < 0 ? Math.max(0, 0.32 - (scroll - g - 1) * 0.6) : (d >= ROWS - 2 ? 0.55 : 1);
    }

    // ball
    var anyRow = this.rows[whole] || this.rows[lo];
    if (!anyRow) return;
    if (!this.cx) this.cx = this.cellCenters(anyRow);
    var b = Math.max(0, gb), i = Math.floor(b), f = b - i;
    if (gb < 0) { i = 0; f = 0; }
    var bar1 = Math.floor(i / 4), c1 = i % 4, bar2 = Math.floor((i + 1) / 4), c2 = (i + 1) % 4;
    var y1 = (bar1 - scroll + ANCHOR) * rowH, y2 = (bar2 - scroll + ANCHOR) * rowH;
    var lift = rowH * 0.62 * 4 * f * (1 - f);
    var x = this.cx[c1].x + (this.cx[c2].x - this.cx[c1].x) * f;
    var yb = y1 + (y2 - y1) * f + rowH * 0.16 - lift;
    if (this.total != null && bar1 > this.total) { x = this.cx[3].x; yb = y1 + rowH * 0.16; }
    var sq = f < 0.08 ? 1 - (0.08 - f) * 3 : (f > 0.94 ? 1 - (f - 0.94) * 3 : 1);
    this.ball.style.transform = "translate(" + x.toFixed(1) + "px," + yb.toFixed(1) + "px) translate(-50%,-50%) scale(" + (2 - sq).toFixed(3) + "," + sq.toFixed(3) + ")";
    this.shadow.style.transform = "translate(" + x.toFixed(1) + "px," + (y1 + (y2 - y1) * f + rowH * 0.2).toFixed(1) + "px) translate(-50%,-50%) scale(" + (1 - lift / rowH * 0.9).toFixed(3) + ")";

    // hit flash on each new beat
    if (gb >= 0 && i !== this.lastBeat) {
      this.lastBeat = i;
      var r = this.rows[bar1];
      if (r) {
        var cell = r.children[1].children[c1];
        cell.classList.remove("hit"); void cell.offsetWidth; cell.classList.add("hit");
      }
    }
  };
  QB.Grid = Grid;

  /* ---------- game controller ---------- */
  function Game(ui) {
    this.ui = ui;
    this.grid = new Grid(ui.grid);
    this.transport = null;
    this.running = false;
    var self = this;
    this.loop = function () { self.frame(); };
    window.addEventListener("resize", function () { self.grid.measure(); });
  }

  /* cfg: mode, source{kind,...}, bars, scheme, fill, list, clean, speed, switchEvery, lagMs */
  Game.prototype.start = function (cfg, reuseGen) {
    this.stop(true);
    this.cfg = cfg;
    this.speed = cfg.speed || 1;
    this.gen = reuseGen || new WordGen(cfg);
    this.totalBars = cfg.mode === "classic" ? cfg.bars : null;
    this.grid.measure();
    this.grid.reset(this.gen, this.totalBars);

    var t = this.transport = new QB.Transport();
    var opts = { kind: cfg.source.kind };
    if (this.totalBars != null) opts.endBar = 1 + this.totalBars / this.speed;
    if (cfg.source.kind === "synth") {
      opts.beats = cfg.source.beats;
      opts.switchEvery = cfg.switchEvery || 16;
    } else if (cfg.source.kind === "buffer") {
      opts.buffer = cfg.source.buffer; opts.bpm = cfg.source.bpm; opts.offset = cfg.source.offset; opts.name = cfg.source.name;
      opts.gain = cfg.source.gain;           // loudness levelling
      opts.loopBars = cfg.source.loopBars;   // short loops repeat on the bar grid
    } else if (cfg.source.kind === "click") {
      opts.bpm = cfg.source.bpm; opts.audible = cfg.source.audible; opts.t0 = cfg.source.t0;
    }
    var self = this;
    t.onEnd = function () { self.finish(false); };
    t.start(opts);
    if (opts.endBar != null && t.endBar != null && t.endBar < opts.endBar) {
      // uploaded track shorter than requested length
      this.totalBars = Math.max(1, Math.floor((t.endBar - 1) * this.speed));
      this.grid.total = this.totalBars;
    }
    this.running = true;
    this.lastSeg = null;
    this.startedAt = t.timeOfBar(1);
    this.ui.onStart && this.ui.onStart(this);
    requestAnimationFrame(this.loop);
  };

  Game.prototype.musicToGrid = function (m) { return m < 4 ? m : 4 + (m - 4) * this.speed; };

  Game.prototype.now = function () {
    var A = QB.audio, ctx = A.ctx;
    if (this.cfg.source.kind === "click") return ctx.currentTime;
    return ctx.currentTime - A.latency() - (this.cfg.lagMs || 0) / 1000;
  };

  Game.prototype.frame = function () {
    if (!this.running) return;
    var t = this.transport, now = this.now();
    var mb = t.beatPos(now), gb = this.musicToGrid(mb);
    this.gridBeat = gb;
    this.grid.render(gb);
    var seg = t.segmentAt(now);
    if (seg !== this.lastSeg) { this.lastSeg = seg; this.ui.onSegment && this.ui.onSegment(seg, this); }
    this.ui.onFrame && this.ui.onFrame(gb, this);
    requestAnimationFrame(this.loop);
  };

  Game.prototype.barsDone = function () {
    var g = Math.floor((this.gridBeat || 0) / 4) - 1;
    if (this.totalBars != null) g = Math.min(g, this.totalBars);
    return Math.max(0, g);
  };

  Game.prototype.finish = function (early) {
    if (!this.running) return;
    var bars = early ? this.barsDone() : this.totalBars;
    var endT = QB.audio.ctx.currentTime;
    if (!early && this.transport && this.transport.endBar != null) endT = Math.min(endT, this.transport.timeOfBar(this.transport.endBar));
    var secs = Math.max(0, endT - this.startedAt);
    var words = [];
    for (var g = 1; g <= bars; g++) {
      var b = this.gen.bar(g);
      if (b.letter) words.push(b);
    }
    this.stop(false);
    this.ui.onFinish && this.ui.onFinish({ bars: bars, secs: secs, words: words, early: early, gen: this.gen, cfg: this.cfg });
  };

  Game.prototype.stop = function (silent) {
    this.running = false;
    if (this.transport) { this.transport.onEnd = null; this.transport.stop(silent ? 0.05 : 0.5); }
    this.transport = null;
  };

  QB.Game = Game;
})();
