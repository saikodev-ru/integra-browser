/* ── Integra Browser · Renderer (webview-based) ──────────────── */
'use strict';

const api = window.integra;

// ── DOM refs ──────────────────────────────────────────────────
const $tabsList       = document.getElementById('tabs-list');
const $urlbar         = document.getElementById('urlbar');
const $btnBack        = document.getElementById('btn-back');
const $btnForward     = document.getElementById('btn-forward');
const $btnReload      = document.getElementById('btn-reload');
const $icoReload      = document.getElementById('ico-reload');
const $icoStop        = document.getElementById('ico-stop');
const $secureIcon     = document.getElementById('secure-icon');
const $spinner        = document.getElementById('urlbar-spinner');
const $btnBypass      = document.getElementById('btn-bypass');
const $bypassLbl      = document.getElementById('bypass-label');
const $toast          = document.getElementById('toast');
const $btnBookmark    = document.getElementById('btn-bookmark');
const $icoStar        = document.getElementById('ico-star');
const $icoStarFilled  = document.getElementById('ico-star-filled');
const $btnSettings    = document.getElementById('btn-settings');
const $btnIncognito   = document.getElementById('btn-incognito');

const $bookmarksBar   = document.getElementById('bookmarks-bar');
const $bookmarksList  = document.getElementById('bookmarks-list');
const $btnBookmarksPanel = document.getElementById('btn-bookmarks-panel');

const $settingsPanel  = document.getElementById('settings-panel');
const $bookmarksPanel = document.getElementById('bookmarks-panel');
const $bookmarksPanelList = document.getElementById('bookmarks-panel-list');
const $bookmarksSearchInput = document.getElementById('bookmarks-search-input');
const $bookmarksEmpty = document.getElementById('bookmarks-empty');

const $tabCtxMenu     = document.getElementById('tab-ctx-menu');
const $pageCtxMenu    = document.getElementById('page-ctx-menu');
const $groupColorMenu = document.getElementById('group-color-menu');
const $bmCtxMenu      = document.getElementById('bm-ctx-menu');

const $webviewsContainer = document.getElementById('webviews-container');

const $loadingBar = document.createElement('div');
$loadingBar.id = 'loading-bar';
document.body.appendChild($loadingBar);

// ── State ─────────────────────────────────────────────────────
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let isLoading = false;
let loadBarTimer = null;
let urlbarFocused = false;
let bookmarks = [];
let settings = {};
let isBookmarked = false;
let ctxTabId = null;
let ctxBmId = null;
let ctxBmUrl = null;
let isIncognito = false;
let NEWTAB_URL = '';
let webviewPreloadPath = '';

// ── Init ──────────────────────────────────────────────────────
(async () => {
  webviewPreloadPath = await api.getWebViewPreloadPath();
  NEWTAB_URL = await api.getNewTabUrl();
  const state = await api.getState();
  bookmarks = state.bookmarks || [];
  settings = state.settings || {};
  renderBookmarksBar();
  applySettings();
  createTab(); // Create initial tab
})();

// ── IPC listeners (main process events) ───────────────────────
api.on('fullscreen-change', (fs) => document.body.classList.toggle('fullscreen', fs));
api.on('bypass-no-binary', () => showToast('Бинарник не найден. Положи winws.exe или goodbyedpi.exe в папку bypass/'));
api.on('bookmarks-update', (bm) => { bookmarks = bm || []; renderBookmarksBar(); renderBookmarksPanel(); updateBookmarkStar(); });
api.on('settings-changed', (s) => { settings = s || {}; applySettings(); });
api.on('incognito-mode', (v) => { isIncognito = v; });

// ══════════════════════════════════════════════════════════════
//  TAB MANAGEMENT (webview-based)
// ══════════════════════════════════════════════════════════════

function getTab(id) { return tabs.find(t => t.id === id); }
function getActiveTab() { return getTab(activeTabId); }
function getActiveWebView() { const t = getActiveTab(); return t ? t.webview : null; }

function resolveTabUrl(url) {
  if (!url || url === 'about:blank' || url === 'newtab') return NEWTAB_URL;
  return url;
}

