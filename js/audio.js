/*
 * Audio engine: synthesized instruments, original beats, a lookahead
 * scheduler (Transport) and tempo detection for user-uploaded beats.
 * Everything is generated with the Web Audio API — no samples, no licensing.
 */
(function () {
  var QB = window.QB;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  var EPS = 0.0001;

  /* ---------- shared context + master chain ---------- */
  var A = QB.audio = {
    ctx: null,
    master: null,
    analyser: null,
    noiseBuf: null,
    impulse: null,
    crackleBuf: null,

    ensure: function () {
      if (!this.ctx) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        var ctx = this.ctx = new Ctx({ latencyHint: "interactive" });
        var master = this.master = ctx.createGain();
        master.gain.value = 0.9;
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 3.5;
        comp.attack.value = 0.004; comp.release.value = 0.18;
        // fast limiter catches drum transients the compressor is too slow for
        var lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
        lim.attack.value = 0.001; lim.release.value = 0.08;
        var an = this.analyser = ctx.createAnalyser();
        an.fftSize = 256; an.smoothingTimeConstant = 0.75;
        master.connect(comp); comp.connect(lim); lim.connect(an); an.connect(ctx.destination);
        this.noiseBuf = makeNoise(ctx, 1.5);
        this.impulse = makeImpulse(ctx, 2.2, 2.8);
        this.crackleBuf = makeCrackle(ctx, 4);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },

    /* seconds between "scheduled" and "actually heard" */
    latency: function () {
      var c = this.ctx;
      if (!c) return 0;
      return (c.outputLatency || 0) + (c.baseLatency || 0);
    }
  };

  function makeNoise(ctx, secs) {
    var len = Math.floor(ctx.sampleRate * secs);
    var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function makeImpulse(ctx, secs, decay) {
    var len = Math.floor(ctx.sampleRate * secs);
    var b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function makeCrackle(ctx, secs) {
    var len = Math.floor(ctx.sampleRate * secs);
    var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    var lp = 0;
    for (var i = 0; i < len; i++) {
      lp = lp * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = lp * 0.5;
      if (Math.random() < 0.00035) {
        var amp = (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1);
        for (var k = 0; k < 40 && i + k < len; k++) d[i + k] += amp * Math.exp(-k / 6);
      }
    }
    return b;
  }
  function shaperCurve(amount) {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = Math.tanh(x * amount); }
    return c;
  }

  /* ---------- Kit: one instance per playing session ---------- */
  function Kit(ctx, vol, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = vol == null ? 1 : vol;
    this.out.connect(dest || A.master);
    this.drums = ctx.createGain(); this.drums.gain.value = 0.95; this.drums.connect(this.out);
    this.music = ctx.createGain(); this.music.gain.value = 0.55; this.music.connect(this.out);
    this.verb = ctx.createConvolver(); this.verb.buffer = A.impulse;
    var vg = ctx.createGain(); vg.gain.value = 0.32; this.verb.connect(vg); vg.connect(this.out);
    this.drive = ctx.createWaveShaper(); this.drive.curve = shaperCurve(2.2);
    var dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 1800;
    this.drive.connect(dlp); dlp.connect(this.drums);
    // slow detune wobble for tape/lofi keys
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 0.45;
    this.lfoAmt = ctx.createGain(); this.lfoAmt.gain.value = 9;
    this.lfo.connect(this.lfoAmt); this.lfo.start();
    this.sources = [];
  }
  Kit.prototype.osc = function (type, f, t) {
    var o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o;
  };
  Kit.prototype.noise = function (t, dur) {
    var s = this.ctx.createBufferSource(); s.buffer = A.noiseBuf;
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); return s;
  };
  Kit.prototype.gain = function (dest) { var g = this.ctx.createGain(); g.connect(dest); return g; };
  Kit.prototype.filt = function (type, f, q) {
    var b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b;
  };
  function perc(g, t, peak, dec, att) {
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS * 2), t + (att || 0.002));
    g.gain.exponentialRampToValueAtTime(EPS, t + dec);
  }
  Kit.prototype.send = function (node, amt) {
    if (!amt) return; var s = this.ctx.createGain(); s.gain.value = amt; node.connect(s); s.connect(this.verb);
  };

  Kit.prototype.kick = function (t, v, o) {
    o = o || {}; v = v == null ? 1 : v;
    var dec = o.dec || 0.42;
    var os = this.osc("sine", o.f0 || 150, t);
    os.frequency.exponentialRampToValueAtTime(o.f1 || 46, t + (o.pd || 0.085));
    var g = this.gain(this.drums); perc(g, t, v, dec, 0.003);
    os.connect(g); os.start(t); os.stop(t + dec + 0.05);
    var n = this.noise(t, 0.02), hp = this.filt("highpass", 2500), ng = this.gain(this.drums);
    perc(ng, t, 0.18 * v, 0.018, 0.001); n.connect(hp); hp.connect(ng);
  };
  Kit.prototype.snare = function (t, v, o) {
    o = o || {}; v = v == null ? 1 : v;
    var dec = o.dec || 0.19;
    var n = this.noise(t, dec), hp = this.filt("highpass", o.hp || 1300), bp = this.filt("peaking", 4000, 1);
    bp.gain.value = 4;
    var g = this.gain(this.drums); perc(g, t, 0.7 * v, dec, 0.001);
    n.connect(hp); hp.connect(bp); bp.connect(g); this.send(g, o.verb == null ? 0.25 : o.verb);
    var tn = this.osc("triangle", 205, t); tn.frequency.exponentialRampToValueAtTime(165, t + 0.08);
    var tg = this.gain(this.drums); perc(tg, t, 0.4 * v, 0.1, 0.001); tn.connect(tg); tn.start(t); tn.stop(t + 0.12);
  };
  Kit.prototype.clap = function (t, v) {
    v = v == null ? 1 : v;
    var n = this.noise(t, 0.3), bp = this.filt("bandpass", 1350, 1.1), g = this.gain(this.drums);
    g.gain.setValueAtTime(EPS, t);
    for (var i = 0; i < 3; i++) {
      var ti = t + i * 0.011;
      g.gain.setValueAtTime(0.75 * v, ti);
      g.gain.exponentialRampToValueAtTime(0.06 * v, ti + 0.009);
    }
    g.gain.setValueAtTime(0.7 * v, t + 0.034);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.24);
    n.connect(bp); bp.connect(g); this.send(g, 0.35);
  };
  Kit.prototype.hat = function (t, v, open) {
    v = v == null ? 1 : v;
    var dec = open ? 0.26 : 0.042;
    var n = this.noise(t, dec), hp = this.filt("highpass", 7200), g = this.gain(this.drums);
    perc(g, t, 0.32 * v, dec, 0.001); n.connect(hp); hp.connect(g);
  };
  Kit.prototype.rim = function (t, v) {
    v = v == null ? 1 : v;
    var o = this.osc("triangle", 1750, t), g = this.gain(this.drums);
    perc(g, t, 0.45 * v, 0.035, 0.001); o.connect(g); o.start(t); o.stop(t + 0.05);
    var o2 = this.osc("sine", 820, t), g2 = this.gain(this.drums);
    perc(g2, t, 0.35 * v, 0.03, 0.001); o2.connect(g2); o2.start(t); o2.stop(t + 0.05);
  };
  Kit.prototype.crash = function (t, v) {
    v = v == null ? 1 : v;
    var n = this.noise(t, 1.4), hp = this.filt("highpass", 5200), g = this.gain(this.drums);
    perc(g, t, 0.22 * v, 1.4, 0.002); n.connect(hp); hp.connect(g); this.send(g, 0.3);
  };
  Kit.prototype.click = function (t, accent) {
    var o = this.osc("sine", accent ? 1600 : 1100, t), g = this.gain(this.out);
    perc(g, t, accent ? 0.5 : 0.3, 0.04, 0.001); o.connect(g); o.start(t); o.stop(t + 0.06);
  };
  /* 808 sub with optional glide */
  Kit.prototype.sub = function (t, note, dur, v, glideTo, glideAt) {
    v = v == null ? 1 : v;
    var f = mtof(note), o = this.osc("sine", f, t);
    if (glideTo != null) {
      var ga = t + (glideAt || dur * 0.6);
      o.frequency.setValueAtTime(f, ga);
      o.frequency.exponentialRampToValueAtTime(mtof(glideTo), ga + 0.09);
    }
    var g = this.ctx.createGain(); g.connect(this.drive);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.006);
    g.gain.setValueAtTime(0.9 * v, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.05);
    o.connect(g); o.start(t); o.stop(t + dur + 0.1);
  };
  Kit.prototype.bass = function (t, note, dur, v) {
    v = v == null ? 1 : v;
    var f = mtof(note), o = this.osc("triangle", f, t), o2 = this.osc("sine", f, t);
    var lp = this.filt("lowpass", 520), g = this.gain(this.music);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.45 * v, t + 0.18);
    g.gain.setValueAtTime(0.45 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.08);
    o.connect(lp); o2.connect(lp); lp.connect(g);
    o.start(t); o2.start(t); o.stop(t + dur + 0.12); o2.stop(t + dur + 0.12);
  };
  /* Keys: ep (lofi electric piano), piano, pad, bell (FM), santur (pluck), zang */
  Kit.prototype.keys = function (kind, t, notes, dur, v) {
    v = v == null ? 1 : v;
    var self = this, per = v / Math.sqrt(notes.length);
    notes.forEach(function (n, i) { self[kind](t + (i * (kind === "piano" ? 0.008 : 0)), n, dur, per); });
  };
  Kit.prototype.ep = function (t, note, dur, v) {
    var f = mtof(note), lp = this.filt("lowpass", 1900), g = this.gain(this.music);
    var a = this.osc("sine", f, t), b = this.osc("sine", f * 2, t), bg = this.ctx.createGain();
    this.lfoAmt.connect(a.detune); this.lfoAmt.connect(b.detune);
    bg.gain.setValueAtTime(0.35, t); bg.gain.exponentialRampToValueAtTime(0.02, t + 0.25);
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.28 * v, t + 0.5);
    g.gain.setValueAtTime(0.28 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.35);
    this.send(g, 0.25);
    a.start(t); b.start(t); a.stop(t + dur + 0.4); b.stop(t + dur + 0.4);
  };
  Kit.prototype.piano = function (t, note, dur, v) {
    var f = mtof(note), lp = this.filt("lowpass", 2600), g = this.gain(this.music);
    var a = this.osc("triangle", f, t), b = this.osc("sine", f * 2, t), c = this.osc("sine", f * 3.01, t);
    var bg = this.ctx.createGain(); bg.gain.value = 0.25; var cg = this.ctx.createGain(); cg.gain.value = 0.08;
    a.connect(lp); b.connect(bg); bg.connect(lp); c.connect(cg); cg.connect(lp); lp.connect(g);
    var end = t + Math.max(dur, 0.2) + 0.9;
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.6);
    g.gain.setValueAtTime(0.2 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.25);
    this.send(g, 0.2);
    [a, b, c].forEach(function (o) { o.start(t); o.stop(end); });
  };
  Kit.prototype.pad = function (t, note, dur, v) {
    var f = mtof(note), lp = this.filt("lowpass", 950, 0.7), g = this.gain(this.music);
    var a = this.osc("sawtooth", f, t), b = this.osc("sawtooth", f, t);
    a.detune.value = -9; b.detune.value = 9;
    a.connect(lp); b.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.35);
    g.gain.setValueAtTime(0.22 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.6);
    this.send(g, 0.4);
    a.start(t); b.start(t); a.stop(t + dur + 0.7); b.stop(t + dur + 0.7);
  };
  Kit.prototype.bell = function (t, note, dur, v, ratio, decay) {
    var f = mtof(note), car = this.osc("sine", f, t), mod = this.osc("sine", f * (ratio || 3.5), t);
    var mg = this.ctx.createGain(), g = this.gain(this.music);
    decay = decay || 1.3;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay * 0.6);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g);
    perc(g, t, 0.45 * v, decay, 0.002); this.send(g, 0.35);
    car.start(t); mod.start(t); car.stop(t + decay + 0.05); mod.stop(t + decay + 0.05);
  };
  Kit.prototype.zang = function (t, note, dur, v) { this.bell(t, note, dur, v * 0.9, 1.41, 2.6); };
  /* Santur-ish hammered string: bright pluck, two slightly detuned strings, optional tremolo */
  Kit.prototype.santur = function (t, note, dur, v, trem) {
    var self = this;
    var hits = trem ? Math.max(2, Math.floor(dur / 0.07)) : 1;
    for (var h = 0; h < hits; h++) {
      (function (th, vv) {
        var f = mtof(note), hp = self.filt("highpass", 280), lp = self.filt("lowpass", 5200), g = self.gain(self.music);
        var a = self.osc("triangle", f, th), b = self.osc("sawtooth", f, th), c = self.osc("sine", f * 2, th);
        b.detune.value = 6;
        var bg = self.ctx.createGain(); bg.gain.value = 0.22; var cg = self.ctx.createGain(); cg.gain.value = 0.3;
        a.connect(hp); b.connect(bg); bg.connect(hp); c.connect(cg); cg.connect(hp); hp.connect(lp); lp.connect(g);
        perc(g, th, 0.5 * vv, 0.55, 0.001); self.send(g, 0.4);
        [a, b, c].forEach(function (o) { o.start(th); o.stop(th + 0.6); });
      })(t + h * 0.07, v * (h === 0 ? 1 : 0.55));
    }
  };
  Kit.prototype.dum = function (t, v) {
    v = v == null ? 1 : v;
    var o = this.osc("sine", 125, t); o.frequency.exponentialRampToValueAtTime(72, t + 0.12);
    var g = this.gain(this.drums); perc(g, t, 0.95 * v, 0.5, 0.002); o.connect(g); o.start(t); o.stop(t + 0.55);
    var n = this.noise(t, 0.05), lp = this.filt("lowpass", 700), ng = this.gain(this.drums);
    perc(ng, t, 0.3 * v, 0.05, 0.001); n.connect(lp); lp.connect(ng); this.send(g, 0.15);
  };
  Kit.prototype.tak = function (t, v) {
    v = v == null ? 1 : v;
    var o = this.osc("sine", 540, t); o.frequency.exponentialRampToValueAtTime(470, t + 0.05);
    var g = this.gain(this.drums); perc(g, t, 0.4 * v, 0.08, 0.001); o.connect(g); o.start(t); o.stop(t + 0.1);
    var n = this.noise(t, 0.04), bp = this.filt("bandpass", 3400, 1.4), ng = this.gain(this.drums);
    perc(ng, t, 0.35 * v, 0.04, 0.001); n.connect(bp); bp.connect(ng); this.send(ng, 0.2);
  };
  Kit.prototype.vinyl = function (t, on) {
    if (!on) return;
    var s = this.ctx.createBufferSource(); s.buffer = A.crackleBuf; s.loop = true;
    var g = this.gain(this.out); g.gain.value = 0.22; s.connect(g); s.start(t);
    this.sources.push(s);
  };
  /* Horn/brass stab: detuned saws with a fast filter "blat" — golden-era sample feel */
  Kit.prototype.brass = function (t, notes, dur, v) {
    v = v == null ? 1 : v;
    var self = this, per = v / Math.sqrt(notes.length);
    notes.forEach(function (n) {
      var f = mtof(n), lp = self.filt("lowpass", 700, 2), g = self.gain(self.music);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.exponentialRampToValueAtTime(3200, t + 0.03);
      lp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.8 + 0.05);
      [-7, 7].forEach(function (dt) {
        var o = self.osc("sawtooth", f, t); o.detune.value = dt; o.connect(lp); o.start(t); o.stop(t + dur + 0.2);
      });
      lp.connect(g);
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(0.3 * per, t + 0.012);
      g.gain.setValueAtTime(0.26 * per, t + dur);
      g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.12);
      self.send(g, 0.25);
    });
  };
  /* DJ scratch: pitched saw + noise through a sweeping band-pass (forward/back stroke) */
  Kit.prototype.scratch = function (t, dur, v) {
    v = v == null ? 1 : v;
    var o = this.osc("sawtooth", 180, t), n = this.noise(t, dur), bp = this.filt("bandpass", 900, 3), g = this.gain(this.drums);
    o.frequency.exponentialRampToValueAtTime(900, t + dur * 0.45);
    o.frequency.exponentialRampToValueAtTime(220, t + dur);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(800, t + dur);
    var og = this.ctx.createGain(); og.gain.value = 0.5;
    o.connect(og); og.connect(bp); n.connect(bp); bp.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.01);
    g.gain.setValueAtTime(0.55 * v, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  };
  /* 808 cowbell */
  Kit.prototype.cowbell = function (t, v) {
    v = v == null ? 1 : v;
    var bp = this.filt("bandpass", 2640, 1.2), g = this.gain(this.drums), self = this;
    [587, 845].forEach(function (f) { var o = self.osc("square", f, t); o.connect(bp); o.start(t); o.stop(t + 0.4); });
    bp.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.3 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.08 * v, t + 0.06);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.35);
  };
  /* G-funk whistle lead: sine+triangle, portamento from `from`, delayed vibrato */
  Kit.prototype.lead = function (t, note, dur, v, from) {
    v = v == null ? 1 : v;
    var f = mtof(note), f0 = from != null ? mtof(from) : f;
    var o = this.osc("sine", f0, t), o2 = this.osc("triangle", f0, t);
    if (from != null) { o.frequency.exponentialRampToValueAtTime(f, t + 0.12); o2.frequency.exponentialRampToValueAtTime(f, t + 0.12); }
    var vib = this.ctx.createOscillator(); vib.frequency.value = 5.5;
    var vg = this.ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(18, t + 0.25);
    vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    var lp = this.filt("lowpass", 2800), g = this.gain(this.music), g2 = this.ctx.createGain(); g2.gain.value = 0.35;
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.34 * v, t + 0.04);
    g.gain.setValueAtTime(0.3 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.15);
    this.send(g, 0.35);
    [o, o2, vib].forEach(function (x) { x.start(t); x.stop(t + dur + 0.2); });
  };
  /* Supersaw stab (rage / hard trap) */
  Kit.prototype.saw = function (t, notes, dur, v) {
    v = v == null ? 1 : v;
    var self = this, per = v / Math.sqrt(notes.length);
    var lp = this.filt("lowpass", 3800, 0.8), g = this.gain(this.music); lp.connect(g);
    notes.forEach(function (n) {
      var f = mtof(n);
      [-18, -7, 0, 7, 18].forEach(function (dt) {
        var o = self.osc("sawtooth", f, t); o.detune.value = dt; o.connect(lp); o.start(t); o.stop(t + dur + 0.15);
      });
    });
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.12 * per, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.06 * per, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.1);
    this.send(g, 0.3);
  };

  /* ---------- beatbox kit: sounds a human makes with lips, tongue and throat ---------- */
  /* "b" lip kick: a tight plosive pop + short chest thump (shorter and drier than a drum kick) */
  Kit.prototype.bbKick = function (t, v) {
    v = v == null ? 1 : v;
    var o = this.osc("sine", 105, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    var g = this.gain(this.drums); perc(g, t, 1.0 * v, 0.17, 0.004);
    o.connect(g); o.start(t); o.stop(t + 0.2);
    var n = this.noise(t, 0.04), lp = this.filt("lowpass", 900, 0.8), ng = this.gain(this.drums);   // the lip "puh"
    perc(ng, t, 0.55 * v, 0.035, 0.002); n.connect(lp); lp.connect(ng);
  };
  /* "pf" snare: a burst of air through the lips */
  Kit.prototype.bbSnare = function (t, v) {
    v = v == null ? 1 : v;
    var n = this.noise(t, 0.2), bp = this.filt("bandpass", 2300, 0.9), hp = this.filt("highpass", 900), g = this.gain(this.drums);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.85 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.25 * v, t + 0.04);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.16);
    n.connect(hp); hp.connect(bp); bp.connect(g); this.send(g, 0.12);
    var o = this.osc("triangle", 330, t), og = this.gain(this.drums);   // the "p" of "pf"
    perc(og, t, 0.25 * v, 0.03, 0.001); o.connect(og); o.start(t); o.stop(t + 0.05);
  };
  /* inward "kh" snare: sucked in, so it swells instead of snapping */
  Kit.prototype.bbInward = function (t, v) {
    v = v == null ? 1 : v;
    var n = this.noise(t, 0.2), bp = this.filt("bandpass", 3200, 1.6), g = this.gain(this.drums);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.025);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.13);
    n.connect(bp); bp.connect(g);
  };
  /* "ts" hi-hat (open = "tsss") */
  Kit.prototype.bbHat = function (t, v, open) {
    v = v == null ? 1 : v;
    var dec = open ? 0.22 : 0.05;
    var n = this.noise(t, dec), hp = this.filt("highpass", 5200), pk = this.filt("peaking", 7500, 1.2), g = this.gain(this.drums);
    pk.gain.value = 6;
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(EPS, t + dec);
    n.connect(hp); hp.connect(pk); pk.connect(g);
  };
  /* tongue click "k" */
  Kit.prototype.bbClick = function (t, v) {
    v = v == null ? 1 : v;
    var o = this.osc("sine", 1900, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.015);
    var g = this.gain(this.drums); perc(g, t, 0.4 * v, 0.025, 0.001); o.connect(g); o.start(t); o.stop(t + 0.04);
  };
  /* hummed lip bass: a buzzy hum with a throat-like formant and a little wobble */
  Kit.prototype.bbBass = function (t, note, dur, v) {
    v = v == null ? 1 : v;
    var f = mtof(note), o = this.osc("sawtooth", f, t), o2 = this.osc("sine", f, t);
    var vib = this.ctx.createOscillator(); vib.frequency.value = 5; var vg = this.ctx.createGain(); vg.gain.value = 12;
    vib.connect(vg); vg.connect(o.detune); vg.connect(o2.detune);
    var lp = this.filt("lowpass", 520, 1.5), form = this.filt("peaking", 280, 2), g = this.gain(this.music);
    form.gain.value = 5;
    var sg = this.ctx.createGain(); sg.gain.value = 0.35;
    o.connect(sg); sg.connect(lp); o2.connect(lp); lp.connect(form); form.connect(g);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.03);
    g.gain.setValueAtTime(0.6 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.06);
    [o, o2, vib].forEach(function (x) { x.start(t); x.stop(t + dur + 0.1); });
  };
  /* drawbar organ stab with a little rotary-speaker shimmer (funk / breakbeat) */
  Kit.prototype.organ = function (t, notes, dur, v) {
    v = v == null ? 1 : v;
    var self = this, per = v / Math.sqrt(notes.length), g = this.gain(this.music);
    var trem = this.ctx.createOscillator(); trem.frequency.value = 6.2; var tg = this.ctx.createGain(); tg.gain.value = 0.06;
    trem.connect(tg); tg.connect(g.gain);
    notes.forEach(function (n) {
      var f = mtof(n);
      [[1, 0.5], [2, 0.35], [3, 0.22], [4, 0.12]].forEach(function (h) {
        var o = self.osc("sine", f * h[0], t), hg = self.ctx.createGain(); hg.gain.value = h[1] * per * 0.35;
        o.connect(hg); hg.connect(g); o.start(t); o.stop(t + dur + 0.08);
      });
    });
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.008);
    g.gain.setValueAtTime(1, t + dur);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.06);
    trem.start(t); trem.stop(t + dur + 0.1);
    this.send(g, 0.18);
  };

  Kit.prototype.dispose = function (fade) {
    var ctx = this.ctx, now = ctx.currentTime, out = this.out, self = this;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + (fade || 0.08));
    setTimeout(function () {
      self.sources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      try { self.lfo.stop(); } catch (e) {}
      try { out.disconnect(); } catch (e) {}
    }, ((fade || 0.08) + 0.15) * 1000);
  };

  /* ---------- pattern helpers ---------- */
  function P(str) { return str.replace(/[\s|]/g, ""); }
  function at(pat, bar, step) {
    var bars = pat.length / 16;
    return pat.charAt((bar % bars) * 16 + step);
  }
  /* hat char: x hit, o open, g ghost, r = 2 hits in step, q = 3, Q = 4 */
  function hatChar(kit, c, t, sd, v) {
    v = v == null ? 1 : v;
    if (c === "x") kit.hat(t, v);
    else if (c === "g") kit.hat(t, v * 0.45);
    else if (c === "o") kit.hat(t, v, true);
    else if (c === "r" || c === "q" || c === "Q") {
      var n = c === "r" ? 2 : c === "q" ? 3 : 4;
      for (var i = 0; i < n; i++) kit.hat(t + i * sd / n, v * (0.6 + 0.4 * (i / n)));
    }
  }
  /* melodic events: list of [bar, step, note|notes, lenSteps, vel] in a loop of loopBars */
  function evAt(list, loopBars, bar, step) {
    var b = bar % loopBars, out = [];
    for (var i = 0; i < list.length; i++) if (list[i][0] === b && list[i][1] === step) out.push(list[i]);
    return out;
  }

  /* ---------- the beats ---------- */
  var BEATS = [];

  /* 1 — Boom bap, dusty piano, swing */
  (function () {
    var kick = P("x.......x.x..... x......x..x...x.");
    var snr  = P("....x.......x... ....x.......x..g");
    var hat  = P("x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.o.");
    var ch = [[57, 60, 64, 67], [57, 60, 62, 65], [53, 57, 60, 64], [56, 59, 62, 64]];
    var roots = [45, 38, 41, 40];
    BEATS.push({
      id: "boombap", family: "boombap", name: "خاکی", genre: "بوم‌بپ", vibe: "کلاسیک، تکیه‌دار، دهه‌ی هفتاد", bpm: 88, swing: 0.14, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        var c = at(kick, bar, s); if (c === "x") { k.kick(t, 1); k.bass(t, roots[bar % 4], sd * 2.6, 0.9); }
        c = at(snr, bar, s); if (c === "x") k.snare(t, 1); else if (c === "g") k.snare(t, 0.25, { verb: 0 });
        hatChar(k, at(hat, bar, s), t, sd, s % 4 === 0 ? 0.9 : 0.6);
      },
      music: function (k, bar, s, t, sd) {
        var c = ch[bar % 4];
        if (s === 0) k.keys("piano", t, c, sd * 5, 0.75);
        if (s === 10) k.keys("piano", t, c, sd * 1.5, 0.45);
      }
    });
  })();

  /* 2 — Lo-fi night, jazzy EP chords, crackle */
  (function () {
    var kick = P("x......x..x..... x.........x.....");
    var snr  = P("....x.......x... ....x.......x...");
    var hat  = P("x.gxx.g.x.gxx.g. x.gxx.g.x.gxx.gx");
    var ch = [[53, 57, 60, 64, 67], [52, 55, 59, 62], [50, 53, 57, 60, 64], [48, 52, 55, 59, 62]];
    var roots = [41, 40, 38, 36];
    BEATS.push({
      id: "lofi", family: "other", name: "شب‌های تهران", genre: "لوفای", vibe: "آروم، شبونه، پشت پنجره", bpm: 76, swing: 0.2, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 0.85, { f0: 120, dec: 0.35 });
        if (at(snr, bar, s) === "x") k.snare(t, 0.55, { hp: 1800, dec: 0.14, verb: 0.35 });
        hatChar(k, at(hat, bar, s), t, sd, 0.45);
      },
      music: function (k, bar, s, t, sd) {
        if (s === 0) { k.keys("ep", t, ch[bar % 4], sd * 14, 0.8); k.bass(t, roots[bar % 4], sd * 6, 0.7); }
        if (s === 10) k.bass(t, roots[bar % 4] + 7, sd * 3, 0.5);
      }
    });
  })();

  /* 3 — Trap, 808 + FM bell, hat rolls (half-time feel) */
  (function () {
    var hat = P("x.x.x.x.x.xrx.x. x.x.x.xqx.x.rrQQ");
    var clp = P("....x.......x... ....x.......x...");
    var b808 = [[0, 0, 36, 6], [0, 7, 36, 3], [0, 10, 39, 5], [1, 0, 36, 6], [1, 8, 43, 2], [1, 11, 41, 5]];
    var mel = [[0, 0, 79], [0, 3, 75], [0, 6, 72], [0, 8, 74], [0, 10, 75], [0, 12, 72],
               [1, 0, 79], [1, 3, 77], [1, 6, 75], [1, 8, 74], [1, 11, 70], [1, 14, 72]];
    BEATS.push({
      id: "trap", family: "trap", name: "دودِ شب", genre: "ترپ", vibe: "تاریک، ۸۰۸ سنگین، های‌هت تند", bpm: 70, swing: 0,
      drums: function (k, bar, s, t, sd) {
        evAt(b808, 2, bar, s).forEach(function (e) { k.kick(t, 0.8, { dec: 0.25 }); k.sub(t, e[2], sd * e[3], 1); });
        if (at(clp, bar, s) === "x") k.clap(t, 1);
        hatChar(k, at(hat, bar, s), t, sd, 0.7);
      },
      music: function (k, bar, s, t, sd) {
        evAt(mel, 2, bar, s).forEach(function (e) { k.bell(t, e[2], sd * 2, 0.55); });
        if (s === 0 && bar % 2 === 0) k.keys("pad", t, [48, 51, 55], sd * 30, 0.6);
      }
    });
  })();

  /* 4 — Drill, sliding 808s, triplet-feel hats, eerie pad */
  (function () {
    var hat = P("x..x..x..x..x.x. x..x..x..x.qx.x.");
    var snr = P("....x.......x... ....x......x..x.");
    var b808 = [[0, 0, 38, 5, 43], [0, 6, 43, 4], [0, 10, 41, 6, 36], [1, 0, 38, 4], [1, 3, 38, 3, 45], [1, 8, 41, 4], [1, 12, 36, 4, 38]];
    var ch = [[62, 65, 69], [63, 67, 70], [62, 65, 69], [60, 63, 67]];
    BEATS.push({
      id: "drill", family: "trap", name: "سرد", genre: "دریل", vibe: "سرد، تهاجمی، ۸۰۸ سُر‌خور", bpm: 71, swing: 0,
      drums: function (k, bar, s, t, sd) {
        evAt(b808, 2, bar, s).forEach(function (e) {
          k.kick(t, 0.75, { dec: 0.2 });
          k.sub(t, e[2], sd * e[3], 1, e[4], e[4] != null ? sd * (e[3] - 1.2) : null);
        });
        if (at(snr, bar, s) === "x") k.snare(t, 0.9, { hp: 1600 });
        hatChar(k, at(hat, bar, s), t, sd, 0.6);
      },
      music: function (k, bar, s, t, sd) {
        if (s === 0) k.keys("pad", t, ch[bar % 4], sd * 15, 0.9);
        if (s === 0 || s === 6 || s === 12) k.bell(t, ch[bar % 4][2] + 12, sd, 0.25, 2.01, 0.5);
      }
    });
  })();

  /* 5 — Santur trap in Dastgah-e Shur on D (E-koron = quarter-tone flat) */
  (function () {
    var Ek = 63.5;
    var riff = [
      [0, 0, 74], [0, 1, 72], [0, 2, 70], [0, 3, 69], [0, 4, 70], [0, 6, 69, 1], [0, 7, 67],
      [0, 8, 65], [0, 10, Ek], [0, 11, 62], [0, 12, Ek], [0, 14, 65, 1],
      [1, 0, 69], [1, 2, 67], [1, 3, 65], [1, 4, Ek], [1, 6, 62, 1],
      [1, 8, 65], [1, 9, Ek], [1, 10, 62], [1, 12, 57], [1, 14, 62, 1]
    ];
    var kick = P("x.....x...x..... x.......x...x...");
    var b808 = [[0, 0, 38, 6], [0, 6, 38, 3], [0, 10, 36, 5], [1, 0, 34, 7], [1, 8, 36, 4], [1, 12, 38, 4]];
    var hat = P("x.x.x.x.x.x.x.xr x.x.x.x.x.x.xrx.");
    var tk  = P("...x.......x.... ...x.......x..x.");
    BEATS.push({
      id: "santur", family: "persian", name: "شور", genre: "ترپ ایرانی", vibe: "سنتور در دستگاه شور، ربع‌پرده‌ی واقعی", bpm: 74, swing: 0.06,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 0.8, { dec: 0.3 });
        evAt(b808, 2, bar, s).forEach(function (e) { k.sub(t, e[2], sd * e[3], 0.95); });
        if (s === 4 || s === 12) k.clap(t, 0.9);
        hatChar(k, at(hat, bar, s), t, sd, 0.5);
        if (at(tk, bar, s) === "x") k.tak(t, 0.5);
      },
      music: function (k, bar, s, t, sd) {
        evAt(riff, 2, bar, s).forEach(function (e) { k.santur(t, e[2], sd * (e[3] ? 2 : 1), 0.7, !!e[3]); });
      }
    });
  })();

  /* 6 — Zurkhaneh: zarb dum/tak, zang bell, drone */
  (function () {
    var dum = P("x.....x.x...x... x.....x.x..x.x..");
    var tak = P("..x.x.....x...xx ..x.x.....x.....");
    var hat = P("..x...x...x...x. ..x...x...x...xx");
    BEATS.push({
      id: "zurkhaneh", family: "persian", name: "زورخونه", genre: "ضربی", vibe: "ضرب و زنگ، پهلوونی، سنگین", bpm: 84, swing: 0.05,
      drums: function (k, bar, s, t, sd) {
        if (at(dum, bar, s) === "x") { k.dum(t, 1); if (s === 0) k.kick(t, 0.7); }
        if (at(tak, bar, s) === "x") k.tak(t, 0.85);
        if (s === 4 || s === 12) k.snare(t, 0.8, { hp: 900, dec: 0.22 });
        hatChar(k, at(hat, bar, s), t, sd, 0.4);
      },
      music: function (k, bar, s, t, sd) {
        if (s === 0 && bar % 2 === 0) { k.zang(t, 74, 2, 0.6); k.keys("pad", t, [38, 45, 50], sd * 30, 0.8); }
        if (s === 0 && bar % 2 === 1) k.zang(t, 69, 1, 0.35);
      }
    });
  })();

  /* 7 — Golden-era boom bap: horn stabs, dry hard drums, scratch fill */
  (function () {
    var kick = P("x......xx.x..... x.x.....x.x..x.. x......xx.x..... x.x.....x...x.x.");
    var snr  = P("....x..g....x... ....x.......x.g. ....x..g....x... ....x.......xgxg");
    var hat  = P("x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.o. x.x.x.x.x.x.x.x. x.x.x.x.x.x.o...");
    var stabs = [[0, 0, [62, 65, 69], 2], [0, 3, [62, 65, 69], 2], [0, 10, [60, 64, 67], 3],
                 [1, 0, [58, 62, 65], 2], [1, 6, [57, 61, 64], 5],
                 [2, 0, [62, 65, 69], 2], [2, 3, [62, 65, 69], 2], [2, 10, [60, 64, 67], 3],
                 [3, 0, [55, 58, 62], 3], [3, 8, [57, 61, 64], 4]];
    var roots = [38, 34, 38, 43];
    BEATS.push({
      id: "golden", family: "boombap", name: "طلایی", genre: "بوم‌بپ دهه‌ی نود", vibe: "ترومپت، اسکرچ، درام خشک و کوبنده", bpm: 94, swing: 0.1, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") { k.kick(t, 1, { f0: 160, dec: 0.38 }); k.bass(t, roots[bar % 4], sd * 1.8, 0.85); }
        var c = at(snr, bar, s); if (c === "x") k.snare(t, 1.05, { hp: 1500, dec: 0.17 }); else if (c === "g") k.snare(t, 0.22, { verb: 0 });
        hatChar(k, at(hat, bar, s), t, sd, s % 4 === 0 ? 0.85 : 0.55);
        if (bar % 4 === 3 && (s === 12 || s === 14)) k.scratch(t, sd * 1.6, 0.8);
      },
      music: function (k, bar, s, t, sd) {
        evAt(stabs, 4, bar, s).forEach(function (e) { k.brass(t, e[2], sd * e[3], 0.8); });
      }
    });
  })();

  /* 8 — Jazzy boom bap: walking bass, piano comps, busy kick */
  (function () {
    var kick = P("x..x......x..x.. x.....x...x....x");
    var snr  = P("....x.......x... ....x.......x...");
    var rim  = P(".......x.......x .......x....x..x");
    var hat  = P("x.xgx.xgx.xgx.xo x.xgx.xgx.xgx.xg");
    var ch = [[51, 55, 58, 62], [53, 56, 60, 63], [56, 60, 63, 67], [55, 59, 62, 65]];
    var walk = [[36, 39, 43, 41], [41, 44, 48, 46], [44, 48, 51, 50], [43, 47, 50, 49]];
    BEATS.push({
      id: "kooche", family: "boombap", name: "کوچه", genre: "بوم‌بپ جَزی", vibe: "باس قدم‌زن، پیانوی جز، ریتمیک", bpm: 92, swing: 0.16, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 0.95, { f0: 140 });
        if (at(snr, bar, s) === "x") k.snare(t, 0.95);
        if (at(rim, bar, s) === "x") k.rim(t, 0.4);
        hatChar(k, at(hat, bar, s), t, sd, 0.55);
      },
      music: function (k, bar, s, t, sd) {
        if (s % 4 === 0) k.bass(t, walk[bar % 4][s / 4], sd * 3.2, 0.9);
        if (s === 0 || s === 7 || s === 10) k.keys("piano", t, ch[bar % 4], sd * (s === 0 ? 3 : 1.2), s === 0 ? 0.7 : 0.45);
      }
    });
  })();

  /* 9 — Hard east-coast boom bap: dark piano riff, whip snare, scratches */
  (function () {
    var kick = P("x.......x.x..... x.x.....x.....x.");
    var hat  = P("xgxgxgxgxgxgxgxg xgxgxgxgxgxgxgog");
    var riff = [[0, 0, 64], [0, 3, 67], [0, 6, 71], [0, 8, 70], [0, 10, 67], [0, 12, 66],
                [1, 0, 64], [1, 3, 67], [1, 6, 72], [1, 8, 71], [1, 11, 67], [1, 14, 62]];
    BEATS.push({
      id: "bomb", family: "boombap", name: "بمب", genre: "بوم‌بپ سنگین", vibe: "پیانوی تاریک، اسنیر شلاقی، اسکرچ", bpm: 98, swing: 0.06, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") { k.kick(t, 1.05, { f0: 170, f1: 42, dec: 0.45 }); k.sub(t, 40, sd * 2, 0.6); }
        if (s === 4 || s === 12) { k.snare(t, 1.1, { hp: 1900, dec: 0.16, verb: 0.3 }); k.clap(t, 0.5); }
        hatChar(k, at(hat, bar, s), t, sd, s % 2 === 0 ? 0.6 : 0.3);
        if (bar % 4 === 3 && s >= 12 && s < 15) k.scratch(t, sd * 0.9, 0.7);
      },
      music: function (k, bar, s, t, sd) {
        evAt(riff, 2, bar, s).forEach(function (e) { k.piano(t, e[2], sd * 1.5, 0.55); k.piano(t, e[2] - 12, sd * 1.5, 0.35); });
        if (s === 0 && bar % 2 === 0) k.brass(t, [52, 55, 59], sd * 6, 0.45);
      }
    });
  })();

  /* 10 — Fast trap: punchy 808 pattern, machine-gun hats, bright bell arp */
  (function () {
    var hat = P("x.x.x.x.xrx.x.x. x.x.xqx.x.x.QQrr");
    var b808 = [[0, 0, 37, 3], [0, 3, 37, 2], [0, 6, 37, 3], [0, 10, 40, 4], [0, 14, 42, 2],
                [1, 0, 37, 3], [1, 3, 37, 2], [1, 7, 44, 3], [1, 10, 42, 3], [1, 13, 40, 3]];
    var mel = [[0, 0, 73], [0, 2, 76], [0, 4, 80], [0, 6, 76], [0, 8, 73], [0, 10, 76], [0, 12, 81], [0, 14, 80],
               [1, 0, 73], [1, 2, 76], [1, 4, 80], [1, 6, 83], [1, 8, 81], [1, 10, 80], [1, 12, 76], [1, 14, 75]];
    BEATS.push({
      id: "atish", family: "trap", name: "آتیش", genre: "ترپ تند", vibe: "۸۰۸ کوبنده، های‌هت رگباری، ملودی تیز", bpm: 78, swing: 0,
      drums: function (k, bar, s, t, sd) {
        evAt(b808, 2, bar, s).forEach(function (e) { k.kick(t, 0.9, { f0: 180, dec: 0.22 }); k.sub(t, e[2], sd * e[3], 1); });
        if (s === 4 || s === 12) { k.clap(t, 1); k.snare(t, 0.6, { hp: 1800, dec: 0.14 }); }
        hatChar(k, at(hat, bar, s), t, sd, 0.7);
        if (s === 14 && bar % 2 === 0) k.hat(t, 0.6, true);
      },
      music: function (k, bar, s, t, sd) {
        evAt(mel, 2, bar, s).forEach(function (e) { k.bell(t, e[2], sd, 0.4, 3.01, 0.6); });
        if (s === 0 && bar % 4 === 0) k.keys("pad", t, [49, 52, 56], sd * 60, 0.5);
      }
    });
  })();

  /* 11 — Rage trap: supersaw stabs, distorted 808 */
  (function () {
    var hat = P("x.x.x.x.x.x.x.x. x.x.x.x.x.x.xrQQ");
    var b808 = [[0, 0, 36, 6], [0, 8, 36, 2], [0, 11, 43, 4], [1, 0, 36, 4], [1, 6, 39, 3], [1, 10, 41, 6]];
    var st = [[0, 0, [60, 63, 67], 2], [0, 3, [60, 63, 67], 2], [0, 6, [60, 63, 67], 1], [0, 10, [56, 60, 63], 3],
              [1, 0, [55, 58, 63], 2], [1, 3, [55, 58, 63], 2], [1, 8, [58, 62, 65], 4]];
    BEATS.push({
      id: "khashm", family: "trap", name: "خشم", genre: "ترپ ریج", vibe: "سوپرسا، ۸۰۸ دیستورت، پرانرژی", bpm: 80, swing: 0,
      drums: function (k, bar, s, t, sd) {
        evAt(b808, 2, bar, s).forEach(function (e) { k.kick(t, 1, { f0: 190, f1: 50, dec: 0.2 }); k.sub(t, e[2], sd * e[3], 1.1); });
        if (s === 4 || s === 12) { k.clap(t, 1); k.snare(t, 0.8, { hp: 1500 }); }
        hatChar(k, at(hat, bar, s), t, sd, 0.65);
      },
      music: function (k, bar, s, t, sd) {
        evAt(st, 2, bar, s).forEach(function (e) { k.saw(t, e[2], sd * e[3], 0.8); });
      }
    });
  })();

  /* 12 — G-funk: funky bass, EP chords, whistle lead */
  (function () {
    var kick = P("x.....x.x.....x. x.....x...x.....");
    var hat  = P("x.x.x.o.x.x.x.x. x.x.x.o.x.x.x.xx");
    var bass = [[0, 0, 43, 2], [0, 3, 43, 1], [0, 6, 46, 2], [0, 8, 43, 2], [0, 10, 50, 1], [0, 11, 48, 1], [0, 14, 46, 2],
                [1, 0, 39, 2], [1, 3, 39, 1], [1, 6, 41, 2], [1, 8, 43, 3], [1, 12, 46, 2], [1, 14, 41, 2]];
    var ch = [[55, 58, 62, 65], [51, 55, 58, 62]];
    var mel = [[2, 0, 79, 6, 74], [2, 8, 77, 4], [2, 12, 74, 4], [3, 0, 74, 8, 77], [3, 10, 70, 6]];
    BEATS.push({
      id: "gfunk", family: "oldschool", name: "ساحل", genre: "جی‌فانک", vibe: "وست‌کوست، سوت سینتی، باس فانکی", bpm: 96, swing: 0.08,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 0.95, { f0: 130, dec: 0.4 });
        if (s === 4 || s === 12) { k.clap(t, 0.9); k.snare(t, 0.5, { hp: 2000 }); }
        hatChar(k, at(hat, bar, s), t, sd, 0.5);
      },
      music: function (k, bar, s, t, sd) {
        evAt(bass, 2, bar, s).forEach(function (e) { k.bass(t, e[2], sd * e[3], 1); });
        if (s === 0) k.keys("ep", t, ch[bar % 2], sd * 14, 0.55);
        evAt(mel, 4, bar, s).forEach(function (e) { k.lead(t, e[2], sd * e[3], 0.7, e[4]); });
      }
    });
  })();

  /* 13 — Old-school electro: 808 cowbell, claps, staccato bass, scratches */
  (function () {
    var kick = P("x.....x...x..... x.....x.x...x...");
    var cow  = P("..x..x....x..x.. ..x..x....x...x.");
    var bass = [[0, 0, 40], [0, 3, 40], [0, 6, 43], [0, 8, 40], [0, 11, 45], [0, 14, 43],
                [1, 0, 40], [1, 3, 40], [1, 6, 47], [1, 8, 45], [1, 10, 43], [1, 12, 42], [1, 14, 43]];
    BEATS.push({
      id: "oldschool", family: "oldschool", name: "اولد اسکول", genre: "الکترو هیپ‌هاپ", vibe: "کاوبل ۸۰۸، تند، حال‌وهوای دهه‌ی هشتاد", bpm: 104, swing: 0.04,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 1, { f0: 120, f1: 45, dec: 0.5 });
        if (s === 4 || s === 12) k.clap(t, 1);
        if (at(cow, bar, s) === "x") k.cowbell(t, 0.6);
        k.hat(t, s % 4 === 2 ? 0.55 : 0.25);
        if (bar % 4 === 3 && (s === 8 || s === 10 || s === 12)) k.scratch(t, sd * 1.4, 0.75);
      },
      music: function (k, bar, s, t, sd) {
        evAt(bass, 2, bar, s).forEach(function (e) { k.bass(t, e[2], sd * 1.2, 1); });
        if (s === 0 && bar % 2 === 0) k.saw(t, [64, 67, 71], sd * 2, 0.5);
      }
    });
  })();

  /* 14 — Bounce: the classic head-nod groove. Kick on the "and"s, hard 2 & 4, offbeat piano stabs */
  (function () {
    var kick = P("x......x..x..... x.x....x..x..x..");
    var snr  = P("....x.......x... ....x.......x..g");
    var hat  = P("x.xgx.xgx.xgx.xg x.xgx.xgx.xgx.o.");
    var ch = [[52, 55, 59, 62], [52, 55, 59, 62], [55, 59, 62, 66], [50, 54, 57, 62]];
    var roots = [40, 40, 43, 38];
    BEATS.push({
      id: "bounce", family: "oldschool", name: "بانس", genre: "بوم‌بپ بانسی", vibe: "سر تکون‌دادنی، کیک بالاپایین، پیانوی ضربه‌ای", bpm: 95, swing: 0.16, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") { k.kick(t, 1.05, { f0: 155, dec: 0.36 }); k.bass(t, roots[bar % 4], sd * 1.6, 0.95); }
        var c = at(snr, bar, s);
        if (c === "x") { k.snare(t, 1.05, { hp: 1500, dec: 0.17 }); k.clap(t, 0.45); }
        else if (c === "g") k.snare(t, 0.25, { verb: 0 });
        hatChar(k, at(hat, bar, s), t, sd, s % 4 === 0 ? 0.85 : 0.55);
        if (s === 14) k.bass(t, roots[bar % 4] + 12, sd * 0.8, 0.6);   // octave pop that makes it bounce
      },
      music: function (k, bar, s, t, sd) {
        if (s === 3 || s === 11) k.keys("piano", t, ch[bar % 4], sd * 1.1, 0.6);
        if (s === 0 && bar % 4 === 3) k.brass(t, ch[3], sd * 2, 0.45);
      }
    });
  })();

  /* 15 — Breakbeat: funky-drummer-style ghost notes, organ stabs, funky bass */
  (function () {
    var kick = P("x.x.......x..x.. x.x...x...x.....");
    var snr  = P("....x..g.g..x..g ....x..g.g..x.g.");
    var hat  = P("xgxgxgxgxgxgxgxg xgxgxgxgxgxgxgog");
    var org = [[0, 0, [52, 56, 59, 62], 2], [0, 6, [52, 56, 59, 62], 1], [0, 10, [52, 56, 59, 62], 2],
               [1, 3, [57, 61, 64, 67], 1], [1, 6, [57, 61, 64, 67], 2], [1, 14, [57, 61, 64, 67], 1]];
    var bass = [[0, 0, 40], [0, 3, 40], [0, 6, 52], [0, 8, 43], [0, 10, 45], [0, 13, 47],
                [1, 0, 45], [1, 3, 45], [1, 6, 57], [1, 8, 47], [1, 10, 43], [1, 14, 40]];
    BEATS.push({
      id: "breaks", family: "oldschool", name: "بریک", genre: "بریک‌بیت فانکی", vibe: "درام فانک با نت‌های شبح، ارگ، باس فانکی", bpm: 100, swing: 0.08, vinyl: true,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.kick(t, 1, { f0: 140, dec: 0.32 });
        var c = at(snr, bar, s);
        if (c === "x") k.snare(t, 1.05, { hp: 1300, dec: 0.18 });
        else if (c === "g") k.snare(t, 0.28, { verb: 0, dec: 0.08 });
        hatChar(k, at(hat, bar, s), t, sd, s % 2 === 0 ? 0.7 : 0.35);
      },
      music: function (k, bar, s, t, sd) {
        evAt(org, 2, bar, s).forEach(function (e) { k.organ(t, e[2], sd * e[3], 0.8); });
        evAt(bass, 2, bar, s).forEach(function (e) { k.bass(t, e[2], sd * 1.3, 1); });
      }
    });
  })();

  /* 16 — New jack swing: heavy swing, gated snare + clap, synth stabs */
  (function () {
    var kick = P("x.....x...x.x... x.....x.x.......");
    var hat  = P("xgxgxgxgxgxgxgxg xgxgxgxgxgxgxgxx");
    var st = [[0, 0, [55, 58, 62, 65], 1], [0, 3, [55, 58, 62, 65], 1], [0, 6, [55, 58, 62, 65], 1], [0, 10, [55, 58, 62, 65], 2],
              [1, 0, [55, 60, 63, 67], 1], [1, 3, [55, 60, 63, 67], 1], [1, 6, [55, 60, 63, 67], 1], [1, 10, [55, 60, 63, 67], 1], [1, 13, [57, 60, 65, 69], 2]];
    var roots = [43, 48];
    BEATS.push({
      id: "newjack", family: "oldschool", name: "نیوجک", genre: "نیو جک سوئینگ", vibe: "سوئینگ سنگین، کلپ، استب سینتی — حال‌وهوای اواخر هشتاد", bpm: 104, swing: 0.22,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") { k.kick(t, 1, { f0: 130, f1: 44, dec: 0.4 }); k.bass(t, roots[bar % 2], sd * 1.4, 0.9); }
        if (s === 4 || s === 12) { k.snare(t, 0.9, { hp: 1800, dec: 0.1, verb: 0.4 }); k.clap(t, 0.85); }
        hatChar(k, at(hat, bar, s), t, sd, 0.5);
      },
      music: function (k, bar, s, t, sd) {
        evAt(st, 2, bar, s).forEach(function (e) { k.saw(t, e[2], sd * e[3], 0.65); });
      }
    });
  })();

  /* 17 — Beatbox: a human beat, made only with mouth sounds + hummed lip bass */
  (function () {
    var kick = P("x......x..x..... x.x....x..x.....");
    var snr  = P("....x.......x... ....x.......x..i");
    var hat  = P("x.x.x.x.x.x.x.o. x.x.x.x.x.x.x.x.");
    var clk  = P("..........k..... ...k.......k....");
    var hum = [[0, 0, 45, 6], [0, 10, 45, 4], [1, 0, 45, 6], [1, 10, 48, 4], [2, 0, 43, 6], [2, 10, 43, 4], [3, 0, 40, 6], [3, 10, 43, 4]];
    BEATS.push({
      id: "beatbox", family: "beatbox", name: "بیت‌باکس", genre: "بیت‌باکس", vibe: "فقط صدای دهن: بوم، پِف، تس، و باس هومی", bpm: 92, swing: 0.12,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.bbKick(t, 1);
        var c = at(snr, bar, s); if (c === "x") k.bbSnare(t, 1); else if (c === "i") k.bbInward(t, 0.8);
        var h = at(hat, bar, s); if (h === "x") k.bbHat(t, s % 4 === 0 ? 0.9 : 0.6); else if (h === "o") k.bbHat(t, 0.7, true);
        if (at(clk, bar, s) === "k") k.bbClick(t, 0.8);
      },
      music: function (k, bar, s, t, sd) {
        evAt(hum, 4, bar, s).forEach(function (e) { k.bbBass(t, e[2], sd * e[3], 0.8); });
      }
    });
  })();

  /* 18 — Fast beatbox: busier kicks, 16th "ts" hats, inward snares in the fills */
  (function () {
    var kick = P("x.....x..x.x.... x..x..x...x..x.x");
    var snr  = P("....x.......x... ....x..i....x...");
    var hum = [[0, 0, 40, 3], [0, 6, 40, 2], [0, 9, 43, 2], [0, 11, 45, 3], [1, 0, 40, 3], [1, 3, 40, 2], [1, 6, 47, 3], [1, 10, 45, 2], [1, 13, 43, 3]];
    BEATS.push({
      id: "boxfast", family: "beatbox", name: "باکس تند", genre: "بیت‌باکس تند", vibe: "بیت‌باکس پرانرژی با های‌هت تند و اسنیر نفسی", bpm: 100, swing: 0.06,
      drums: function (k, bar, s, t, sd) {
        if (at(kick, bar, s) === "x") k.bbKick(t, 1);
        var c = at(snr, bar, s); if (c === "x") k.bbSnare(t, 1.05); else if (c === "i") k.bbInward(t, 0.75);
        k.bbHat(t, s % 4 === 0 ? 0.8 : s % 2 === 0 ? 0.5 : 0.3, s === 14 && bar % 2 === 1);
        if (s === 7 && bar % 2 === 0) k.bbClick(t, 0.7);
      },
      music: function (k, bar, s, t, sd) {
        evAt(hum, 2, bar, s).forEach(function (e) { k.bbBass(t, e[2], sd * e[3], 0.85); });
      }
    });
  })();

  /* list order: old school first, then boom bap, beatbox, trap/drill, Persian, everything else */
  var FAM = { oldschool: 0, boombap: 1, beatbox: 2, trap: 3, persian: 4, other: 5 };
  BEATS.sort(function (a, b) { return FAM[a.family] - FAM[b.family]; });
  QB.BEAT_FAMILIES = [["all", "همه"], ["oldschool", "اولد اسکول"], ["boombap", "بوم‌بپ"], ["beatbox", "بیت‌باکس"],
                      ["trap", "ترپ و دریل"], ["persian", "ایرانی"], ["other", "بقیه"]];
  QB.MOODS = [["dark", "تاریک"], ["heavy", "سنگین"], ["energetic", "پرانرژی"], ["chill", "آروم"], ["nostalgic", "نوستالژی"], ["happy", "شاد"]];

  /* moods, loudness trim (measured after the master chain, target ≈ −10 dB RMS) and date added */
  var NEW = "2026-11-14", NEW2 = "2026-11-15";
  var META = {
    boombap:   { moods: ["nostalgic", "chill"],     level: 1.24 },
    golden:    { moods: ["nostalgic", "energetic"], level: 1.30, added: NEW },
    kooche:    { moods: ["chill", "happy"],         level: 1.00, added: NEW },
    bomb:      { moods: ["dark", "heavy"],          level: 1.29, added: NEW },
    trap:      { moods: ["dark"],                   level: 0.80 },
    drill:     { moods: ["dark", "heavy"],          level: 0.77 },
    atish:     { moods: ["energetic", "heavy"],     level: 0.79, added: NEW },
    khashm:    { moods: ["energetic", "heavy"],     level: 0.81, added: NEW },
    santur:    { moods: ["nostalgic", "dark"],      level: 0.79 },
    zurkhaneh: { moods: ["heavy", "energetic"],     level: 1.60 },
    lofi:      { moods: ["chill"],                  level: 1.45 },
    gfunk:     { moods: ["happy", "chill"],         level: 0.95, added: NEW },
    oldschool: { moods: ["happy", "energetic"],     level: 1.00, added: NEW },
    bounce:    { moods: ["energetic", "nostalgic"], level: 1.07, added: NEW2 },
    breaks:    { moods: ["energetic", "happy"],     level: 0.97, added: NEW2 },
    newjack:   { moods: ["happy", "energetic"],     level: 1.31, added: NEW2 },
    beatbox:   { moods: ["nostalgic", "energetic"], level: 1.00, added: NEW2 },
    boxfast:   { moods: ["energetic", "heavy"],     level: 0.92, added: NEW2 }
  };
  BEATS.forEach(function (b) { var m = META[b.id] || {}; b.moods = m.moods || []; b.level = m.level || 1; b.added = m.added || null; });
  // within a genre, newest first
  BEATS.sort(function (a, b) { return (FAM[a.family] - FAM[b.family]) || (b.added || "").localeCompare(a.added || ""); });

  QB.BEATS = BEATS;
  QB.beatById = function (id) { for (var i = 0; i < BEATS.length; i++) if (BEATS[i].id === id) return BEATS[i]; return null; };

  /* A playable copy of a beat with per-beat settings applied:
     tempo (0.85–1.15×), layers ("all" | "drums" | "nodrums") */
  QB.beatVariant = function (beat, o) {
    o = o || {};
    var v = Object.create(beat), tempo = o.tempo || 1;
    v.bpm = Math.round(beat.bpm * tempo * 10) / 10;
    if (o.layers === "drums") v.music = function () {};
    if (o.layers === "nodrums") v.drums = function () {};
    return v;
  };

  /* Small waveform for a beat card: renders 2 bars offline (no sound) → 40 peaks 0..1 */
  QB.beatWave = function (beat) {
    var sr = A.ensure().sampleRate, sd = 60 / beat.bpm / 4, secs = 32 * sd + 0.3;   // reverb buffer needs the same rate
    var oc = new OfflineAudioContext(1, Math.ceil(sr * secs), sr);
    var k = new Kit(oc, 1, oc.destination);
    for (var bar = 0; bar < 2; bar++) for (var s = 0; s < 16; s++) {
      var t = 0.02 + (bar * 16 + s) * sd + (s % 2 ? (beat.swing || 0) * sd : 0);
      beat.drums(k, bar, s, t, sd); beat.music(k, bar, s, t, sd);
    }
    return oc.startRendering().then(function (buf) { return QB.peaks(buf, 40); });
  };
  QB.peaks = function (buf, n) {
    var d = buf.getChannelData(0), step = Math.floor(d.length / n), out = [], max = 0;
    for (var i = 0; i < n; i++) {
      var p = 0;
      for (var j = i * step; j < (i + 1) * step; j += 4) { var a = Math.abs(d[j]); if (a > p) p = a; }
      out.push(p); if (p > max) max = p;
    }
    return out.map(function (p) { return max ? Math.round(p / max * 100) / 100 : 0; });
  };

  /* Bars of quiet intro before the beat really starts (0–8), from per-bar loudness */
  QB.detectIntro = function (buf, bpm, offset) {
    var sr = buf.sampleRate, d = buf.getChannelData(0), barLen = Math.floor(240 / bpm * sr), start = Math.floor((offset || 0) * sr);
    var rms = [];
    for (var b = 0; b < 24; b++) {
      var a = start + b * barLen, e = 0, n = 0;
      if (a + barLen > d.length) break;
      for (var i = a; i < a + barLen; i += 8) { e += d[i] * d[i]; n++; }
      rms.push(Math.sqrt(e / n));
    }
    if (rms.length < 8) return 0;
    var sorted = rms.slice(4).sort(function (x, y) { return x - y; }), ref = sorted[Math.floor(sorted.length / 2)];
    for (var k = 0; k < Math.min(8, rms.length); k++) if (rms[k] >= ref * 0.62) return k;
    return 0;
  };
  /* Loudness trim for an MP3 so all beats play at a similar level */
  QB.bufferLevel = function (buf) {
    var d = buf.getChannelData(0), e = 0, n = 0;
    for (var i = 0; i < d.length; i += 16) { e += d[i] * d[i]; n++; }
    var rms = Math.sqrt(e / Math.max(1, n));
    if (!rms) return 1;
    return Math.max(0.5, Math.min(2, 0.2 / rms));   // ≈ −14 dBFS RMS target before the master chain
  };

  /* metronome "beat" for tap mode */
  var CLICK_BEAT = {
    id: "click", name: "ضرب دستی", genre: "تپ", bpm: 90, swing: 0,
    drums: function (k, bar, s, t) { if (s % 4 === 0 && this.audible) k.click(t, s === 0); },
    music: function () {}
  };

  /* ---------- Transport ----------
   * Bar 0 is the count-in. Gameplay bars start at 1.
   * segments[] map audio-clock time → musical position (tempo can change in Endless).
   */
  function Transport() { this.running = false; this.segments = []; }

  Transport.prototype.start = function (opts) {
    var ctx = A.ensure();
    this.opts = opts;
    this.kit = new Kit(ctx, opts.volume);
    this.running = true;
    this.segments = [];
    this.endBar = opts.endBar == null ? null : opts.endBar; // music bar at which it ends
    this.introBars = opts.intro === false ? 0 : 1;
    var t0 = ctx.currentTime + 0.12;
    if (opts.t0 && opts.t0 > ctx.currentTime + 0.05) t0 = opts.t0;

    if (opts.kind === "buffer") {
      var src = ctx.createBufferSource(); src.buffer = opts.buffer;
      var g = this.kit.gain(this.kit.out); g.gain.value = opts.gain || 1;
      src.connect(g);
      var off = Math.max(0, opts.offset || 0), barDur = 240 / opts.bpm;
      if (opts.loopBars) {
        // short loops repeat exactly on the bar grid (loop points in whole bars, not the file's raw length)
        src.loop = true;
        src.loopStart = off;
        src.loopEnd = off + opts.loopBars * barDur;
      }
      src.start(t0, off);
      this.kit.sources.push(src);
      this.bufferSrc = src;
      if (!opts.loopBars) {
        var maxBars = Math.floor((opts.buffer.duration - off) / barDur);
        if (this.endBar == null || this.endBar > maxBars) this.endBar = maxBars;
      }
      this.beat = { id: "upload", name: opts.name, bpm: opts.bpm, swing: 0, drums: function () {}, music: function () {} };
      this.segments.push({ t0: t0, bar0: 0, bpm: opts.bpm, beat: this.beat });
      var self = this;
      src.onended = function () { if (self.running && self.onEnd) self.onEnd(); };
    } else {
      var beat = opts.kind === "click" ? Object.create(CLICK_BEAT) : opts.beats[0];
      if (opts.kind === "click") { beat.bpm = opts.bpm; beat.audible = !!opts.audible; }
      this.beat = beat;
      this.beatIndex = 0;
      this.segments.push({ t0: t0, bar0: 0, bpm: beat.bpm, beat: beat });
      if (beat.vinyl) this.kit.vinyl(t0, true);
      this.vol = opts.volume == null ? 1 : opts.volume;
      this.kit.out.gain.value = this.vol * (beat.level || 1);
    }
    this.bar = 0; this.step = 0; this.nextTime = t0;
    var self2 = this;
    this.timer = setInterval(function () { self2.tick(); }, 25);
    this.tick();
    return t0;
  };

  Transport.prototype.tick = function () {
    if (!this.running) return;
    var ctx = A.ctx, horizon = ctx.currentTime + 0.14;
    while (this.nextTime < horizon && this.running) {
      this.scheduleStep(this.bar, this.step, this.nextTime);
      this.advance();
    }
  };

  Transport.prototype.stepDur = function () { return 60 / this.beat.bpm / 4; };

  Transport.prototype.scheduleStep = function (bar, step, time) {
    var k = this.kit, beat = this.beat, sd = this.stepDur();
    var swingT = (step % 2 === 1) ? (beat.swing || 0) * sd : 0;
    var t = time + swingT;
    var seg = this.segments[this.segments.length - 1];
    var lbar = bar - seg.bar0; // bar within the current beat's loop

    if (this.endBar != null && bar >= this.endBar) {
      if (bar === this.endBar && step === 0 && this.opts.kind !== "buffer") {
        k.kick(t, 1); k.crash(t, 1);
        if (beat.music && beat.id !== "click") beat.music(k, 0, 0, t, sd);
      }
      return;
    }
    if (this.opts.kind === "buffer") {
      if (this.opts.audible && step % 4 === 0) k.click(t, step === 0);
      return;
    }
    if (this.introBars && bar < this.introBars && !this.opts.preview) {
      // count-in: rim on every beat over the beat's music
      if (beat.id === "click") { if (beat.audible && step % 4 === 0) k.click(t, step === 0); return; }
      if (step % 4 === 0) k.rim(t, step === 0 ? 1 : 0.7);
      if (step % 2 === 0) k.hat(t, 0.35);
      beat.music(k, lbar, step, t, sd);
      return;
    }
    if (bar === this.introBars && step === 0 && !this.opts.preview && beat.id !== "click") k.crash(t, 0.8);
    beat.drums(k, lbar, step, t, sd);
    beat.music(k, lbar, step, t, sd);
  };

  Transport.prototype.advance = function () {
    this.nextTime += this.stepDur();
    this.step++;
    if (this.step < 16) return;
    this.step = 0;
    this.bar++;
    var o = this.opts;
    // Endless: rotate beats on bar boundaries
    if (o.kind === "synth" && o.beats.length > 1 && o.switchEvery &&
        this.bar > this.introBars && (this.bar - this.introBars) % o.switchEvery === 0 &&
        (this.endBar == null || this.bar < this.endBar)) {
      this.beatIndex = (this.beatIndex + 1) % o.beats.length;
      var nb = o.beats[this.beatIndex];
      this.beat = nb;
      this.segments.push({ t0: this.nextTime, bar0: this.bar, bpm: nb.bpm, beat: nb });
      this.kit.out.gain.setValueAtTime(this.vol * (nb.level || 1), this.nextTime);
    }
    if (this.endBar != null && this.bar > this.endBar) {
      var self = this, when = this.nextTime;
      this.running = false;
      clearInterval(this.timer);
      var ms = Math.max(0, (when - A.ctx.currentTime) * 1000) + 600;
      setTimeout(function () { if (self.onEnd) self.onEnd(); }, ms);
    }
  };

  /* musical position in beats (quarter notes) at audio time t */
  Transport.prototype.beatPos = function (t) {
    var segs = this.segments, seg = segs[0];
    for (var i = segs.length - 1; i >= 0; i--) if (segs[i].t0 <= t) { seg = segs[i]; break; }
    return seg.bar0 * 4 + (t - seg.t0) * seg.bpm / 60;
  };
  Transport.prototype.segmentAt = function (t) {
    var segs = this.segments;
    for (var i = segs.length - 1; i >= 0; i--) if (segs[i].t0 <= t) return segs[i];
    return segs[0];
  };
  /* audio time at which a musical bar starts */
  Transport.prototype.timeOfBar = function (bar) {
    var segs = this.segments, seg = segs[0];
    for (var i = segs.length - 1; i >= 0; i--) if (segs[i].bar0 <= bar) { seg = segs[i]; break; }
    return seg.t0 + (bar - seg.bar0) * 240 / seg.bpm;
  };

  Transport.prototype.stop = function (fade) {
    this.running = false;
    clearInterval(this.timer);
    if (this.kit) this.kit.dispose(fade);
    this.kit = null;
  };

  QB.Transport = Transport;
  QB.Kit = Kit;

  /* ---------- Tempo + downbeat detection for uploaded beats ---------- */
  QB.detectTempo = function (buffer) {
    var sr = buffer.sampleRate;
    var maxSecs = Math.min(buffer.duration, 75);
    var len = Math.floor(maxSecs * sr);
    var ch0 = buffer.getChannelData(0), ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;

    var hop = 512, hopSec = hop / sr, frames = Math.floor(len / hop);
    var full = new Float32Array(frames), low = new Float32Array(frames);
    var lp = 0, a = Math.exp(-2 * Math.PI * 150 / sr);
    for (var f = 0; f < frames; f++) {
      var e = 0, el = 0, base = f * hop;
      for (var i = 0; i < hop; i++) {
        var x = (ch0[base + i] + ch1[base + i]) * 0.5;
        lp = a * lp + (1 - a) * x;
        e += x * x; el += lp * lp;
      }
      full[f] = Math.sqrt(e / hop); low[f] = Math.sqrt(el / hop);
    }
    // onset strength = positive flux, low band weighted (kicks)
    var on = new Float32Array(frames), onLow = new Float32Array(frames);
    for (f = 1; f < frames; f++) {
      onLow[f] = Math.max(0, low[f] - low[f - 1]);
      on[f] = Math.max(0, full[f] - full[f - 1]) + 1.5 * onLow[f];
    }
    // normalise
    var mean = 0; for (f = 0; f < frames; f++) mean += on[f]; mean /= frames || 1;
    for (f = 0; f < frames; f++) on[f] = Math.max(0, on[f] - mean);

    // autocorrelation across 60–180 BPM with a mild prior toward ~95
    var best = { bpm: 90, score: -1 };
    for (var bpm = 60; bpm <= 180; bpm += 0.5) {
      var lag = 60 / bpm / hopSec, l0 = Math.floor(lag), fr = lag - l0, s = 0;
      for (f = 0; f + l0 + 1 < frames; f++) s += on[f] * (on[f + l0] * (1 - fr) + on[f + l0 + 1] * fr);
      var prior = Math.exp(-Math.pow(Math.log2(bpm / 95), 2) / (2 * 0.5 * 0.5));
      s *= prior;
      if (s > best.score) best = { bpm: bpm, score: s };
    }
    var tempo = best.bpm;
    while (tempo > 125) tempo /= 2;
    while (tempo < 62) tempo *= 2;

    // refine tempo and find beat phase with a comb
    function comb(bpmV, phase, sig) {
      var per = 60 / bpmV / hopSec, sc = 0;
      for (var p = phase; p < frames; p += per) {
        var idx = Math.round(p); if (idx < frames) sc += sig[idx] + 0.5 * (sig[idx - 1] || 0) + 0.5 * (sig[idx + 1] || 0);
      }
      return sc;
    }
    var bestR = { bpm: tempo, phase: 0, score: -1 };
    for (var tb = tempo - 1.5; tb <= tempo + 1.5; tb += 0.1) {
      var per = 60 / tb / hopSec;
      for (var ph = 0; ph < per; ph += 1) {
        var sc = comb(tb, ph, on);
        if (sc > bestR.score) bestR = { bpm: tb, phase: ph, score: sc };
      }
    }
    // downbeat: which of 4 beats carries the most low-end
    var perB = 60 / bestR.bpm / hopSec, bestD = { k: 0, score: -1 };
    for (var k = 0; k < 4; k++) {
      var scd = 0;
      for (var p = bestR.phase + k * perB; p < frames; p += perB * 4) {
        var id = Math.round(p); if (id < frames) scd += onLow[id];
      }
      if (scd > bestD.score) bestD = { k: k, score: scd };
    }
    var offset = (bestR.phase + bestD.k * perB) * hopSec;
    return { bpm: Math.round(bestR.bpm * 10) / 10, offset: Math.round(offset * 1000) / 1000 };
  };

  QB.mtof = mtof;
})();
