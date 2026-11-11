/* TADA stage 2: home screen, notes, search, filters, theme, setup check. */
(function () {
  'use strict';

  var APP_VERSION = '1.1.0';
  var THEME_KEY = 'tada.theme';
  var THEME_COLORS = { light: '#F4F5F1', dark: '#121316' };
  var SAVE_DELAY = 400;

  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function $(id) { return document.getElementById(id); }

  /* =====================================================
     Theme
     ===================================================== */

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

  /* =====================================================
     Storage (IndexedDB). Everything lives in `items`
     (in memory) and is written through to the database.
     ===================================================== */

  var DB_NAME = 'tada';
  var STORE = 'items';
  var db = null;
  var dbOk = true;
  var items = [];

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB missing')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbGetAll() {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbPut(item) {
    return new Promise(function (resolve, reject) {
      if (!db) { reject(new Error('No database')); return; }
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Aborted')); };
    });
  }

  function dbDelete(id) {
    return new Promise(function (resolve, reject) {
      if (!db) { reject(new Error('No database')); return; }
      var tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Aborted')); };
    });
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function findItem(id) {
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  /* =====================================================
     Small helpers
     ===================================================== */

  function formatWhen(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    var d = new Date(ts);
    var n = new Date();
    var startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    var startYesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime();
    var startWeek = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6).getTime();
    if (ts >= startToday) {
      return 'Today, ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (ts >= startYesterday) return 'Yesterday';
    if (ts >= startWeek) return d.toLocaleDateString([], { weekday: 'long' });
    var opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== n.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString([], opts);
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function pinIcon(size) {
    var wrap = document.createElement('span');
    wrap.className = 'pin-mark';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Pinned');
    wrap.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
    return wrap;
  }

  /* =====================================================
     Navigation between Home / Editor / Settings
     ===================================================== */

  var views = { home: $('view-home'), editor: $('view-editor'), settings: $('view-settings') };
  var ready = false;
  var openedByApp = false;

  function showView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    window.scrollTo(0, 0);
  }

  function closeView() {
    if (openedByApp) {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      route();
    }
  }

  function route() {
    if (!ready) return;
    var hash = location.hash;

    if (current) leaveEditor();

    var m = /^#note-([a-z0-9]+)$/.exec(hash);
    if (m) {
      var item = findItem(m[1]) || (draft && draft.id === m[1] ? draft : null);
      if (item) {
        showView('editor');
        openEditor(item);
        return;
      }
      history.replaceState(null, '', location.pathname + location.search);
      hash = '';
    }

    if (hash === '#settings') {
      showView('settings');
      $('settings-title').focus({ preventScroll: true });
      return;
    }

    openedByApp = false;
    showView('home');
    renderList();
  }

  window.addEventListener('hashchange', route);

  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (link) openedByApp = true;
  });

  $('settings-back').addEventListener('click', function () {
    closeView();
    $('open-settings').focus();
  });

  /* =====================================================
     Home: toolbar, search, filters, list
     ===================================================== */

  var state = { query: '', filter: 'all', searchOpen: false };
  var listArea = $('list-area');

  function searchText(it) {
    var text = (it.title || '') + ' ' + (it.body || '');
    if (it.items && it.items.length) {
      text += ' ' + it.items.map(function (t) { return t.text || ''; }).join(' ');
    }
    return text.toLowerCase();
  }

  function sortedVisible() {
    var q = state.query.trim().toLowerCase();
    return items.filter(function (it) {
      if (state.filter !== 'all' && it.type !== state.filter) return false;
      return !q || searchText(it).indexOf(q) !== -1;
    }).sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  function updateToolbar() {
    $('chip-note').setAttribute('aria-pressed', String(state.filter === 'note'));
    $('chip-list').setAttribute('aria-pressed', String(state.filter === 'list'));
    $('btn-search').setAttribute('aria-pressed', String(state.searchOpen));
    $('searchbar').hidden = !state.searchOpen;
    $('search-clear').hidden = state.query === '';
  }

  function emptyState(totalVisibleFilter) {
    var box = document.createElement('section');
    box.className = 'empty';
    var title, text, showButton = false;
    var searching = state.query.trim() !== '';

    if (searching) {
      title = 'No matches';
      text = 'Try different words, or clear the search or filter.';
    } else if (state.filter === 'list') {
      title = 'No checklists yet';
      text = 'Checklists arrive in the next update.';
    } else if (state.filter === 'note' && items.length) {
      title = 'No notes yet';
      text = 'Tap the + button to write your first note.';
    } else {
      title = 'No notes yet';
      text = 'Write something down and it will show up here. Everything stays on this phone.';
      showButton = true;
    }

    box.innerHTML =
      '<svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">' +
      '<rect x="26" y="30" width="80" height="80" rx="22" fill="var(--accent)"/>' +
      '<path d="M48 70l13 13 25-27" fill="none" stroke="var(--on-accent)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="22" cy="24" r="5" fill="#FFC247"/><circle cx="112" cy="20" r="4" fill="#4DE0B0"/>' +
      '<rect x="108" y="56" width="10" height="10" rx="2" transform="rotate(20 113 61)" fill="#FF7AA8"/>' +
      '<rect x="10" y="64" width="9" height="9" rx="2" transform="rotate(-15 14 68)" fill="#4DE0B0"/>' +
      '<circle cx="66" cy="12" r="4" fill="#FF7AA8"/>' +
      '<rect x="92" y="112" width="9" height="9" rx="2" transform="rotate(30 96 116)" fill="#FFC247"/></svg>';
    var h = document.createElement('h2'); h.textContent = title;
    var p = document.createElement('p'); p.textContent = text;
    box.appendChild(h); box.appendChild(p);
    if (showButton) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.id = 'empty-new';
      b.textContent = 'New note';
      b.addEventListener('click', createNote);
      box.appendChild(b);
    }
    return box;
  }

  function cardEl(it) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'card-item';
    a.href = '#' + (it.type === 'list' ? 'list-' : 'note-') + it.id;

    var head = document.createElement('div');
    head.className = 'card-head';
    var title = document.createElement('span');
    title.className = 'item-title';
    var hasTitle = (it.title || '').trim() !== '';
    if (!hasTitle) title.classList.add('is-empty');
    title.textContent = hasTitle ? it.title : (it.type === 'list' ? 'Untitled list' : 'Untitled note');
    head.appendChild(title);
    if (it.pinned) head.appendChild(pinIcon(16));
    a.appendChild(head);

    var preview = document.createElement('p');
    preview.className = 'card-preview';
    var body = (it.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    preview.textContent = body || 'No additional text';
    a.appendChild(preview);

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    var tag = document.createElement('span');
    tag.className = 'tag ' + (it.type === 'list' ? 'tag-list' : 'tag-note');
    tag.textContent = it.type === 'list' ? 'List' : 'Note';
    var when = document.createElement('span');
    when.textContent = formatWhen(it.updatedAt);
    meta.appendChild(tag); meta.appendChild(when);
    a.appendChild(meta);

    li.appendChild(a);
    return li;
  }

  function addSection(heading, list) {
    var sec = document.createElement('section');
    if (heading) {
      var h = document.createElement('h2');
      h.className = 'section-title';
      h.textContent = heading;
      sec.appendChild(h);
    }
    var ul = document.createElement('ul');
    ul.className = 'cards';
    list.forEach(function (it) { ul.appendChild(cardEl(it)); });
    sec.appendChild(ul);
    listArea.appendChild(sec);
  }

  function renderList() {
    updateToolbar();
    listArea.textContent = '';
    var visible = sortedVisible();
    var count = $('result-count');
    var filtering = state.query.trim() !== '' || state.filter !== 'all';

    if (filtering && visible.length) {
      count.textContent = visible.length + (visible.length === 1 ? ' result' : ' results');
      count.hidden = false;
    } else {
      count.textContent = '';
      count.hidden = true;
    }

    if (!visible.length) {
      listArea.appendChild(emptyState());
      return;
    }
    var pinned = visible.filter(function (it) { return it.pinned; });
    var others = visible.filter(function (it) { return !it.pinned; });
    if (pinned.length) {
      addSection('Pinned', pinned);
      if (others.length) addSection('Recent', others);
    } else {
      addSection(null, others);
    }
  }

  $('btn-search').addEventListener('click', function () {
    state.searchOpen = !state.searchOpen;
    if (!state.searchOpen) {
      state.query = '';
      $('search-input').value = '';
    }
    renderList();
    if (state.searchOpen) $('search-input').focus();
  });

  $('search-input').addEventListener('input', function (e) {
    state.query = e.target.value;
    renderList();
  });

  $('search-clear').addEventListener('click', function () {
    state.query = '';
    $('search-input').value = '';
    renderList();
    $('search-input').focus();
  });

  function toggleFilter(kind) {
    state.filter = state.filter === kind ? 'all' : kind;
    renderList();
  }
  $('chip-note').addEventListener('click', function () { toggleFilter('note'); });
  $('chip-list').addEventListener('click', function () { toggleFilter('list'); });

  /* Add sheet */
  var dlgAdd = $('dlg-add');
  $('btn-add').addEventListener('click', function () { dlgAdd.showModal(); });
  $('add-cancel').addEventListener('click', function () { dlgAdd.close(); });
  $('add-note').addEventListener('click', function () { dlgAdd.close(); createNote(); });
  dlgAdd.addEventListener('click', function (e) { if (e.target === dlgAdd) dlgAdd.close(); });

  /* =====================================================
     Note editor with autosave
     ===================================================== */

  var current = null;   // the note being edited
  var draft = null;     // a brand-new note that has no text yet (not saved)
  var dirty = false;
  var saveTimer = null;

  var titleEl = $('note-title');
  var bodyEl = $('note-body');
  var statusEl = $('save-status');
  var editedEl = $('edited-at');
  var pinBtn = $('editor-pin');

  function inItems(it) { return items.indexOf(it) !== -1; }

  function autosize() {
    bodyEl.style.height = 'auto';
    bodyEl.style.height = bodyEl.scrollHeight + 'px';
  }

  function setStatus(text) { statusEl.textContent = text; }

  function setEdited() {
    editedEl.textContent = inItems(current) ? 'Edited ' + formatWhen(current.updatedAt) : '';
  }

  function setPinUi() {
    var on = !!current.pinned;
    pinBtn.setAttribute('aria-pressed', String(on));
    pinBtn.setAttribute('aria-label', on ? 'Unpin note' : 'Pin note');
    pinBtn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
  }

  function createNote() {
    var now = Date.now();
    draft = { id: newId(), type: 'note', title: '', body: '', pinned: false, createdAt: now, updatedAt: now };
    openedByApp = true;
    location.hash = '#note-' + draft.id;
  }

  function openEditor(item) {
    current = item;
    dirty = false;
    titleEl.value = item.title || '';
    bodyEl.value = item.body || '';
    setPinUi();
    setStatus(inItems(item) ? (dbOk ? 'Saved' : 'Not saved') : 'Not saved yet');
    setEdited();
    autosize();
    if (!inItems(item)) titleEl.focus();
  }

  function onEdit() {
    if (!current) return;
    current.title = titleEl.value;
    current.body = bodyEl.value;
    autosize();

    var empty = current.title.trim() === '' && current.body.trim() === '';
    if (!inItems(current)) {
      if (empty) { setStatus('Not saved yet'); return; }
      items.push(current);
      draft = null;
    }
    current.updatedAt = Date.now();
    dirty = true;
    setStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (!current || !dirty || !inItems(current)) return Promise.resolve();
    var it = current;
    dirty = false;
    return dbPut(it).then(function () {
      if (current === it) { setStatus('Saved'); setEdited(); }
    }).catch(function () {
      dirty = true;
      dbOk = false;
      $('storage-banner').hidden = false;
      if (current === it) setStatus('Could not save');
    });
  }

  function leaveEditor() {
    var it = current;
    flushSave();
    clearTimeout(saveTimer);
    current = null;
    dirty = false;
    if (it && !inItems(it) && draft === it) draft = null; // empty new note: discard
  }

  titleEl.addEventListener('input', onEdit);
  bodyEl.addEventListener('input', onEdit);
  titleEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); }
  });

  $('editor-back').addEventListener('click', closeView);

  pinBtn.addEventListener('click', function () {
    if (!current) return;
    if (!inItems(current)) { toast('Write something first, then pin it.'); return; }
    current.pinned = !current.pinned;
    setPinUi();
    dbPut(current).catch(function () { toast('Could not save the pin.'); });
    toast(current.pinned ? 'Pinned to the top' : 'Unpinned');
  });

  /* Delete with confirmation */
  var dlgDelete = $('dlg-delete');

  $('editor-delete').addEventListener('click', function () {
    if (!current) return;
    if (!inItems(current)) { // nothing was written yet, just leave
      closeView();
      return;
    }
    dlgDelete.showModal();
  });
  $('del-cancel').addEventListener('click', function () { dlgDelete.close(); });
  dlgDelete.addEventListener('click', function (e) { if (e.target === dlgDelete) dlgDelete.close(); });

  $('del-confirm').addEventListener('click', function () {
    dlgDelete.close();
    if (!current) return;
    var it = current;
    items.splice(items.indexOf(it), 1);
    clearTimeout(saveTimer);
    dirty = false;
    current = null;
    dbDelete(it.id).catch(function () { toast('Could not delete from storage.'); });
    closeView();
    toast('Note deleted');
  });

  /* Save when the app is hidden or closed */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);

  /* =====================================================
     Theme chooser + version
     ===================================================== */

  var currentTheme = getStoredTheme();
  Array.prototype.forEach.call(document.querySelectorAll('input[name="theme"]'), function (input) {
    input.checked = input.value === currentTheme;
    input.addEventListener('change', function () {
      if (input.checked) saveTheme(input.value);
    });
  });

  $('version').textContent = APP_VERSION;

  /* =====================================================
     Setup check (now inside Settings)
     ===================================================== */

  function setRow(name, state2, text) {
    var row = $('row-' + name);
    if (!row) return;
    row.setAttribute('data-state', state2);
    row.querySelector('.status-text').textContent = text;
  }

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

    // Tell the person when a newer version has been installed in the background.
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) $('update-banner').hidden = false;
      hadController = true;
    });
  }

  $('update-reload').addEventListener('click', function () {
    Promise.resolve(flushSave()).then(function () { location.reload(); });
  });

  function checkStorage() {
    setRow('storage', dbOk ? 'ok' : 'bad', dbOk ? 'Ready' : 'Not available');
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  }

  var installBtn = $('install-btn');
  var installHint = $('install-hint');
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
    if (isInstalled()) showInstalled(); else showNotInstalled();
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

  /* =====================================================
     Start
     ===================================================== */

  checkOffline();
  checkInstall();

  openDb().then(function (opened) {
    db = opened;
    return dbGetAll();
  }).then(function (all) {
    items = all;
  }).catch(function () {
    dbOk = false;
    $('storage-banner').hidden = false;
  }).then(function () {
    checkStorage();
    ready = true;
    route();
  });
})();