function createTab(url = NEWTAB_URL, opts = {}) {
  const id = nextTabId++;
  const partition = isIncognito ? ('incognito-' + Date.now()) : 'persist:main';

  const webview = document.createElement('webview');
  webview.setAttribute('preload', webviewPreloadPath);
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.className = 'tab-webview';
  webview.style.display = 'none';

  // ── Webview events ──
  webview.addEventListener('did-attach', () => {
    console.log('[webview] did-attach, tab', id);
  });
  webview.addEventListener('did-start-loading', () => {
    console.log('[webview] did-start-loading, tab', id);
    const tab = getTab(id);
    if (tab) { tab.loading = true; renderTabs(); if (id === activeTabId) updateNavFromTab(tab); }
  });
  webview.addEventListener('did-stop-loading', () => {
    console.log('[webview] did-stop-loading, tab', id);
    const tab = getTab(id);
    if (tab) { tab.loading = false; renderTabs(); if (id === activeTabId) updateNavFromTab(tab); }
  });
  webview.addEventListener('did-fail-load', (e) => {
    console.error('[webview] did-fail-load, tab', id, 'code:', e.errorCode, 'desc:', e.errorDescription, 'url:', e.validatedURL);
    if (e.errorCode === -3) return; // ABORTED — ignore
    const tab = getTab(id);
    if (tab && tab.url && (tab.url.startsWith('integra://') || tab.url.startsWith('file://'))) {
      // Local page failed — show blank fallback
      tab.loading = false;
      tab.title = 'Новая вкладка';
      tab.url = 'about:blank';
      webview.loadURL('about:blank');
      renderTabs();
      if (id === activeTabId) updateNavFromTab(tab);
    }
  });
  webview.addEventListener('page-title-updated', (e) => {
    const tab = getTab(id);
    if (tab) {
      tab.title = e.title || 'Новая вкладка';
      renderTabs();
      if (id === activeTabId) document.title = `${tab.title} — Integra`;
    }
  });
  webview.addEventListener('page-favicon-updated', (e) => {
    const tab = getTab(id);
    if (tab) { tab.favicon = (e.favicons && e.favicons[0]) || null; renderTabs(); }
  });
  webview.addEventListener('did-navigate', (e) => {
    const tab = getTab(id);
    if (tab) { tab.url = e.url; if (id === activeTabId) updateNavFromTab(tab); }
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    const tab = getTab(id);
    if (tab) { tab.url = e.url; if (id === activeTabId) updateNavFromTab(tab); }
  });
  webview.addEventListener('context-menu', (e) => {
    // Only show custom menu for the active tab
    if (id === activeTabId) {
      const rect = webview.getBoundingClientRect();
      showPageCtxMenu(rect.left + e.params.x, rect.top + e.params.y, e.params);
    }
  });
  webview.addEventListener('audio-state-changed', () => {
    const tab = getTab(id);
    if (tab) { tab.audible = webview.isCurrentlyAudible(); renderTabs(); }
  });

  // Handle new windows / popups → open in new tab
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url);
  });

  // Add to DOM
  $webviewsContainer.appendChild(webview);

  const tab = {
    id, webview, url: resolveTabUrl(url), title: 'Новая вкладка',
    favicon: null, loading: true,
    pinned: opts.pinned || false,
    muted: opts.muted || false,
    audible: false,
    group: opts.group || null,
  };
  tabs.push(tab);

  // If pinned, insert at beginning
  if (tab.pinned) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx > 0) {
      tabs.splice(idx, 1);
      const pinnedCount = tabs.filter(t => t.pinned).length;
      tabs.splice(pinnedCount, 0, tab);
    }
  }

  setActiveTab(id);
  webview.src = resolveTabUrl(tab.url);
  return id;
}

