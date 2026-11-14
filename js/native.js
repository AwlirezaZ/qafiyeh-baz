/*
 * Native (Android app) integration via Capacitor. Does nothing on the website.
 * Inside the app, Capacitor's bridge defines window.Capacitor before this runs; we then load the
 * plugin bundles that build-web copied into www/vendor/ and expose a tiny API on QB.native.
 */
(function () {
  var QB = window.QB;
  var cap = window.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  var N = QB.native = { is: isNative, App: null, Share: null, Filesystem: null, Directory: null };
  if (!isNative) {
    // website: same API, all no-ops, so callers never need to check
    var no = function () { return Promise.reject(new Error("not in the app")); };
    N.ready = Promise.resolve(N);
    N.onBack = function () {}; N.exit = function () {};
    N.shareText = no; N.shareFile = no; N.saveFile = no;
    return;
  }
  document.documentElement.classList.add("is-native");

  function load(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  N.ready = load("vendor/capacitor.js")
    .then(function () { return Promise.all([load("vendor/app.js"), load("vendor/share.js"), load("vendor/filesystem.js")]); })
    .then(function () {
      N.App = window.capacitorApp && window.capacitorApp.App;
      N.Share = window.capacitorShare && window.capacitorShare.Share;
      var fs = window.capacitorFilesystemPluginCapacitor;
      N.Filesystem = fs && fs.Filesystem; N.Directory = fs && fs.Directory;
      return N;
    })
    .catch(function () { return N; });

  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(",")[1]); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  /* Android hardware back button */
  N.onBack = function (fn) {
    N.ready.then(function () { if (N.App) N.App.addListener("backButton", fn); });
  };
  N.exit = function () { if (N.App) N.App.exitApp(); };

  /* share plain text + link (daily challenge) */
  N.shareText = function (title, text, url) {
    return N.ready.then(function () { return N.Share.share({ title: title, text: text, url: url, dialogTitle: title }); });
  };

  /* share a recorded video through Android's share sheet (Telegram, Instagram, …) */
  N.shareFile = function (blob, name) {
    return N.ready.then(function () { return toBase64(blob); }).then(function (data) {
      return N.Filesystem.writeFile({ path: name, data: data, directory: N.Directory.Cache });
    }).then(function (w) {
      return N.Share.share({ title: "قافیه‌باز", files: [w.uri], dialogTitle: "اشتراک ویدیو" });
    });
  };

  /* save a recorded video to Documents/Qafiyeh-Baz (visible in the phone's file manager) */
  N.saveFile = function (blob, name) {
    return N.ready.then(function () {
      return N.Filesystem.requestPermissions().catch(function () {});   // only matters on Android ≤ 9
    }).then(function () { return toBase64(blob); }).then(function (data) {
      return N.Filesystem.writeFile({ path: "Qafiyeh-Baz/" + name, data: data, directory: N.Directory.Documents, recursive: true });
    });
  };
})();
