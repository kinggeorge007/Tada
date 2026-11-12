/* TADA stage 5: notes, checklists with price totals, calculator, bottom bar layout, search, filters, theme, setup check. */
(function () {
  'use strict';

  var APP_VERSION = '1.5.0';
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
     A note:  { id, type:'note', title, body, pinned, createdAt, updatedAt }
     A list:  { id, type:'list', title, body:'', items:[{id,text,done}], pinned, createdAt, updatedAt }
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

  function hasText(t) { return (t.text || '').trim() !== ''; }

  // What actually gets stored: lists never keep blank tasks.
  function persistable(it) {
    if (it.type !== 'list') return it;
    var copy = {};
    Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
    copy.items = it.items.filter(hasText).map(function (t) {
      return { id: t.id, text: t.text, done: !!t.done };
    });
    return copy;
  }

  function listStats(it) {
    var tasks = (it.items || []).filter(hasText);
    var done = tasks.filter(function (t) { return t.done; }).length;
    return { total: tasks.length, done: done, tasks: tasks };
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

  /* Toast message, with an optional action button such as Undo */
  // On a card: a clock time for today, otherwise Yesterday / weekday / date
  function formatCardTime(ts) {
    var d = new Date(ts);
    var n = new Date();
    var startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= startToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return formatWhen(ts);
  }

  var toastTimer = null;
  var toastAction = null;

  function hideToast() {
    clearTimeout(toastTimer);
    $('toast').hidden = true;
    toastAction = null;
  }

  function toast(message, actionLabel, actionFn) {
    var btn = $('toast-action');
    $('toast-text').textContent = message;
    if (actionLabel) {
      btn.textContent = actionLabel;
      btn.hidden = false;
      toastAction = actionFn;
    } else {
      btn.hidden = true;
      toastAction = null;
    }
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 6000 : 2600);
  }

  $('toast-action').addEventListener('click', function () {
    var fn = toastAction;
    hideToast();
    if (fn) fn();
  });

  function pinIcon(size) {
    var wrap = document.createElement('span');
    wrap.className = 'pin-mark';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', 'Pinned');
    wrap.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
    return wrap;
  }

  function svgEl(markup) {
    var span = document.createElement('span');
    span.innerHTML = markup;
    return span.firstChild;
  }

  var ICON_X = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var ICON_GRIP = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';

  /* =====================================================
     Navigation between Home / Note / List / Settings
     ===================================================== */

  var views = {
    home: $('view-home'),
    note: $('view-editor'),
    list: $('view-list'),
    calc: $('view-calc'),
    settings: $('view-settings')
  };
  var ready = false;
  var openedByApp = false;

  function showView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    document.body.classList.toggle('has-bar', name === 'home');
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

    if (toastAction) hideToast();   // an Undo button only makes sense on its own screen
    if (current) leaveEditor();

    var m = /^#(note|list)-([a-z0-9]+)$/.exec(hash);
    if (m) {
      var item = findItem(m[2]) || (draft && draft.id === m[2] ? draft : null);
      if (item && item.type === m[1]) {
        showView(item.type);
        openEditor(item);
        return;
      }
      history.replaceState(null, '', location.pathname + location.search);
      hash = '';
    }

    if (hash === '#calculator' && Calc) {
      showView('calc');
      renderCalc();
      $('calc-title').focus({ preventScroll: true });
      return;
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
     Home: toolbar, search, filters, list of cards
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

  function emptyState() {
    var box = document.createElement('section');
    box.className = 'empty';
    var title, text, showButton = false;
    var searching = state.query.trim() !== '';

    if (searching) {
      title = 'No matches';
      text = 'Try different words, or clear the search or filter.';
    } else if (state.filter === 'list') {
      title = 'No checklists yet';
      text = 'Tap the + button to make your first checklist.';
    } else if (state.filter === 'note' && items.length) {
      title = 'No notes yet';
      text = 'Tap the + button to write your first note.';
    } else {
      title = 'Nothing here yet';
      text = 'Write a note or make a checklist and it will show up here. Everything stays on this phone.';
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
    var isList = it.type === 'list';
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'card-item';
    a.href = '#' + (isList ? 'list-' : 'note-') + it.id;

    var head = document.createElement('div');
    head.className = 'card-head';
    var title = document.createElement('span');
    title.className = 'item-title';
    var hasTitle = (it.title || '').trim() !== '';
    if (!hasTitle) title.classList.add('is-empty');
    title.textContent = hasTitle ? it.title : (isList ? 'Untitled list' : 'Untitled note');
    head.appendChild(title);
    if (it.pinned) head.appendChild(pinIcon(16));
    var time = document.createElement('time');
    time.className = 'card-time';
    time.textContent = formatCardTime(it.updatedAt);
    head.appendChild(time);
    a.appendChild(head);

    var stats = isList ? listStats(it) : null;

    if (isList && stats.total > 0 && stats.done < stats.total) {
      // the first few tasks still to do, as bullets
      var open = stats.tasks.filter(function (t) { return !t.done; });
      var ul = document.createElement('ul');
      ul.className = 'card-bullets';
      open.slice(0, 4).forEach(function (t) {
        var b = document.createElement('li');
        b.textContent = t.text.trim();
        ul.appendChild(b);
      });
      if (open.length > 4) {
        var more = document.createElement('li');
        more.className = 'more';
        more.textContent = '+ ' + (open.length - 4) + ' more';
        ul.appendChild(more);
      }
      a.appendChild(ul);
    } else {
      var preview = document.createElement('p');
      preview.className = 'card-preview';
      if (isList) {
        preview.textContent = stats.total === 0 ? 'No tasks yet' : 'All tasks done';
      } else {
        var body = (it.body || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        preview.textContent = body || 'No additional text';
      }
      a.appendChild(preview);
    }

    if (isList && stats.total > 0) {
      var bar = document.createElement('div');
      bar.className = 'mini-bar' + (stats.done === stats.total ? ' complete' : '');
      bar.setAttribute('aria-hidden', 'true');
      var fill = document.createElement('span');
      fill.style.width = Math.round(stats.done / stats.total * 100) + '%';
      bar.appendChild(fill);
      a.appendChild(bar);
    }

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    var tag = document.createElement('span');
    tag.className = 'tag ' + (isList ? 'tag-list' : 'tag-note');
    tag.textContent = isList ? 'List' : 'Note';
    meta.appendChild(tag);
    if (isList && stats.total > 0) {
      var count = document.createElement('span');
      count.className = 'card-count';
      count.textContent = stats.done + ' of ' + stats.total + ' done';
      meta.appendChild(count);
    }
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
      var kind = state.filter === 'note' ? 'notes' : state.filter === 'list' ? 'lists' : '';
      if (state.query.trim() !== '') {
        count.textContent = visible.length + (visible.length === 1 ? ' result' : ' results') + (kind ? ' in ' + kind + ' only' : '');
      } else {
        count.textContent = 'Showing ' + kind + ' only';
      }
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
  $('add-list').addEventListener('click', function () { dlgAdd.close(); createList(); });
  dlgAdd.addEventListener('click', function (e) { if (e.target === dlgAdd) dlgAdd.close(); });

  /* =====================================================
     Editors (shared): autosave, pin, delete
     ===================================================== */

  var current = null;   // the note or list being edited
  var draft = null;     // a brand-new item that has nothing in it yet (not saved)
  var dirty = false;
  var saveTimer = null;

  var ui = {
    note: {
      title: $('note-title'), status: $('save-status'), edited: $('edited-at'),
      pin: $('editor-pin'), del: $('editor-delete'), back: $('editor-back')
    },
    list: {
      title: $('list-title'), status: $('list-save-status'), edited: $('list-edited-at'),
      pin: $('list-pin'), del: $('list-delete'), back: $('list-back')
    }
  };

  function inItems(it) { return items.indexOf(it) !== -1; }

  function isEmptyItem(it) {
    if ((it.title || '').trim() !== '') return false;
    if (it.type === 'list') return !it.items.some(hasText);
    return (it.body || '').trim() === '';
  }

  function setStatus(text) { ui[current.type].status.textContent = text; }

  function setEdited() {
    ui[current.type].edited.textContent = inItems(current) ? 'Edited ' + formatWhen(current.updatedAt) : '';
  }

  function setPinUi() {
    var on = !!current.pinned;
    var kind = current.type === 'list' ? 'list' : 'note';
    var btn = ui[current.type].pin;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', (on ? 'Unpin ' : 'Pin ') + kind);
    btn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
  }

  // Call after any change to the open note or list.
  function markChanged() {
    if (!inItems(current)) {
      if (isEmptyItem(current)) { setStatus('Not saved yet'); return; }
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
    return dbPut(persistable(it)).then(function () {
      if (current === it) { setStatus('Saved'); setEdited(); }
    }).catch(function () {
      dirty = true;
      dbOk = false;
      $('storage-banner').hidden = false;
      if (current === it) setStatus('Could not save');
    });
  }

  function openEditor(item) {
    current = item;
    dirty = false;
    var u = ui[item.type];
    u.title.value = item.title || '';
    setPinUi();
    setStatus(inItems(item) ? (dbOk ? 'Saved' : 'Not saved') : 'Not saved yet');
    setEdited();
    if (item.type === 'note') {
      bodyEl.value = item.body || '';
      autosize();
    } else {
      renderTasks();
      updateProgress();
      newTaskEl.value = '';
    }
    if (!inItems(item)) u.title.focus();
  }

  function leaveEditor() {
    var it = current;
    flushSave();
    clearTimeout(saveTimer);
    if (it && it.type === 'list') it.items = it.items.filter(hasText);
    current = null;
    dirty = false;
    if (it && !inItems(it) && draft === it) draft = null; // nothing was written: discard
  }

  function onPinClick() {
    if (!current) return;
    var kind = current.type === 'list' ? 'list' : 'note';
    if (!inItems(current)) { toast('Add something first, then pin it.'); return; }
    current.pinned = !current.pinned;
    setPinUi();
    dbPut(persistable(current)).catch(function () { toast('Could not save the pin.'); });
    toast(current.pinned ? 'Pinned to the top' : 'Unpinned');
  }

  var dlgDelete = $('dlg-delete');

  function onDeleteClick() {
    if (!current) return;
    if (!inItems(current)) { closeView(); return; }  // nothing written yet, just leave
    var isList = current.type === 'list';
    $('del-title').textContent = isList ? 'Delete this list?' : 'Delete this note?';
    $('del-text').textContent = isList
      ? 'The list and all its tasks will be removed from this phone and can’t be brought back.'
      : 'It will be removed from this phone and can’t be brought back.';
    dlgDelete.showModal();
  }

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
    toast(it.type === 'list' ? 'List deleted' : 'Note deleted');
  });

  ['note', 'list'].forEach(function (kind) {
    ui[kind].pin.addEventListener('click', onPinClick);
    ui[kind].del.addEventListener('click', onDeleteClick);
    ui[kind].back.addEventListener('click', closeView);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);

  /* =====================================================
     Notes
     ===================================================== */

  var titleEl = ui.note.title;
  var bodyEl = $('note-body');

  function autosize() {
    bodyEl.style.height = 'auto';
    bodyEl.style.height = bodyEl.scrollHeight + 'px';
  }

  function createNote() {
    var now = Date.now();
    draft = { id: newId(), type: 'note', title: '', body: '', pinned: false, createdAt: now, updatedAt: now };
    openedByApp = true;
    location.hash = '#note-' + draft.id;
  }

  function onNoteEdit() {
    if (!current || current.type !== 'note') return;
    current.title = titleEl.value;
    current.body = bodyEl.value;
    autosize();
    markChanged();
  }

  titleEl.addEventListener('input', onNoteEdit);
  bodyEl.addEventListener('input', onNoteEdit);
  titleEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); }
  });

  /* =====================================================
     Checklists
     ===================================================== */

  var listTitleEl = ui.list.title;
  var taskListEl = $('task-list');
  var noTasksEl = $('no-tasks');
  var newTaskEl = $('new-task');
  var liveEl = $('list-live');

  function createList() {
    var now = Date.now();
    draft = { id: newId(), type: 'list', title: '', body: '', items: [], pinned: false, createdAt: now, updatedAt: now };
    openedByApp = true;
    location.hash = '#list-' + draft.id;
  }

  function sizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function announce(text) {
    liveEl.textContent = '';
    setTimeout(function () { liveEl.textContent = text; }, 30);
  }

  function updateProgress() {
    var s = listStats(current);
    var pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    var text;
    if (s.total === 0) text = 'No tasks yet';
    else if (s.done === s.total) text = s.total === 1 ? 'Done' : 'All ' + s.total + ' done';
    else text = s.done + ' of ' + s.total + ' done';
    $('progress-text').textContent = text;
    $('progress-fill').style.width = pct + '%';
    var bar = $('progress-bar');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', text);
    bar.classList.toggle('complete', s.total > 0 && s.done === s.total);
    updateTotals();
  }

  /* Total / Cleared / Uncleared of the prices written in the tasks (see calc.js) */
  function updateTotals() {
    var box = $('totals');
    var Money = window.TadaCalc;
    if (!Money || !Money.listTotals || !current || current.type !== 'list') { box.hidden = true; return; }
    var t = Money.listTotals(current.items);
    box.hidden = t.count === 0;
    if (t.count === 0) return;
    $('total-all').textContent = Money.formatMoney(t.total);
    $('total-done').textContent = Money.formatMoney(t.cleared);
    $('total-open').textContent = Money.formatMoney(t.uncleared);
  }

  function taskLabel(t) {
    return (t.done ? 'Mark not done: ' : 'Mark done: ') + (t.text.trim() || 'new task');
  }

  function renderTasks(focusId, focusWhat) {
    taskListEl.textContent = '';
    current.items.forEach(function (t) { taskListEl.appendChild(taskEl(t)); });
    var none = current.items.length === 0;
    taskListEl.hidden = none;
    noTasksEl.hidden = !none;
    Array.prototype.forEach.call(taskListEl.querySelectorAll('textarea'), sizeTextarea);
    if (focusId) {
      var row = taskListEl.querySelector('[data-id="' + focusId + '"]');
      if (row) {
        var target = row.querySelector(focusWhat === 'handle' ? '.task-handle' : 'textarea');
        if (target) target.focus();
      }
    }
  }

  function taskIndex(id) {
    for (var i = 0; i < current.items.length; i++) if (current.items[i].id === id) return i;
    return -1;
  }

  function taskEl(t) {
    var li = document.createElement('li');
    li.className = 'task' + (t.done ? ' done' : '');
    li.setAttribute('data-id', t.id);

    var label = document.createElement('label');
    label.className = 'check';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.done;
    cb.setAttribute('aria-label', taskLabel(t));
    var box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    label.appendChild(cb); label.appendChild(box);

    var ta = document.createElement('textarea');
    ta.className = 'task-text';
    ta.rows = 1;
    ta.value = t.text;
    ta.maxLength = 500;
    ta.setAttribute('aria-label', 'Task');
    ta.setAttribute('enterkeyhint', 'next');
    ta.setAttribute('autocomplete', 'off');

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-btn task-del';
    del.setAttribute('aria-label', 'Delete task');
    del.appendChild(svgEl(ICON_X));

    var handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'task-btn task-handle';
    handle.setAttribute('aria-label', 'Move task. Use the up and down arrow keys, or drag.');
    handle.appendChild(svgEl(ICON_GRIP));

    li.appendChild(label); li.appendChild(ta); li.appendChild(del); li.appendChild(handle);

    cb.addEventListener('change', function () {
      t.done = cb.checked;
      li.classList.toggle('done', t.done);
      cb.setAttribute('aria-label', taskLabel(t));
      updateProgress();
      if (hasText(t)) markChanged();
    });

    ta.addEventListener('input', function () {
      t.text = ta.value;
      sizeTextarea(ta);
      cb.setAttribute('aria-label', taskLabel(t));
      updateProgress();
      markChanged();
    });

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enterInTask(t);
      } else if (e.key === 'Backspace' && ta.value === '') {
        e.preventDefault();
        var i = taskIndex(t.id);
        var prev = i > 0 ? current.items[i - 1].id : null;
        removeTask(t.id, false);
        if (prev) renderTasks(prev, 'text');
        else newTaskEl.focus();
      }
    });

    // Some phone keyboards report Enter this way instead of as a key press.
    ta.addEventListener('beforeinput', function (e) {
      if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
        e.preventDefault();
        enterInTask(t);
      }
    });

    del.addEventListener('click', function () { removeTask(t.id, true); });

    handle.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); moveTask(taskIndex(t.id), taskIndex(t.id) - 1, 'handle'); }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveTask(taskIndex(t.id), taskIndex(t.id) + 1, 'handle'); }
    });
    handle.addEventListener('pointerdown', function (e) { startDrag(e, li, handle); });

    return li;
  }

  function enterInTask(t) {
    if (!hasText(t)) { newTaskEl.focus(); return; }   // Enter on an empty row = finished
    var i = taskIndex(t.id);
    var blank = { id: newId(), text: '', done: false };
    current.items.splice(i + 1, 0, blank);
    renderTasks(blank.id, 'text');
  }

  function addTaskFromInput() {
    var text = newTaskEl.value.trim();
    if (!text) { newTaskEl.focus(); return; }
    var t = { id: newId(), text: text, done: false };
    current.items.push(t);
    newTaskEl.value = '';
    renderTasks();
    updateProgress();
    markChanged();
    var row = taskListEl.querySelector('[data-id="' + t.id + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    newTaskEl.focus();
  }

  function removeTask(id, withUndo) {
    var i = taskIndex(id);
    if (i === -1) return;
    var t = current.items.splice(i, 1)[0];
    var listId = current.id;
    renderTasks();
    updateProgress();
    if (hasText(t)) {
      markChanged();
      if (withUndo) {
        toast('Task deleted', 'Undo', function () {
          if (!current || current.id !== listId) return;
          current.items.splice(Math.min(i, current.items.length), 0, t);
          renderTasks();
          updateProgress();
          markChanged();
        });
      }
    }
  }

  function moveTask(from, to, focusWhat) {
    if (from < 0 || to < 0 || to >= current.items.length || from === to) return;
    var t = current.items.splice(from, 1)[0];
    current.items.splice(to, 0, t);
    renderTasks(t.id, focusWhat);
    if (hasText(t)) markChanged();
    announce('Moved to position ' + (to + 1) + ' of ' + current.items.length);
  }

  /* Drag to reorder (finger or mouse). Rows slide using transforms while you
     drag; the real order is only changed when you let go. */
  function startDrag(e, li, handle) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    var rows = Array.prototype.slice.call(taskListEl.children);
    var from = rows.indexOf(li);
    if (from === -1) return;
    var startScroll = window.scrollY;
    var startY = e.clientY;
    var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
    var centers = rects.map(function (r) { return r.top + startScroll + r.height / 2; });
    var h = rects[from].height;
    var lastY = startY;
    var to = from;
    var active = true;
    var raf = 0;

    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    li.classList.add('dragging');
    rows.forEach(function (r) { if (r !== li) r.classList.add('shifting'); });

    function update() {
      var dy = (lastY - startY) + (window.scrollY - startScroll);
      li.style.transform = 'translateY(' + dy + 'px)';
      var c = centers[from] + dy;
      var idx = 0;
      for (var j = 0; j < rows.length; j++) if (j !== from && centers[j] < c) idx++;
      to = idx;
      rows.forEach(function (r, j) {
        if (j === from) return;
        var shift = 0;
        if (j > from && j <= to) shift = -h;
        else if (j < from && j >= to) shift = h;
        r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }

    function loop() {
      if (!active) return;
      var vh = window.innerHeight;
      if (lastY < 90) window.scrollBy(0, -10);
      else if (lastY > vh - 90) window.scrollBy(0, 10);
      update();
      raf = requestAnimationFrame(loop);
    }

    function onMove(ev) { lastY = ev.clientY; }

    function finish(commit) {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      rows.forEach(function (r) {
        r.style.transform = '';
        r.classList.remove('dragging');
        r.classList.remove('shifting');
      });
      if (commit && to !== from) moveTask(from, to, 'handle');
    }
    function onUp() { finish(true); }
    function onCancel() { finish(false); }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    update();
    raf = requestAnimationFrame(loop);
  }

  listTitleEl.addEventListener('input', function () {
    if (!current || current.type !== 'list') return;
    current.title = listTitleEl.value;
    markChanged();
  });
  listTitleEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); newTaskEl.focus(); }
  });

  newTaskEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addTaskFromInput(); }
  });
  $('add-task-btn').addEventListener('click', addTaskFromInput);

  window.addEventListener('resize', function () {
    if (!current) return;
    if (current.type === 'note') autosize();
    else Array.prototype.forEach.call(taskListEl.querySelectorAll('textarea'), sizeTextarea);
  });


  /* =====================================================
     Calculator (the maths lives in calc.js)
     ===================================================== */

  var Calc = window.TadaCalc || null;   // if calc.js is missing the rest of TADA still works
  if (!Calc) { $('open-calc').hidden = true; $('list-calc').hidden = true; }

  var HIST_KEY = 'tada.calc.history';
  var HIST_MAX = 50;
  var EXPR_MAX = 100;
  var calc = { expr: '', justEvaluated: false, lastExpr: '', error: '' };
  var calcHist = [];
  var calcErrorTimer = null;

  var ERROR_TEXT = {
    div0: 'Can\u2019t divide by zero',
    range: 'Number too large',
    long: 'Expression too long',
    empty: 'Type something first',
    syntax: 'Invalid expression'
  };

  function isOpCh(c) { return c === '+' || c === '\u2212' || c === '\u00D7' || c === '\u00F7'; }
  function isDigitCh(c) { return c !== '' && c >= '0' && c <= '9'; }
  function openCount(e) {
    var n = 0;
    for (var i = 0; i < e.length; i++) {
      if (e.charAt(i) === '(') n++;
      else if (e.charAt(i) === ')') n--;
    }
    return n;
  }

  /* what gets worked out on "=": drop a dangling operator, close open brackets */
  function normalizeExpr(e) {
    e = e.replace(/[+\u2212\u00D7\u00F7.]+$/, '');
    var open = openCount(e);
    while (open-- > 0) e += ')';
    return e;
  }

  function shown(x) { return Calc.format(x).replace(/-/g, '\u2212'); }

  function lastNumber(e) { return /(\d*\.?\d*)$/.exec(e)[1]; }

  function startFresh() {
    if (calc.justEvaluated) { calc.expr = ''; calc.justEvaluated = false; }
  }

  function typeDigit(d) {
    startFresh();
    var e = calc.expr;
    if (e.length >= EXPR_MAX) return;
    var last = e.slice(-1);
    if (last === ')' || last === '%') e += '\u00D7';
    else if (lastNumber(e) === '0') e = e.slice(0, -1);       // 0 then 5 gives 5, never 05
    calc.expr = e + d;
  }

  function typeDot() {
    startFresh();
    var e = calc.expr;
    if (e.length >= EXPR_MAX) return;
    var last = e.slice(-1);
    if (last === ')' || last === '%') e += '\u00D70.';
    else if (isDigitCh(last)) {
      if (lastNumber(e).indexOf('.') !== -1) return;           // only one point per number
      e += '.';
    } else if (last === '.') return;
    else e += '0.';
    calc.expr = e;
  }

  function typeOp(op) {
    calc.justEvaluated = false;                                  // carry on from the answer
    var e = calc.expr;
    if (e === '') { if (op === '\u2212') calc.expr = '\u2212'; return; }
    if (e.length >= EXPR_MAX) return;
    var last = e.slice(-1);
    if (last === '.') { e = e.slice(0, -1); last = e.slice(-1); }
    if (isOpCh(last)) {
      if (op === '\u2212' && (last === '\u00D7' || last === '\u00F7')) { calc.expr = e + '\u2212'; return; }  // 5 x -3
      var stripped = e.replace(/[+\u2212\u00D7\u00F7]+$/, '');
      if (stripped === '' || stripped.slice(-1) === '(') return;
      calc.expr = stripped + op;                                  // pressing another operator swaps it
      return;
    }
    if (last === '(') { if (op === '\u2212') calc.expr = e + '\u2212'; return; }
    calc.expr = e + op;
  }

  function typePercent() {
    calc.justEvaluated = false;
    var e = calc.expr;
    if (e.length >= EXPR_MAX) return;
    var last = e.slice(-1);
    if (isDigitCh(last) || last === ')') calc.expr = e + '%';
  }

  function typeParen(kind) {
    if (calc.justEvaluated) { if (kind === 'close') return; calc.expr = ''; calc.justEvaluated = false; }
    var e = calc.expr;
    var last = e.slice(-1);
    var canClose = openCount(e) > 0 && (isDigitCh(last) || last === ')' || last === '%');
    if (kind === 'smart') kind = canClose ? 'close' : 'open';
    if (e.length >= EXPR_MAX - 1) return;
    if (kind === 'close') { if (canClose) calc.expr = e + ')'; return; }
    if (isDigitCh(last) || last === ')' || last === '%') e += '\u00D7';
    else if (last === '.') e = e.slice(0, -1) + '\u00D7';
    calc.expr = e + '(';
  }

  function calcEquals() {
    if (calc.expr === '' || calc.justEvaluated) return;
    var norm = normalizeExpr(calc.expr);
    var r = norm === '' ? { ok: false, error: 'empty' } : Calc.evaluate(norm);
    if (!r.ok) { showCalcError(r.error); return; }
    var plain = Calc.toPlain(r.value);
    addHistory(norm, plain);
    calc.lastExpr = norm;
    calc.expr = plain.replace('-', '\u2212');
    calc.justEvaluated = true;
    $('calc-live').textContent = norm + ' equals ' + shown(r.value);
  }

  function showCalcError(code) {
    calc.error = ERROR_TEXT[code] || ERROR_TEXT.syntax;
    $('calc-live').textContent = calc.error;
    clearTimeout(calcErrorTimer);
    var shown = calc.error;
    calcErrorTimer = setTimeout(function () {
      if (calc.error === shown) { calc.error = ''; renderCalc(); }
    }, 2600);
  }

  function calcPress(key) {
    if (!Calc) return;
    calc.error = '';
    if (key >= '0' && key <= '9' && key.length === 1) typeDigit(key);
    else if (key === '.') typeDot();
    else if (key === '+') typeOp('+');
    else if (key === '-') typeOp('\u2212');
    else if (key === '*') typeOp('\u00D7');
    else if (key === '/') typeOp('\u00F7');
    else if (key === '%') typePercent();
    else if (key === '(' ) typeParen('open');
    else if (key === ')') typeParen('close');
    else if (key === 'paren') typeParen('smart');
    else if (key === 'AC') { calc.expr = ''; calc.justEvaluated = false; calc.lastExpr = ''; }
    else if (key === 'BACK') { calc.justEvaluated = false; calc.expr = calc.expr.slice(0, -1); }
    else if (key === '=') calcEquals();
    renderCalc();
  }

  function renderCalc() {
    var main = $('calc-main');
    var sub = $('calc-sub');
    var text, subText = '';
    sub.classList.remove('is-error');

    if (calc.justEvaluated) {
      text = shown(Number(calc.expr.replace('\u2212', '-')));
      subText = calc.lastExpr + ' =';
    } else {
      text = calc.expr;
      var norm = normalizeExpr(calc.expr);
      if (norm !== '' && !/^\u2212?\d*\.?\d*$/.test(norm)) {      // show a live answer once it is more than a plain number
        var r = Calc.evaluate(norm);
        if (r.ok) subText = '= ' + shown(r.value);
      }
    }
    if (calc.error) { subText = calc.error; sub.classList.add('is-error'); }

    main.classList.toggle('is-empty', text === '');
    main.textContent = text === '' ? '0' : text;
    var n = main.textContent.length;
    main.classList.toggle('size-m', n > 9 && n <= 13);
    main.classList.toggle('size-s', n > 13 && n <= 18);
    main.classList.toggle('size-xs', n > 18);
    sub.textContent = subText;
    main.scrollLeft = main.scrollWidth;                           // keep the newest digits in view
  }

  $('keypad').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-key]') : null;
    if (!btn) return;
    calcPress(btn.getAttribute('data-key'));
    // After a tap, let the keyboard (Enter, digits) go to the calculator, not to the key you touched.
    // Keyboard users (detail 0) keep their focus where it is.
    if (e.detail > 0) btn.blur();
  });

  $('calc-back').addEventListener('click', closeView);

  /* keyboard (for a Bluetooth keyboard, or testing on a computer) */
  document.addEventListener('keydown', function (e) {
    if (views.calc.hidden || !Calc) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if ((k === 'Enter' || k === ' ') && e.target.closest && e.target.closest('button')) return;
    var key = null;
    if (/^[0-9]$/.test(k)) key = k;
    else if (k === '.' || k === ',') key = '.';
    else if (k === '+' || k === '-' || k === '*' || k === '/' || k === '%' || k === '(' || k === ')') key = k;
    else if (k === 'x' || k === 'X') key = '*';
    else if (k === 'Enter' || k === '=') key = '=';
    else if (k === 'Backspace') key = 'BACK';
    else if (k === 'Escape' || k === 'Delete') key = 'AC';
    if (key === null) return;
    e.preventDefault();
    calcPress(key);
  });

  /* ---------- history ---------- */

  function loadHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      if (Array.isArray(a)) {
        calcHist = a.filter(function (h) {
          return h && typeof h.expr === 'string' && typeof h.result === 'string';
        }).slice(0, HIST_MAX);
      }
    } catch (err) { calcHist = []; }
  }

  function saveHistory() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(calcHist)); } catch (err) {}
  }

  function addHistory(expr, result) {
    var top = calcHist[0];
    if (top && top.expr === expr && top.result === result) top.ts = Date.now();
    else calcHist.unshift({ id: newId(), expr: expr, result: result, ts: Date.now() });
    calcHist = calcHist.slice(0, HIST_MAX);
    saveHistory();
  }

  var dlgHistory = $('dlg-history');
  var dlgClear = $('dlg-clear');

  function renderHistory() {
    var ul = $('hist-list');
    ul.textContent = '';
    $('hist-empty').hidden = calcHist.length > 0;
    $('hist-clear').hidden = calcHist.length === 0;
    calcHist.forEach(function (h) {
      var li = document.createElement('li');
      var use = document.createElement('button');
      use.type = 'button';
      use.className = 'hist-use';
      use.setAttribute('aria-label', 'Use answer ' + shown(Number(h.result)) + ' from ' + h.expr);
      var ex = document.createElement('span');
      ex.className = 'hist-expr';
      ex.textContent = h.expr + ' =';
      var res = document.createElement('span');
      res.className = 'hist-res';
      res.textContent = shown(Number(h.result));
      use.appendChild(ex); use.appendChild(res);
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'hist-edit';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', 'Edit ' + h.expr);
      use.addEventListener('click', function () { useHistoryResult(h); });
      edit.addEventListener('click', function () { editHistory(h); });
      li.appendChild(edit); li.appendChild(use);
      ul.appendChild(li);
    });
  }

  function useHistoryResult(h) {
    var r = h.result.replace('-', '\u2212');
    var last = calc.expr.slice(-1);
    if (calc.expr === '' || calc.justEvaluated || !(isOpCh(last) || last === '(')) calc.expr = r;
    else calc.expr += r;
    calc.justEvaluated = false;
    calc.error = '';
    dlgHistory.close();
    renderCalc();
  }

  function editHistory(h) {
    calc.expr = h.expr;
    calc.justEvaluated = false;
    calc.error = '';
    dlgHistory.close();
    renderCalc();
  }

  $('calc-history-btn').addEventListener('click', function () {
    renderHistory();
    dlgHistory.showModal();
  });
  $('hist-close').addEventListener('click', function () { dlgHistory.close(); });
  dlgHistory.addEventListener('click', function (e) { if (e.target === dlgHistory) dlgHistory.close(); });
  $('hist-clear').addEventListener('click', function () { dlgClear.showModal(); });
  $('clr-cancel').addEventListener('click', function () { dlgClear.close(); });
  dlgClear.addEventListener('click', function (e) { if (e.target === dlgClear) dlgClear.close(); });
  $('clr-confirm').addEventListener('click', function () {
    calcHist = [];
    saveHistory();
    dlgClear.close();
    renderHistory();
    toast('History cleared');
  });

  if (Calc) loadHistory();

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
     Setup check (inside Settings)
     ===================================================== */

  function setRow(name, rowState, text) {
    var row = $('row-' + name);
    if (!row) return;
    row.setAttribute('data-state', rowState);
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
    items = all.map(function (it) {
      if (it.type === 'list' && !Array.isArray(it.items)) it.items = [];
      return it;
    });
  }).catch(function () {
    dbOk = false;
    $('storage-banner').hidden = false;
  }).then(function () {
    checkStorage();
    ready = true;
    route();
  });
})();