function setActiveTab(id) {
  activeTabId = id;
  // Hide all webviews, show active
  tabs.forEach(t => { t.webview.style.display = 'none'; });
  const tab = getTab(id);
  if (tab) {
    tab.webview.style.display = 'block';
    updateNavFromTab(tab);
    document.title = `${tab.title} — Integra`;
    updateBookmarkStarState(isBookmarkedUrl(tab.url));
  }
  renderTabs();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  tab.webview.remove();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab(NEWTAB_URL); return; }
  if (activeTabId === id) setActiveTab(tabs[Math.min(idx, tabs.length - 1)].id);
  else renderTabs();
}

function pinTab(id) {
  const tab = getTab(id); if (!tab) return;
  tab.pinned = !tab.pinned;
  if (tab.pinned) {
    const idx = tabs.findIndex(t => t.id === id);
    tabs.splice(idx, 1);
    const pinnedCount = tabs.filter(t => t.pinned).length;
    tabs.splice(tab.pinned ? pinnedCount - 1 : pinnedCount, 0, tab);
  }
  renderTabs();
}

function muteTab(id) {
  const tab = getTab(id); if (!tab) return;
  tab.muted = !tab.muted;
  tab.webview.setAudioMuted(tab.muted);
  renderTabs();
}

function setTabGroup(id, group) {
  const tab = getTab(id); if (!tab) return;
  tab.group = group;
  renderTabs();
}

function closeOtherTabs(id) {
  const toClose = tabs.filter(t => t.id !== id).map(t => t.id);
  toClose.forEach(tid => closeTab(tid));
}

function closeTabsToRight(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.slice(idx + 1).map(t => t.id).forEach(tid => closeTab(tid));
}

function reorderTab(tabId, newIndex) {
  const old = tabs.findIndex(t => t.id === tabId);
  if (old === -1 || newIndex < 0 || newIndex >= tabs.length || old === newIndex) return;
  const [moved] = tabs.splice(old, 1);
  tabs.splice(newIndex, 0, moved);
  renderTabs();
}

function isBookmarkedUrl(url) {
  return url && !url.includes('newtab.html') && !url.startsWith('integra://') && bookmarks.some(b => b.url === url);
}

// ══════════════════════════════════════════════════════════════
//  TAB RENDERING & DRAG-N-DROP
// ══════════════════════════════════════════════════════════════

function renderTabs() {
  const existing = new Map([...$tabsList.querySelectorAll('.tab')].map(el => [+el.dataset.id, el]));
  const newIds = new Set(tabs.map(t => t.id));
  existing.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

  tabs.forEach((tab, idx) => {
    let el = existing.get(tab.id);
    if (!el) el = buildTabEl(tab);
    else updateTabEl(el, tab);
    const beforeEl = $tabsList.children[idx];
    if (beforeEl && beforeEl !== $newTabBtn) {
      if ($tabsList.children[idx] !== el) $tabsList.insertBefore(el, $tabsList.children[idx]);
    } else {
      $tabsList.insertBefore(el, $newTabBtn);
    }
  });
}

function buildTabEl(tab) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = tab.id;
  el.setAttribute('draggable', 'true');
  el.innerHTML = `
    <div class="tab-favicon"></div>
    <div class="tab-title"></div>
    <div class="tab-mute-indicator ${tab.muted ? '' : 'hidden'}"></div>
    <button class="tab-close" title="Закрыть вкладку">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>`;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { closeTab(tab.id); return; }
    if (e.target.closest('.tab-close')) return;
    setActiveTab(tab.id);
  });
  el.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showTabCtxMenu(tab.id, e.clientX, e.clientY); });

  // Drag-N-Drop
  el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tab.id); });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); $tabsList.querySelectorAll('.drag-over-left,.drag-over-right').forEach(t => t.classList.remove('drag-over-left','drag-over-right')); });
  el.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    $tabsList.querySelectorAll('.drag-over-left,.drag-over-right').forEach(t => t.classList.remove('drag-over-left','drag-over-right'));
    const rect = el.getBoundingClientRect();
    el.classList.add(e.clientX < rect.left + rect.width / 2 ? 'drag-over-left' : 'drag-over-right');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over-left','drag-over-right'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === tab.id) return;
    const targetIdx = tabs.findIndex(t => t.id === tab.id);
    const rect = el.getBoundingClientRect();
    let newIdx = e.clientX < rect.left + rect.width / 2 ? targetIdx : targetIdx + 1;
    const draggedTab = tabs.find(t => t.id === draggedId);
    if (draggedTab && draggedTab.pinned && !tab.pinned) newIdx = tabs.filter(t => t.pinned).length;
    reorderTab(draggedId, newIdx);
    el.classList.remove('drag-over-left','drag-over-right');
  });

  updateTabEl(el, tab);
  return el;
}

