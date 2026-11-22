/*
 * Recorder: turns a game into a shareable 9:16 video (720×1280).
 * - Draws the beat grid, words and ball onto a canvas (optionally over the selfie camera).
 * - Mixes the beat (from the Web Audio graph) with the microphone.
 * - The beat is delayed by output + input latency so the voice lands on the beat in the video.
 * Everything stays on the device.
 */
(function () {
  var QB = window.QB, A = QB.audio;
  var W = 720, H = 1280;
  var MIMES = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"
  ];

  function pickMime() {
    for (var i = 0; i < MIMES.length; i++) if (MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i];
    return "";
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  var R = QB.Recorder = {
    supported: function () {
      return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream &&
                navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    /* ask for mic (+camera) before the game starts */
    prepare: function (camera) {
      var self = this;
      this.cleanup();
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
        video: camera ? { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } } : false
      }).then(function (stream) {
        self.media = stream;
        if (camera && stream.getVideoTracks().length) {
          var v = self.video = document.createElement("video");
          v.muted = true; v.playsInline = true; v.srcObject = stream;
          return v.play().catch(function () {}).then(function () { return true; });
        }
        return true;
      });
    },

    start: function (game) {
      if (!this.media) return false;
      var ctx = A.ensure();
      this.game = game;
      // theme snapshot
      this.col = {
        bg: css("--bg"), surface: css("--surface"), line: css("--line"), text: css("--text"), muted: css("--muted"),
        accent: css("--accent"), onr: css("--on-r"), ball: css("--ball"),
        r: [css("--r0"), css("--r1"), css("--r2"), css("--r3")],
        font: css("--font-display"), weight: css("--display-weight") || "400",
        radius: parseFloat(css("--radius")) || 2
      };
      var canvas = this.canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      this.c = canvas.getContext("2d");

      // audio: delayed beat + mic → recorder
      var mic = this.media.getAudioTracks()[0];
      var inLat = (mic && mic.getSettings && mic.getSettings().latency) || 0.03;
      this.delay = Math.min(1, Math.max(0, A.latency() + (game.cfg.lagMs || 0) / 1000 + inLat));
      this.dest = ctx.createMediaStreamDestination();
      this.beatDelay = ctx.createDelay(1.5);
      this.beatDelay.delayTime.value = this.delay;
      A.analyser.connect(this.beatDelay);
      this.beatDelay.connect(this.dest);
      this.micSrc = ctx.createMediaStreamSource(new MediaStream([mic]));
      this.micGain = ctx.createGain(); this.micGain.gain.value = 1.3;
      this.micSrc.connect(this.micGain); this.micGain.connect(this.dest);

      var stream = new MediaStream(canvas.captureStream(30).getVideoTracks().concat(this.dest.stream.getAudioTracks()));
      this.mime = pickMime();
      var opts = { videoBitsPerSecond: 3500000, audioBitsPerSecond: 128000 };
      if (this.mime) opts.mimeType = this.mime;
      this.chunks = [];
      var rec = this.rec = new MediaRecorder(stream, opts);
      var self = this;
      rec.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
      rec.start(1000);
      this.startedAt = performance.now(); this.pausedMs = 0;
      this.running = true;
      (function loop() {
        if (!self.running) return;
        self.draw();
        requestAnimationFrame(loop);
      })();
      return true;
    },

    pause: function () {
      try { if (this.rec && this.rec.state === "recording") { this.rec.pause(); this.pausedAt = performance.now(); } } catch (e) {}
    },
    resume: function () {
      try { if (this.rec && this.rec.state === "paused") { this.rec.resume(); this.pausedMs += performance.now() - this.pausedAt; } } catch (e) {}
    },

    /* stop after a short tail; resolves with { blob, url, ext, mime } */
    stop: function () {
      var self = this;
      if (!this.rec) { this.cleanup(); return Promise.resolve(null); }
      return new Promise(function (resolve) {
        setTimeout(function () {
          self.running = false;
          self.rec.onstop = function () {
            var type = (self.rec.mimeType || self.mime || "video/webm").split(";")[0];
            var ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
            var ms = performance.now() - self.startedAt - self.pausedMs;
            var raw = new Blob(self.chunks, { type: type });
            self.cleanup();
            if (!raw.size) { resolve(null); return; }
            // the recorder writes the header before it knows the length → write the real length in
            R.fixDuration(raw, ms).then(function (blob) {
              resolve({ blob: blob, url: URL.createObjectURL(blob), ext: ext, mime: type });
            });
          };
          try { self.rec.stop(); } catch (e) { self.cleanup(); resolve(null); }
        }, Math.round(this.delay * 1000) + 400);
      });
    },

    cleanup: function () {
      this.running = false;
      try { if (this.beatDelay) { A.analyser.disconnect(this.beatDelay); this.beatDelay.disconnect(); } } catch (e) {}
      try { if (this.micSrc) this.micSrc.disconnect(); } catch (e) {}
      if (this.media) this.media.getTracks().forEach(function (t) { t.stop(); });
      this.media = this.video = this.rec = this.beatDelay = this.micSrc = this.dest = null;
    },

    /* ---------- drawing ---------- */
    draw: function () {
      var g = this.game, t = g.transport;
      if (!t) return;
      var c = this.c, col = this.col, ctx = A.ctx;
      var now = ctx.currentTime - this.delay;
      var gb = g.musicToGrid(t.beatPos(now));

      // background
      if (this.video && this.video.videoWidth) {
        var v = this.video, s = Math.max(W / v.videoWidth, H / v.videoHeight);
        var dw = v.videoWidth * s, dh = v.videoHeight * s;
        c.save(); c.translate(W, 0); c.scale(-1, 1);
        c.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        c.restore();
        var gr = c.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(0.3, "rgba(0,0,0,0)");
        gr.addColorStop(0.45, "rgba(0,0,0,.15)"); gr.addColorStop(0.62, "rgba(0,0,0,.7)"); gr.addColorStop(1, "rgba(0,0,0,.85)");
        c.fillStyle = gr; c.fillRect(0, 0, W, H);
      } else {
        c.fillStyle = col.bg; c.fillRect(0, 0, W, H);
        c.save(); c.globalAlpha = 0.06; c.fillStyle = col.accent;
        c.font = col.weight + " 900px " + col.font; c.textAlign = "center"; c.direction = "rtl";
        c.fillText("ق", W / 2, 760); c.restore();
      }

      c.direction = "rtl"; c.textBaseline = "middle";
      // header: brand + beat
      c.textAlign = "right";
      c.font = col.weight + " 72px " + col.font;
      c.fillStyle = col.accent; c.fillText("قافیه‌باز", W - 40 + 4, 92 + 4);
      c.fillStyle = col.text; c.fillText("قافیه‌باز", W - 40, 92);
      var seg = t.segmentAt(now), beat = seg && seg.beat;
      c.font = "500 28px Vazirmatn, Tahoma, sans-serif"; c.fillStyle = col.text;
      if (beat) c.fillText(beat.name + "  ·  " + QB.fa(Math.round(beat.bpm)) + " BPM", W - 40, 160);
      // bar counter
      var bar = Math.max(0, Math.floor(gb / 4)); if (g.totalBars) bar = Math.min(bar, g.totalBars);
      c.textAlign = "left"; c.font = col.weight + " 64px " + col.font; c.fillStyle = col.text;
      c.fillText(QB.pad2(bar), 40, 96);
      c.font = "500 26px Vazirmatn, Tahoma, sans-serif"; c.fillStyle = col.muted;
      c.fillText(g.totalBars ? "از " + QB.fa(g.totalBars) : "بی‌پایان", 40, 150);

      this.drawGrid(gb);

      c.textAlign = "center"; c.font = "400 22px Vazirmatn, Tahoma, sans-serif"; c.fillStyle = col.muted;
      c.direction = "ltr"; c.fillText(location.host + location.pathname.replace(/index\.html$/, ""), W / 2, H - 34);
      c.direction = "rtl";
    },

    drawGrid: function (gb) {
      var c = this.c, col = this.col, g = this.game;
      var rowH = 128, top = 700, pad = 36, gap = 12;
      var pos = Math.max(0, gb / 4), whole = Math.floor(pos), frac = pos - whole;
      var scroll = whole + (frac > 0.8 ? easeInOut((frac - 0.8) / 0.2) : 0);
      var fr = [1, 1, 1, 2.1], unit = (W - pad * 2 - gap * 3) / 5.1;
      // RTL: cell 0 (beat 1) on the right
      var xs = [], x = W - pad;
      for (var i = 0; i < 4; i++) { var w = unit * fr[i]; x -= w; xs.push({ x: x, w: w }); x -= gap; }
      var maxBar = g.totalBars != null ? g.totalBars + 1 : Infinity;

      c.save();
      c.beginPath(); c.rect(0, top - 10, W, rowH * 4 + 20); c.clip();
      for (var b = Math.max(0, whole - 2); b <= Math.min(maxBar, whole + 4); b++) {
        var y = top + (b - scroll + 1) * rowH;
        if (y < top - rowH || y > top + rowH * 4) continue;
        var d = b - whole;
        c.globalAlpha = d < 0 ? Math.max(0, 0.35 - (scroll - b - 1) * 0.6) : (d >= 3 ? 0.45 : 1);
        this.drawRow(b, xs, y + 8, rowH - 16, b === whole ? gb - whole * 4 : -1);
      }
      c.globalAlpha = 1;

      // ball
      var bb = Math.max(0, gb), bi = Math.floor(bb), f = bb - bi;
      var b1 = Math.floor(bi / 4), c1 = bi % 4, b2 = Math.floor((bi + 1) / 4), c2 = (bi + 1) % 4;
      var y1 = top + (b1 - scroll + 1) * rowH, y2 = top + (b2 - scroll + 1) * rowH;
      var cx1 = xs[c1].x + xs[c1].w / 2, cx2 = xs[c2].x + xs[c2].w / 2;
      var lift = rowH * 0.6 * 4 * f * (1 - f);
      var bx = cx1 + (cx2 - cx1) * f, by = y1 + (y2 - y1) * f + 10 - lift;
      if (g.totalBars != null && b1 > g.totalBars) { bx = cx1; by = y1 + 10; }
      c.beginPath(); c.arc(bx, by, 19, 0, Math.PI * 2);
      c.fillStyle = col.bg; c.fill();
      c.beginPath(); c.arc(bx, by, 15, 0, Math.PI * 2);
      c.fillStyle = col.ball; c.fill();
      c.restore();
    },

    drawRow: function (b, xs, y, h, beatInBar) {
      var c = this.c, col = this.col, g = this.game, rad = Math.min(col.radius * 2, 14);
      var end = g.totalBars != null && b > g.totalBars;
      var word = null;
      if (b > 0 && !end) word = g.gen.bar(b);
      for (var i = 0; i < 4; i++) {
        var cell = xs[i], hit = beatInBar >= 0 && Math.floor(beatInBar) === i && (beatInBar % 1) < 0.18;
        rr(c, cell.x, y, cell.w, h, rad);
        var label = null, fill = "rgba(20,20,20,.72)", stroke = col.line, txt = col.text, dashed = false;
        if (b === 0) {
          if (i < 3) { label = QB.fa(i + 1); txt = col.muted; } else { label = "برو!"; fill = col.text; txt = col.bg; stroke = col.text; }
        } else if (end) {
          if (i === 3) { label = "تمام"; fill = col.accent; txt = col.onr; stroke = col.accent; }
        } else if (i === 3 && word && word.letter) {
          var rc = col.r[word.color];
          if (word.visible) { label = word.word; fill = rc; txt = col.onr; stroke = rc; }
          else { label = "؟"; fill = "rgba(20,20,20,.72)"; txt = rc; stroke = rc; dashed = true; }
        } else if (i === 3) dashed = true;
        if (hit && i < 3) fill = col.accent;
        c.fillStyle = fill; c.fill();
        c.lineWidth = 3; c.strokeStyle = stroke;
        if (dashed) c.setLineDash([12, 9]);
        c.stroke(); c.setLineDash([]);
        if (label) {
          var size = i === 3 ? 58 : 50;
          c.font = col.weight + " " + size + "px " + col.font;
          while (c.measureText(label).width > cell.w - 24 && size > 24) { size -= 3; c.font = col.weight + " " + size + "px " + col.font; }
          c.fillStyle = txt; c.textAlign = "center";
          c.fillText(label, cell.x + cell.w / 2, y + h / 2 + 4);
        } else if (i < 3) {
          c.beginPath(); c.arc(cell.x + cell.w / 2, y + h / 2, 5, 0, Math.PI * 2);
          c.fillStyle = col.muted; c.fill();
        }
      }
    }
  };

  /* ---------- write the real length into the recorded file ----------
     MediaRecorder streams the file out while recording, so its header never gets the final length:
     Chrome's MP4 says 0 for the movie and ~the first fragment for each track; its WebM has no Duration.
     Gallery apps trust those fields ("3 seconds" while the video plays to the end).
     MP4: real track lengths are summed from the fragments (moof/traf), then mvhd/tkhd/mdhd are patched
          and an mehd box is added. WebM: a Duration element is added to the Segment Info.
     Any parsing problem → the original file is used unchanged. */
  function boxList(dv, start, end) {
    var out = [], p = start;
    while (p + 8 <= end) {
      var size = dv.getUint32(p), hdr = 8;
      var type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
      if (size === 1) { size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type: type, start: p, size: size, hdr: hdr });
      p += size;
    }
    return out;
  }
  function kids(dv, box) { return boxList(dv, box.start + box.hdr, box.start + box.size); }
  function first(list, type) { for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i]; return null; }
  function all(list, type) { return list.filter(function (b) { return b.type === type; }); }
  function u64(dv, p) { return dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); }

  function fixMp4(buf, ms) {
    var dv = new DataView(buf), top = boxList(dv, 0, buf.byteLength);
    var moov = first(top, "moov"); if (!moov || moov.hdr !== 8) return null;
    var mk = kids(dv, moov), mvhd = first(mk, "mvhd"), mvex = first(mk, "mvex");
    if (!mvhd) return null;
    var mv = dv.getUint8(mvhd.start + 8), movieTs = dv.getUint32(mvhd.start + 8 + (mv ? 20 : 12));
    var tracks = {}, defDur = {};
    all(mk, "trak").forEach(function (trak) {
      var tk = kids(dv, trak), tkhd = first(tk, "tkhd"), mdia = first(tk, "mdia"); if (!tkhd || !mdia) return;
      var mdhd = first(kids(dv, mdia), "mdhd"); if (!mdhd) return;
      var tv = dv.getUint8(tkhd.start + 8), id = dv.getUint32(tkhd.start + 8 + (tv ? 20 : 12));
      var hv = dv.getUint8(mdhd.start + 8);
      tracks[id] = { tkhd: tkhd, tv: tv, mdhd: mdhd, hv: hv, ts: dv.getUint32(mdhd.start + 8 + (hv ? 20 : 12)), end: 0 };
    });
    if (mvex) all(kids(dv, mvex), "trex").forEach(function (t) { defDur[dv.getUint32(t.start + 12)] = dv.getUint32(t.start + 20); });
    var absOffsets = [];   // tfhd base_data_offset fields (absolute positions) that move if we insert bytes
    all(top, "moof").forEach(function (moof) {
      all(kids(dv, moof), "traf").forEach(function (traf) {
        var tk = kids(dv, traf), tfhd = first(tk, "tfhd"), tfdt = first(tk, "tfdt"); if (!tfhd) return;
        var fl = dv.getUint32(tfhd.start + 8) & 0xffffff, id = dv.getUint32(tfhd.start + 12), p = tfhd.start + 16;
        if (fl & 1) { absOffsets.push(p); p += 8; }
        if (fl & 2) p += 4;
        var dDur = (fl & 8) ? dv.getUint32(p) : (defDur[id] || 0);
        var base = 0;
        if (tfdt) base = dv.getUint8(tfdt.start + 8) ? u64(dv, tfdt.start + 12) : dv.getUint32(tfdt.start + 12);
        var sum = 0;
        all(tk, "trun").forEach(function (trun) {
          var f = dv.getUint32(trun.start + 8) & 0xffffff, n = dv.getUint32(trun.start + 12), q = trun.start + 16;
          if (f & 1) q += 4;
          if (f & 4) q += 4;
          var per = ((f & 0x100) ? 4 : 0) + ((f & 0x200) ? 4 : 0) + ((f & 0x400) ? 4 : 0) + ((f & 0x800) ? 4 : 0);
          for (var i = 0; i < n; i++) { sum += (f & 0x100) ? dv.getUint32(q) : dDur; q += per; }
        });
        if (tracks[id]) tracks[id].end = Math.max(tracks[id].end, base + sum);
      });
    });
    var movieDur = 0;
    Object.keys(tracks).forEach(function (id) {
      var t = tracks[id];
      var secs = t.end > 0 && t.ts ? t.end / t.ts : ms / 1000;
      var mediaDur = Math.round(secs * t.ts), trackDur = Math.round(secs * movieTs);
      movieDur = Math.max(movieDur, trackDur);
      if (t.hv) { dv.setUint32(t.mdhd.start + 32, Math.floor(mediaDur / 4294967296)); dv.setUint32(t.mdhd.start + 36, mediaDur >>> 0); }
      else dv.setUint32(t.mdhd.start + 24, mediaDur >>> 0);
      if (t.tv) { dv.setUint32(t.tkhd.start + 36, Math.floor(trackDur / 4294967296)); dv.setUint32(t.tkhd.start + 40, trackDur >>> 0); }
      else dv.setUint32(t.tkhd.start + 28, trackDur >>> 0);
    });
    if (!movieDur) movieDur = Math.round(ms / 1000 * movieTs);
    if (mv) { dv.setUint32(mvhd.start + 32, Math.floor(movieDur / 4294967296)); dv.setUint32(mvhd.start + 36, movieDur >>> 0); }
    else dv.setUint32(mvhd.start + 24, movieDur >>> 0);
    // fragmented files: players read the total from mehd (Movie Extends Header)
    if (!mvex || mvex.hdr !== 8) return new Blob([buf]);
    var mehd = first(kids(dv, mvex), "mehd");
    if (mehd) { dv.setUint32(mehd.start + 12, movieDur >>> 0); return new Blob([buf]); }
    var add = new DataView(new ArrayBuffer(16));
    add.setUint32(0, 16); add.setUint8(4, 0x6d); add.setUint8(5, 0x65); add.setUint8(6, 0x68); add.setUint8(7, 0x64);   // "mehd"
    add.setUint32(8, 0); add.setUint32(12, movieDur >>> 0);
    dv.setUint32(moov.start, moov.size + 16);
    dv.setUint32(mvex.start, mvex.size + 16);
    absOffsets.forEach(function (p) { var v = u64(dv, p) + 16; dv.setUint32(p, Math.floor(v / 4294967296)); dv.setUint32(p + 4, v >>> 0); });
    var at = mvex.start + 8;
    return new Blob([buf.slice(0, at), add.buffer, buf.slice(at)]);
  }

  /* EBML (WebM) helpers */
  function vint(u, p) {
    var b = u[p], len = 1, mask = 0x80;
    while (len <= 8 && !(b & mask)) { mask >>= 1; len++; }
    if (len > 8) return null;
    var val = b & (mask - 1), ones = val === mask - 1;
    for (var i = 1; i < len; i++) { val = val * 256 + u[p + i]; if (u[p + i] !== 255) ones = false; }
    return { len: len, val: val, unknown: ones };
  }
  function idLen(b) { return b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : 4; }
  function fixWebm(buf, ms) {
    var u = new Uint8Array(buf), p = 0;
    // EBML header
    if (u[0] !== 0x1a || u[1] !== 0x45) return null;
    var h = vint(u, 4); p = 4 + h.len + h.val;
    // Segment
    if (!(u[p] === 0x18 && u[p + 1] === 0x53 && u[p + 2] === 0x80 && u[p + 3] === 0x67)) return null;
    var segSize = vint(u, p + 4), segSizeAt = p + 4, q = p + 4 + segSize.len;
    for (var guard = 0; guard < 32 && q < u.length; guard++) {
      var il = idLen(u[q]), id = 0;
      for (var k = 0; k < il; k++) id = id * 256 + u[q + k];
      var sz = vint(u, q + il); if (!sz) return null;
      var bodyAt = q + il + sz.len;
      if (id === 0x1549a966) {                                   // Info
        var r = bodyAt, end = bodyAt + sz.val, scale = 1000000;
        while (r < end) {
          var cl = idLen(u[r]), cid = 0;
          for (var j = 0; j < cl; j++) cid = cid * 256 + u[r + j];
          var cs = vint(u, r + cl), cb = r + cl + cs.len;
          if (cid === 0x2ad7b1) { scale = 0; for (var m = 0; m < cs.val; m++) scale = scale * 256 + u[cb + m]; }
          if (cid === 0x4489) return null;                         // already has a Duration — leave it
          r = cb + cs.val;
        }
        var dur = new DataView(new ArrayBuffer(11));
        dur.setUint8(0, 0x44); dur.setUint8(1, 0x89); dur.setUint8(2, 0x88);
        dur.setFloat64(3, ms * 1e6 / (scale || 1000000));
        // rewrite Info with an 8-byte size field (valid EBML, any length fits)
        var newSize = sz.val + 11, head = new Uint8Array(4 + 8);
        head.set(u.subarray(q, q + 4), 0); head[4] = 0x01;
        for (var b = 0, v = newSize; b < 7; b++) { head[11 - b] = v % 256; v = Math.floor(v / 256); }
        var grow = head.length + newSize - (il + sz.len + sz.val);
        if (!segSize.unknown) {                                    // known Segment size → grow it (same width)
          var nv = segSize.val + grow, w = segSize.len;
          if (nv >= Math.pow(2, 7 * w) - 1) return null;
          for (var s = w - 1; s >= 0; s--) { u[segSizeAt + s] = nv % 256; nv = Math.floor(nv / 256); }
          u[segSizeAt] |= 0x80 >> (w - 1);
        }
        return new Blob([buf.slice(0, q), head, buf.slice(bodyAt, end), dur.buffer, buf.slice(end)]);
      }
      if (sz.unknown) return null;
      q = bodyAt + sz.val;
    }
    return null;
  }

  R.fixDuration = function (blob, ms) {
    return blob.arrayBuffer().then(function (buf) {
      var fixed = null;
      try { fixed = /mp4/.test(blob.type) ? fixMp4(buf, ms) : fixWebm(buf, ms); } catch (e) { fixed = null; }
      return fixed ? new Blob([fixed], { type: blob.type }) : blob;
    }).catch(function () { return blob; });
  };
})();
