/*
 * Native (Android app) integration via Capacitor. On the website every helper is a no-op.
 * Inside the app, Capacitor's bridge defines window.Capacitor before this runs. We talk to the
 * native plugins straight through it (nativePromise / addListener) — no extra JS bundles needed.
 */
(function () {
  var QB = window.QB;
  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  var N = QB.native = { is: isNative };
  if (!isNative) {
    // website: same API, all no-ops, so callers never need to check
    var no = function () { return Promise.reject(new Error("not in the app")); };
    N.ready = Promise.resolve(N);
    N.onBack = function () {}; N.exit = function () {};
    N.shareText = no; N.shareFile = no; N.saveFile = no;
    return;
  }
  document.documentElement.classList.add("is-native");
  N.ready = Promise.resolve(N);

  function call(plugin, method, opts) { return cap.nativePromise(plugin, method, opts || {}); }
  N.errText = function (e) { return (e && (e.message || e.errorMessage || e.code)) || String(e); };

  /* Android hardware back button */
  N.onBack = function (fn) { cap.addListener("App", "backButton", fn); };
  N.exit = function () { call("App", "exitApp").catch(function () {}); };

  /* share plain text + link (daily challenge) */
  N.shareText = function (title, text, url) {
    return call("Share", "share", { title: title, text: text, url: url, dialogTitle: title });
  };

  /* Write a Blob to the app's filesystem in base64 chunks (one huge string over the bridge can fail).
     Chunks are multiples of 3 bytes so every piece is valid base64 on its own. */
  var CHUNK = 3 * 256 * 1024;   // 768 KB raw → 1 MB base64
  function b64(buf) {
    var bin = "", bytes = new Uint8Array(buf), step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }
  function writeBlob(blob, path, directory) {
    return blob.arrayBuffer().then(function (buf) {
      var p = Promise.resolve(), first = true;
      for (var off = 0; off < buf.byteLength; off += CHUNK) {
        (function (piece, isFirst) {
          p = p.then(function () {
            return call("Filesystem", isFirst ? "writeFile" : "appendFile",
              { path: path, data: b64(piece), directory: directory, recursive: true });
          });
        })(buf.slice(off, off + CHUNK), first);
        first = false;
      }
      return p.then(function () { return call("Filesystem", "getUri", { path: path, directory: directory }); });
    });
  }

  /* share a recorded video through Android's share sheet (Telegram, Instagram, …) */
  N.shareFile = function (blob, name) {
    return writeBlob(blob, name, "CACHE").then(function (r) {
      return call("Share", "share", { files: [r.uri], dialogTitle: "اشتراک ویدیو" });
    });
  };

  /* save a recorded video where the gallery can see it: Movies/Qafiyeh-Baz.
     (Android 11+ needs no permission for this; Android 10 and older ask once.)
     The file is first built in the app's cache (chunk by chunk, like sharing), then copied to Movies in one
     step: Android's media index reads a gallery file when it's first closed, so writing it there in chunks
     left the gallery with only the first chunk (~3 s). Falls back to Documents/Qafiyeh-Baz.
     Resolves to the folder used. */
  N.saveFile = function (blob, name) {
    var tmp = "save-" + name;
    function copyTo(folder, directory) {
      return call("Filesystem", "mkdir", { path: folder, directory: directory, recursive: true }).catch(function () {})
        .then(function () {
          return call("Filesystem", "copy", { from: tmp, directory: "CACHE", to: folder + "/" + name, toDirectory: directory });
        });
    }
    return writeBlob(blob, tmp, "CACHE")
      .then(function () { return call("Filesystem", "requestPermissions").catch(function () {}); })
      .then(function () { return copyTo("Movies/Qafiyeh-Baz", "EXTERNAL_STORAGE"); })
      .then(function () { return "Movies/Qafiyeh-Baz"; }, function () {
        return copyTo("Qafiyeh-Baz", "DOCUMENTS").then(function () { return "Documents/Qafiyeh-Baz"; });
      })
      .then(function (where) {
        call("Filesystem", "deleteFile", { path: tmp, directory: "CACHE" }).catch(function () {});
        return where;
      });
  };
})();