function updateTabEl(el, tab) {
  const isActive = tab.id === activeTabId;
  el.classList.toggle('active', isActive);
  el.classList.toggle('pinned', tab.pinned);
  el.classList.toggle('audible', tab.audible && !tab.muted);
  ['red','orange','yellow','green','blue','purple'].forEach(c => el.classList.toggle('group-' + c, tab.group === c));

  const faviconEl = el.querySelector('.tab-favicon');
  if (tab.loading) {
    faviconEl.innerHTML = '<div class="tab-spinner"></div>';
  } else if (tab.favicon) {
    faviconEl.innerHTML = `<img src="${tab.favicon}" alt="" draggable="false">`;
  } else {
    faviconEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="rgba(255,255,255,.2)" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,.2)"/></svg>';
  }

  el.querySelector('.tab-title').textContent = tab.title || tab.url || 'Новая вкладка';
  const muteEl = el.querySelector('.tab-mute-indicator');
  muteEl.classList.toggle('hidden', !tab.muted);
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATION (direct webview methods)
// ══════════════════════════════════════════════════════════════

function updateNavFromTab(tab) {
  if (!tab) return;
  const wv = tab.webview;
  if (!urlbarFocused) $urlbar.value = formatUrl(tab.url);
  $btnBack.disabled = !wv.canGoBack();
  $btnForward.disabled = !wv.canGoForward();
  isLoading = tab.loading;
  $icoReload.style.display = isLoading ? 'none' : '';
  $icoStop.style.display = isLoading ? '' : 'none';
  $spinner.classList.toggle('hidden', !isLoading);
  $secureIcon.classList.toggle('hidden', !(tab.url && tab.url.startsWith('https://')));
  if (isLoading) startLoadBar(); else finishLoadBar();
  updateBookmarkStarState(isBookmarkedUrl(tab.url));
}

function updateBookmarkStar() {
  const t = getActiveTab(); if (!t) return;
  api.checkBookmark(t.url).then(b => updateBookmarkStarState(b));
}

function updateBookmarkStarState(bookmarked) {
  isBookmarked = !!bookmarked;
  $icoStar.style.display = isBookmarked ? 'none' : '';
  $icoStarFilled.style.display = isBookmarked ? '' : 'none';
  $btnBookmark.classList.toggle('active', isBookmarked);
}

function applyBypassState(e) { $btnBypass.classList.toggle('active', e); $bypassLbl.textContent = e ? 'Обход вкл' : 'Обход'; }

// ── URL helpers ───────────────────────────────────────────────
function formatUrl(url) {
  if (!url || url === 'about:blank') return '';
  if (url.includes('newtab.html') || url.startsWith('file://') || url.startsWith('integra://')) return '';
  try { const u = new URL(url); return u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search; } catch { return url; }
}

function resolveInput(raw) {
  const v = raw.trim(); if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+/.test(v) && !v.includes(' ')) return 'https://' + v;
  const engines = { yandex: 'https://yandex.ru/search/?text=', google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
  return (engines[settings.searchEngine] || engines.yandex) + encodeURIComponent(v);
}

// ── Loading bar ───────────────────────────────────────────────
let loadBarValue = 0;
function startLoadBar() { $loadingBar.classList.add('active'); loadBarValue = 10; $loadingBar.style.transition = 'width .3s ease, opacity .2s'; $loadingBar.style.width = loadBarValue + '%'; clearInterval(loadBarTimer); loadBarTimer = setInterval(() => { if (loadBarValue < 85) { loadBarValue += Math.random() * 8; $loadingBar.style.width = Math.min(loadBarValue, 85) + '%'; } }, 400); }
function finishLoadBar() { clearInterval(loadBarTimer); $loadingBar.style.transition = 'width .15s ease, opacity .4s .3s'; $loadingBar.style.width = '100%'; setTimeout(() => { $loadingBar.classList.remove('active'); $loadingBar.style.width = '0'; }, 350); }

