/* TADA stage 1: app shell, theme, setup check. */
(function () {
  'use strict';

  var APP_VERSION = '1.0.0';
  var THEME_KEY = 'tada.theme';
  var THEME_COLORS = { light: '#F4F5F1', dark: '#121316' };

  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  /* ---------- Theme ---------- */

  function getStoredTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark' || t === 'system') return t;
    } catch (e) {}
    return 'system';
  }

  function effectiveTheme(mode) {
    if (mode === 'system') return media.matches ? 'dark' : 'light';
    return mode;
  }

  function applyTheme(mode) {
    root.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[effectiveTheme(mode)]);
  }

  function saveTheme(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    applyTheme(mode);
  }

  function onSystemThemeChange() {
    if (getStoredTheme() === 'system') applyTheme('system');
  }
  if (media.addEventListener) media.addEventListener('change', onSystemThemeChange);
  else if (media.addListener) media.addListener(onSystemThemeChange);

  applyTheme(getStoredTheme());

  /* ---------- Views (Home / Settings) ---------- */

  var viewHome = document.getElementById('view-home');
  var viewSettings = document.getElementById('view-settings');
  var openSettings = document.getElementById('open-settings');
  var backBtn = document.getElementById('settings-back');
  var settingsTitle = document.getElementById('settings-title');
  var openedByApp = false;

  function route() {
    var showSettings = location.hash === '#settings';
    viewHome.hidden = showSettings;
    viewSettings.hidden = !showSettings;
    window.scrollTo(0, 0);
    if (showSettings) {
      settingsTitle.focus({ preventScroll: true });
    } else {
      openedByApp = false;
    }
  }

  openSettings.addEventListener('click', function () { openedByApp = true; });

  backBtn.addEventListener('click', function () {
    if (openedByApp) {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      route();
      openSettings.focus();
    }
  });

  window.addEventListener('hashchange', route);
  route();

  /* ---------- Theme chooser ---------- */

  var themeInputs = document.querySelectorAll('input[name="theme"]');
  var currentTheme = getStoredTheme();
  Array.prototype.forEach.call(themeInputs, function (input) {
    input.checked = input.value === currentTheme;
    input.addEventListener('change', function () {
      if (input.checked) saveTheme(input.value);
    });
  });

  document.getElementById('version').textContent = APP_VERSION;

  /* ---------- Setup check ---------- */

  function setRow(name, state, text) {
    var row = document.getElementById('row-' + name);
    if (!row) return;
    row.setAttribute('data-state', state);
    row.querySelector('.status-text').textContent = text;
  }

  // 1) Works offline: is a saved copy of the app on this phone?
  function checkOffline() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) {
      setRow('offline', 'bad', 'Not supported here');
      return;
    }
    setRow('offline', 'wait', 'Saving a copy…');
    navigator.serviceWorker.register('sw.js').then(function () {
      return navigator.serviceWorker.ready;
    }).then(function () {
      return caches.match('index.html');
    }).then(function (found) {
      if (found) setRow('offline', 'ok', 'Ready');
      else setRow('offline', 'wait', 'Still saving, reopen in a moment');
    }).catch(function () {
      setRow('offline', 'bad', 'Could not save a copy');
    });
  }

  // 2) Saves on this phone: can the browser store data?
  function checkStorage() {
    var ok = false;
    try {
      localStorage.setItem('tada.check', '1');
      ok = localStorage.getItem('tada.check') === '1';
      localStorage.removeItem('tada.check');
    } catch (e) {}
    if (!ok || !window.indexedDB) {
      setRow('storage', 'bad', 'Not available');
      return;
    }
    try {
      var req = indexedDB.open('tada-check', 1);
      req.onsuccess = function () {
        req.result.close();
        indexedDB.deleteDatabase('tada-check');
        setRow('storage', 'ok', 'Ready');
      };
      req.onerror = function () { setRow('storage', 'bad', 'Not available'); };
    } catch (e) {
      setRow('storage', 'bad', 'Not available');
    }
    // Ask the browser not to clear TADA's data when the phone is low on space.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  }

  // 3) Installed as an app
  var installBtn = document.getElementById('install-btn');
  var installHint = document.getElementById('install-hint');
  var deferredPrompt = null;

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function showInstalled() {
    setRow('install', 'ok', 'Yes');
    installBtn.hidden = true;
    installHint.hidden = true;
  }

  function showNotInstalled() {
    setRow('install', 'todo', 'Not yet');
    if (deferredPrompt) {
      installBtn.hidden = false;
      installHint.hidden = true;
    } else {
      installBtn.hidden = true;
      installHint.hidden = false;
      installHint.textContent = 'To install: tap the ⋮ menu in Chrome, then tap Install app (or Add to Home screen).';
    }
  }

  function checkInstall() {
    if (isInstalled()) showInstalled();
    else showNotInstalled();
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    if (!isInstalled()) showNotInstalled();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    showInstalled();
  });

  installBtn.addEventListener('click', function () {
    if (!deferredPrompt) return;
    var promptEvent = deferredPrompt;
    deferredPrompt = null;
    installBtn.hidden = true;
    promptEvent.prompt();
    Promise.resolve(promptEvent.userChoice).then(function (choice) {
      if (choice && choice.outcome === 'accepted') showInstalled();
      else showNotInstalled();
    });
  });

  checkOffline();
  checkStorage();
  checkInstall();
})();