// ── URL bar ───────────────────────────────────────────────────
$urlbar.addEventListener('focus', () => { urlbarFocused = true; const t = getActiveTab(); if (t) $urlbar.value = (t.url === 'about:blank' || t.url.startsWith('integra://')) ? '' : t.url; $urlbar.select(); });
$urlbar.addEventListener('blur', () => { urlbarFocused = false; const t = getActiveTab(); if (t) $urlbar.value = formatUrl(t.url); });
$urlbar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const raw = $urlbar.value; const u = resolveInput(raw);
    if (u) {
      const t = getActiveTab();
      if (t) {
        t.url = u;
        t.loading = true;
        console.log('[nav] loadURL:', u);
        try {
          t.webview.loadURL(u);
        } catch (err) {
          console.error('[nav] loadURL error:', err);
          t.loading = false;
        }
        renderTabs();
      }
      $urlbar.blur();
    }
  }
  if (e.key === 'Escape') $urlbar.blur();
});
document.getElementById('urlbar-wrap').addEventListener('click', () => $urlbar.focus());

// ── Nav buttons (direct webview calls) ────────────────────────
$btnBack.addEventListener('click', () => { const wv = getActiveWebView(); if (wv) wv.goBack(); });
$btnForward.addEventListener('click', () => { const wv = getActiveWebView(); if (wv) wv.goForward(); });
$btnReload.addEventListener('click', () => {
  const wv = getActiveWebView();
  if (isLoading) { if (wv) wv.stop(); } else { if (wv) wv.reload(); }
});

// ── New Tab button ────────────────────────────────────────────
const $newTabBtn = document.createElement('button');
$newTabBtn.id = 'btn-new-tab';
$newTabBtn.className = 'tab-new-btn';
$newTabBtn.title = 'Новая вкладка (Ctrl+T)';
$newTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
$newTabBtn.addEventListener('click', () => createTab());
$tabsList.appendChild($newTabBtn);

// ── Window controls ───────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click', () => api.minimize());
document.getElementById('btn-max').addEventListener('click', () => api.maximize());
document.getElementById('btn-close').addEventListener('click', () => api.close());
$btnBypass.addEventListener('click', () => api.toggleBypass());
$btnIncognito.addEventListener('click', () => api.newIncognitoWindow());

// ══════════════════════════════════════════════════════════════
//  BOOKMARKS
// ══════════════════════════════════════════════════════════════

$btnBookmark.addEventListener('click', async () => {
  const t = getActiveTab();
  if (!t || !t.url || t.url.includes('newtab.html')) return;
  const r = await api.toggleBookmark(t.url, t.title, t.favicon);
  showToast(r.action === 'added' ? 'Закладка добавлена' : 'Закладка удалена');
});

function renderBookmarksBar() {
  $bookmarksList.innerHTML = '';
  if (!settings.showBookmarksBar || bookmarks.length === 0) {
    $bookmarksBar.classList.add('hidden');
    document.body.classList.remove('show-bookmarks');
    return;
  }
  $bookmarksBar.classList.remove('hidden');
  document.body.classList.add('show-bookmarks');
  bookmarks.slice(0, 10).forEach(bm => {
    const el = document.createElement('button');
    el.className = 'bm-item';
    el.title = bm.title + '\n' + bm.url;
    const fav = bm.favicon ? `<img src="${bm.favicon}" alt="" draggable="false">` : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.5 3 3.3.5-2.4 2.3.6 3.3L6 8.5 2.6 10.1l.6-3.3L1.2 4.5l3.3-.5z" stroke="currentColor" stroke-width="1" fill="none"/></svg>';
    el.innerHTML = `<div class="bm-item-favicon">${fav}</div><div class="bm-item-title">${esc(bm.title)}</div>`;
    el.addEventListener('click', () => createTab(bm.url));
    $bookmarksList.appendChild(el);
  });
}

function renderBookmarksPanel(filter = '') {
  $bookmarksPanelList.innerHTML = '';
  const q = filter.toLowerCase().trim();
  let filtered = q ? bookmarks.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) : bookmarks;
  if (filtered.length === 0) {
    $bookmarksEmpty.classList.remove('hidden');
    $bookmarksEmpty.querySelector('p').textContent = q && bookmarks.length > 0 ? 'Ничего не найдено' : 'Закладок пока нет';
    $bookmarksEmpty.querySelector('.text-muted').textContent = q && bookmarks.length > 0 ? 'Попробуйте другой запрос' : 'Нажмите ★ чтобы добавить';
    return;
  }
  $bookmarksEmpty.classList.add('hidden');
  filtered.forEach(bm => {
    const el = document.createElement('div');
    el.className = 'bm-panel-item';
    const icon = bm.favicon ? `<img src="${bm.favicon}" alt="">` : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l2 4 4.5.7-3.3 3.2.8 4.5L8 12.2l-4 2.2.8-4.5L1.5 6.7 6 6z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
    let displayUrl = bm.url;
    try { const u = new URL(bm.url); displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname : ''); } catch {}
    el.innerHTML = `<div class="bm-panel-item-icon">${icon}</div><div class="bm-panel-item-info"><div class="bm-panel-item-title">${esc(bm.title)}</div><div class="bm-panel-item-url">${esc(displayUrl)}</div></div><button class="bm-panel-item-delete" title="Удалить"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>`;
    el.addEventListener('click', (e) => { if (e.target.closest('.bm-panel-item-delete')) return; createTab(bm.url); closePanel($bookmarksPanel); });
    el.querySelector('.bm-panel-item-delete').addEventListener('click', (e) => { e.stopPropagation(); api.removeBookmark(bm.id); el.style.transition = 'opacity .15s, transform .15s'; el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => { el.remove(); if (!$bookmarksPanelList.children.length) renderBookmarksPanel(q); }, 150); });
    $bookmarksPanelList.appendChild(el);
  });
}

$btnBookmarksPanel.addEventListener('click', () => { openPanel($bookmarksPanel); $bookmarksSearchInput.value = ''; renderBookmarksPanel(); setTimeout(() => $bookmarksSearchInput.focus(), 100); });
$bookmarksSearchInput.addEventListener('input', () => renderBookmarksPanel($bookmarksSearchInput.value));
document.getElementById('bookmarks-panel-close').addEventListener('click', () => closePanel($bookmarksPanel));

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════

function applySettings() {
  if (!settings) return;
  renderBookmarksBar();
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === (settings.theme || 'dark'); });
  document.getElementById('setting-search-engine').value = settings.searchEngine || 'yandex';
  document.getElementById('setting-show-bookmarks').checked = settings.showBookmarksBar !== false;
  document.getElementById('setting-transparent-chrome').checked = !!settings.transparentChrome;
  document.getElementById('setting-bypass-start').checked = !!settings.bypassOnStart;
  document.getElementById('setting-clear-exit').checked = !!settings.clearOnExit;
  const fs = document.getElementById('setting-font-size');
  fs.value = settings.fontSize || 14;
  document.getElementById('font-size-value').textContent = (settings.fontSize || 14) + 'px';
  document.body.style.fontSize = (settings.fontSize || 14) + 'px';
  document.body.classList.toggle('transparent-mode', !!settings.transparentChrome);
}

$btnSettings.addEventListener('click', () => openPanel($settingsPanel));
document.getElementById('settings-close').addEventListener('click', () => closePanel($settingsPanel));
document.getElementById('setting-search-engine').addEventListener('change', (e) => api.setSetting('searchEngine', e.target.value));
document.querySelectorAll('input[name="theme"]').forEach(r => r.addEventListener('change', (e) => api.setSetting('theme', e.target.value)));
document.getElementById('setting-show-bookmarks').addEventListener('change', (e) => api.setSetting('showBookmarksBar', e.target.checked));
document.getElementById('setting-transparent-chrome').addEventListener('change', (e) => api.setSetting('transparentChrome', e.target.checked));
document.getElementById('setting-bypass-start').addEventListener('change', (e) => api.setSetting('bypassOnStart', e.target.checked));
document.getElementById('setting-clear-exit').addEventListener('change', (e) => api.setSetting('clearOnExit', e.target.checked));
document.getElementById('setting-font-size').addEventListener('input', (e) => { const s = parseInt(e.target.value); document.getElementById('font-size-value').textContent = s + 'px'; document.body.style.fontSize = s + 'px'; api.setSetting('fontSize', s); });
document.getElementById('btn-export-settings').addEventListener('click', async () => { const r = await api.exportSettings(); showToast(r.success ? 'Настройки экспортированы' : 'Ошибка экспорта'); });
document.getElementById('btn-import-settings').addEventListener('click', async () => { const r = await api.importSettings(); if (r.success) { showToast('Настройки импортированы'); applySettings(); } else showToast('Ошибка: ' + (r.error || '')); });
document.getElementById('btn-reset-settings').addEventListener('click', async () => { await api.resetSettings(); settings = await api.getSettings(); applySettings(); showToast('Настройки сброшены'); });

function openPanel(p) { p.classList.remove('hidden'); }
function closePanel(p) { p.classList.add('hidden'); }
document.querySelectorAll('.panel-backdrop').forEach(b => b.addEventListener('click', () => b.closest('.panel').classList.add('hidden')));

// ══════════════════════════════════════════════════════════════
//  CONTEXT MENUS (HTML overlays — naturally on top of webview!)
// ══════════════════════════════════════════════════════════════

function hideAllMenus() {
  $tabCtxMenu.classList.add('hidden');
  $pageCtxMenu.classList.add('hidden');
  $bmCtxMenu.classList.add('hidden');
  if ($groupColorMenu) $groupColorMenu.style.display = '';
}

document.addEventListener('mousedown', (e) => {
  if (!$tabCtxMenu.contains(e.target)) $tabCtxMenu.classList.add('hidden');
  if (!$pageCtxMenu.contains(e.target)) $pageCtxMenu.classList.add('hidden');
  if (!$bmCtxMenu.contains(e.target)) $bmCtxMenu.classList.add('hidden');
});
document.addEventListener('click', hideAllMenus);
document.addEventListener('contextmenu', (e) => { e.preventDefault(); });

// ── Tab Context Menu ────────────────────────────────────────
function showTabCtxMenu(tabId, x, y) {
  ctxTabId = tabId;
  const tab = getTab(tabId); if (!tab) return;

  const pinBtn = $tabCtxMenu.querySelector('[data-action="pin"]');
  pinBtn.querySelector('.pin-cross').style.display = tab.pinned ? '' : 'none';
  pinBtn.querySelector('span').textContent = tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку';

  const muteBtn = $tabCtxMenu.querySelector('[data-action="mute"]');
  muteBtn.querySelector('.ico-mute-off').style.display = tab.muted ? 'none' : '';
  muteBtn.querySelector('.ico-mute-on').style.display = tab.muted ? '' : 'none';
  muteBtn.querySelector('span').textContent = tab.muted ? 'Включить звук' : 'Отключить звук';

  $tabCtxMenu.style.left = x + 'px';
  $tabCtxMenu.style.top = y + 'px';
  $tabCtxMenu.classList.remove('hidden');

  requestAnimationFrame(() => {
    const rect = $tabCtxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) $tabCtxMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) $tabCtxMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
}

$tabCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn || !ctxTabId) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  const color = btn.dataset.color;
  if (action === 'pin') pinTab(ctxTabId);
  else if (action === 'mute') muteTab(ctxTabId);
  else if (action === 'group') return;
  else if (color !== undefined) setTabGroup(ctxTabId, color || null);
  else if (action === 'close-others') closeOtherTabs(ctxTabId);
  else if (action === 'close-right') closeTabsToRight(ctxTabId);
  else if (action === 'close') closeTab(ctxTabId);
  hideAllMenus();
});

// ── Page Context Menu ───────────────────────────────────────
function showPageCtxMenu(x, y, params) {
  const bmBtn = $pageCtxMenu.querySelector('[data-action="bookmark-toggle"]');
  const bmIcon = bmBtn.querySelector('.ico-page-bm');
  if (isBookmarked) {
    bmBtn.querySelector('span').textContent = 'Убрать из закладок';
    bmIcon.querySelector('path').setAttribute('fill', 'currentColor');
  } else {
    bmBtn.querySelector('span').textContent = 'Добавить в закладки';
    bmIcon.querySelector('path').setAttribute('fill', 'none');
  }

  $pageCtxMenu.style.left = x + 'px';
  $pageCtxMenu.style.top = y + 'px';
  $pageCtxMenu.classList.remove('hidden');

  requestAnimationFrame(() => {
    const rect = $pageCtxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) $pageCtxMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) $pageCtxMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
  $pageCtxMenu._params = params;
}

$pageCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  const wv = getActiveWebView();
  if (action === 'back') { if (wv) wv.goBack(); }
  else if (action === 'forward') { if (wv) wv.goForward(); }
  else if (action === 'reload') { if (wv) wv.reload(); }
  else if (action === 'bookmark-toggle') $btnBookmark.click();
  else if (action === 'new-tab') createTab();
  else if (action === 'copy-url') {
    const t = getActiveTab();
    if (t && t.url) navigator.clipboard.writeText(t.url).then(() => showToast('URL скопирован'));
  }
  hideAllMenus();
});

// ── Bookmarks Bar Context Menu ───────────────────────────────
$bookmarksBar.addEventListener('contextmenu', (e) => {
  e.preventDefault(); e.stopPropagation();
  const bmItem = e.target.closest('.bm-item');
  if (!bmItem) return;
  const idx = [...$bookmarksList.children].indexOf(bmItem);
  if (idx === -1) return;
  const bm = bookmarks[idx]; if (!bm) return;
  ctxBmId = bm.id; ctxBmUrl = bm.url;
  $bmCtxMenu.style.left = e.clientX + 'px';
  $bmCtxMenu.style.top = e.clientY + 'px';
  $bmCtxMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = $bmCtxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) $bmCtxMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) $bmCtxMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
});

$bmCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  if (action === 'bm-open' || action === 'bm-open-new') { if (ctxBmUrl) createTab(ctxBmUrl); }
  else if (action === 'bm-copy-url') { if (ctxBmUrl) navigator.clipboard.writeText(ctxBmUrl).then(() => showToast('URL скопирован')); }
  else if (action === 'bm-delete') { if (ctxBmId) api.removeBookmark(ctxBmId); showToast('Закладка удалена'); }
  hideAllMenus();
});

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
let toastTimer;
function showToast(msg) {
  $toast.textContent = msg;
  $toast.classList.remove('hidden');
  requestAnimationFrame(() => $toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.classList.remove('show'); setTimeout(() => $toast.classList.add('hidden'), 250); }, 3500);
}

// ══════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  if (ctrl && e.key === 't') { e.preventDefault(); createTab(); }
  if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (ctrl && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); $urlbar.focus(); }
  if ((ctrl && e.key === 'r') || e.key === 'F5') {
    e.preventDefault();
    const wv = getActiveWebView();
    if (wv) wv.reload();
  }
  if (ctrl && e.key >= '1' && e.key <= '9') { const i = parseInt(e.key) - 1; if (tabs[i]) setActiveTab(tabs[i].id); }
  if (ctrl && e.key === 'd') { e.preventDefault(); $btnBookmark.click(); }
  if (ctrl && e.key === 'b') { e.preventDefault(); api.setSetting('showBookmarksBar', !settings.showBookmarksBar); }
  if (ctrl && e.key === ',') { e.preventDefault(); $btnSettings.click(); }
  if (ctrl && shift && e.key === 'N') { e.preventDefault(); api.newIncognitoWindow(); }
  if (e.key === 'Escape') {
    $settingsPanel.classList.add('hidden');
    $bookmarksPanel.classList.add('hidden');
    hideAllMenus();
  }
});

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
