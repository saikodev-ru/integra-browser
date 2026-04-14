/* ── Integra Browser · Renderer ──────────────────────────────── */
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

const $loadingBar = document.createElement('div');
$loadingBar.id = 'loading-bar';
document.body.appendChild($loadingBar);

// ── State ─────────────────────────────────────────────────────
let tabs = [];
let activeTabId = null;
let isLoading = false;
let loadBarTimer = null;
let urlbarFocused = false;
let bookmarks = [];
let settings = {};
let isBookmarked = false;
let ctxTabId = null;

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const state = await api.getState();
  tabs = state.tabs;
  activeTabId = state.activeId;
  bookmarks = state.bookmarks || [];
  settings = state.settings || {};
  renderTabs();
  applyNavState(state.navState);
  applyBypassAvailability(state.bypassAvailable);
  renderBookmarksBar();
  applySettings();
  if (state.bookmarksBarVisible) {
    $bookmarksBar.classList.remove('hidden');
  }
})();

// ── IPC listeners ─────────────────────────────────────────────
api.on('tabs-update', ({ tabs: newTabs, activeId }) => { tabs = newTabs; activeTabId = activeId; renderTabs(); });
api.on('nav-state', (state) => applyNavState(state));
api.on('fullscreen-change', (fs) => document.body.classList.toggle('fullscreen', fs));
api.on('bypass-no-binary', () => showToast('Бинарник не найден. Положи winws.exe или goodbyedpi.exe в папку bypass/'));
api.on('context-menu', ({ x, y, params }) => showPageCtxMenu(x, y, params));
api.on('bookmarks-update', (bm) => { bookmarks = bm || []; renderBookmarksBar(); renderBookmarksPanel(); updateBookmarkStar(); });
api.on('settings-changed', (s) => { settings = s || {}; applySettings(); });
api.on('bookmarks-bar-visibility', (visible) => {
  if (visible) $bookmarksBar.classList.remove('hidden');
  else $bookmarksBar.classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════
//  TAB RENDERING & DRAG-N-DROP
// ══════════════════════════════════════════════════════════════

function renderTabs() {
  const existing = new Map([...$tabsList.querySelectorAll('.tab')].map(el => [+el.dataset.id, el]));
  const newIds = new Set(tabs.map(t => t.id));

  // Remove gone tabs
  existing.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

  tabs.forEach((tab, idx) => {
    let el = existing.get(tab.id);
    if (!el) { el = buildTabEl(tab); }
    else updateTabEl(el, tab);
    // Insert before the + button (always last child)
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
    </button>
  `;

  // Click
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { api.closeTab(tab.id); return; }
    if (e.target.closest('.tab-close')) return;
    api.activateTab(tab.id);
  });

  // Close
  el.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); api.closeTab(tab.id); });

  // Right-click context menu on tab
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    showTabCtxMenu(tab.id, e.clientX, e.clientY);
  });

  // Drag-N-Drop
  el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tab.id); });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); $tabsList.querySelectorAll('.drag-over-left,.drag-over-right').forEach(t => t.classList.remove('drag-over-left','drag-over-right')); });
  el.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (String(tab.id) === e.dataTransfer.types.length ? true : false) return; // skip self handled elsewhere
    $tabsList.querySelectorAll('.drag-over-left,.drag-over-right').forEach(t => t.classList.remove('drag-over-left','drag-over-right'));
    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    el.classList.add(e.clientX < midX ? 'drag-over-left' : 'drag-over-right');
  });
  el.addEventListener('dragleave', () => { el.classList.remove('drag-over-left','drag-over-right'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === tab.id) return;
    const targetIdx = tabs.findIndex(t => t.id === tab.id);
    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    let newIdx = e.clientX < midX ? targetIdx : targetIdx + 1;
    // If dragging pinned to non-pinned, clamp
    const draggedTab = tabs.find(t => t.id === draggedId);
    if (draggedTab && draggedTab.pinned && !tab.pinned) newIdx = tabs.filter(t => t.pinned).length;
    api.reorderTab(draggedId, newIdx);
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

  // Group color
  const groupColors = ['red','orange','yellow','green','blue','purple'];
  groupColors.forEach(c => el.classList.toggle('group-' + c, tab.group === c));

  const faviconEl = el.querySelector('.tab-favicon');
  if (tab.loading) {
    faviconEl.innerHTML = '<div class="tab-spinner"></div>';
  } else if (tab.favicon) {
    faviconEl.innerHTML = `<img src="${tab.favicon}" alt="" draggable="false">`;
  } else {
    faviconEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="rgba(255,255,255,.2)" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,.2)"/></svg>';
  }

  el.querySelector('.tab-title').textContent = tab.title || tab.url || 'Новая вкладка';

  // Mute indicator
  const muteEl = el.querySelector('.tab-mute-indicator');
  muteEl.classList.toggle('hidden', !tab.muted);
}

// ══════════════════════════════════════════════════════════════
//  NAV STATE
// ══════════════════════════════════════════════════════════════

function applyNavState(state) {
  if (!state) return;
  if (!urlbarFocused) $urlbar.value = formatUrl(state.url);
  $btnBack.disabled = !state.canGoBack;
  $btnForward.disabled = !state.canGoForward;
  isLoading = state.loading;
  $icoReload.style.display = isLoading ? 'none' : '';
  $icoStop.style.display = isLoading ? '' : 'none';
  $spinner.classList.toggle('hidden', !isLoading);
  $secureIcon.classList.toggle('hidden', !(state.url && state.url.startsWith('https://')));
  if (isLoading) startLoadBar(); else finishLoadBar();
  applyBypassState(state.bypassEnabled);
  updateBookmarkStarState(state.bookmarked);
}

function updateBookmarkStar() {
  const t = tabs.find(t => t.id === activeTabId); if (!t) return;
  api.checkBookmark(t.url).then(b => updateBookmarkStarState(b));
}

function updateBookmarkStarState(bookmarked) {
  isBookmarked = !!bookmarked;
  $icoStar.style.display = isBookmarked ? 'none' : '';
  $icoStarFilled.style.display = isBookmarked ? '' : 'none';
  $btnBookmark.classList.toggle('active', isBookmarked);
}

function applyBypassAvailability(a) { if (!a) $btnBypass.style.display = 'none'; }
function applyBypassState(e) { $btnBypass.classList.toggle('active', e); $bypassLbl.textContent = e ? 'Обход вкл' : 'Обход'; }

// ── URL ───────────────────────────────────────────────────────
function formatUrl(url) {
  if (!url || url === 'about:blank') return '';
  if (url.includes('newtab.html') || url.startsWith('file://')) return '';
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
$urlbar.addEventListener('focus', () => { urlbarFocused = true; const t = tabs.find(t => t.id === activeTabId); if (t) $urlbar.value = t.url === 'about: blank' ? '' : t.url; $urlbar.select(); });
$urlbar.addEventListener('blur', () => { urlbarFocused = false; const t = tabs.find(t => t.id === activeTabId); if (t) $urlbar.value = formatUrl(t.url); });
$urlbar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const u = resolveInput($urlbar.value); if (u) { api.go(u); $urlbar.blur(); } } if (e.key === 'Escape') $urlbar.blur(); });
document.getElementById('urlbar-wrap').addEventListener('click', () => $urlbar.focus());

// ── Nav buttons ───────────────────────────────────────────────
$btnBack.addEventListener('click', () => api.back());
$btnForward.addEventListener('click', () => api.forward());
$btnReload.addEventListener('click', () => isLoading ? api.stop() : api.reload());
// ── New Tab button (dynamic, always last in tabs-list) ──
const $newTabBtn = document.createElement('button');
$newTabBtn.id = 'btn-new-tab';
$newTabBtn.className = 'tab-new-btn';
$newTabBtn.title = 'Новая вкладка (Ctrl+T)';
$newTabBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
$newTabBtn.addEventListener('click', () => api.newTab());
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
  const t = tabs.find(t => t.id === activeTabId);
  if (!t || !t.url || t.url.includes('newtab.html')) return;
  const r = await api.toggleBookmark(t.url, t.title, t.favicon);
  showToast(r.action === 'added' ? 'Закладка добавлена' : 'Закладка удалена');
});

function renderBookmarksBar() {
  $bookmarksList.innerHTML = '';
  if (!settings.showBookmarksBar || bookmarks.length === 0) { $bookmarksBar.classList.add('hidden'); return; }
  $bookmarksBar.classList.remove('hidden');
  bookmarks.slice(0, 10).forEach(bm => {
    const el = document.createElement('button');
    el.className = 'bm-item';
    el.title = bm.title + '\n' + bm.url;
    const fav = bm.favicon ? `<img src="${bm.favicon}" alt="" draggable="false">` : '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.5 3 3.3.5-2.4 2.3.6 3.3L6 8.5 2.6 10.1l.6-3.3L1.2 4.5l3.3-.5z" stroke="currentColor" stroke-width="1" fill="none"/></svg>';
    el.innerHTML = `<div class="bm-item-favicon">${fav}</div><div class="bm-item-title">${esc(bm.title)}</div>`;
    el.addEventListener('click', () => api.newTab(bm.url));
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
    el.addEventListener('click', (e) => { if (e.target.closest('.bm-panel-item-delete')) return; api.newTab(bm.url); closePanel($bookmarksPanel); });
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
//  CONTEXT MENUS
// ══════════════════════════════════════════════════════════════

function hideAllMenus() { $tabCtxMenu.classList.add('hidden'); $pageCtxMenu.classList.add('hidden'); $bmCtxMenu.classList.add('hidden'); if ($groupColorMenu) $groupColorMenu.style.display = ''; }
document.addEventListener('mousedown', (e) => {
  // Close context menus on any click outside them
  if (!$tabCtxMenu.contains(e.target)) $tabCtxMenu.classList.add('hidden');
  if (!$pageCtxMenu.contains(e.target)) $pageCtxMenu.classList.add('hidden');
  if (!$bmCtxMenu.contains(e.target)) $bmCtxMenu.classList.add('hidden');
});
document.addEventListener('click', hideAllMenus);
// Only prevent default contextmenu on the chrome area (not on web content)
document.addEventListener('contextmenu', (e) => {
  // Allow default on webview area; prevent on chrome UI
  e.preventDefault();
});

// ── Tab Context Menu ────────────────────────────────────────
function showTabCtxMenu(tabId, x, y) {
  ctxTabId = tabId;
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  // Update pin icon/text
  const pinBtn = $tabCtxMenu.querySelector('[data-action="pin"]');
  pinBtn.querySelector('.pin-cross').style.display = tab.pinned ? '' : 'none';
  pinBtn.querySelector('span').textContent = tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку';

  // Update mute icons/text
  const muteBtn = $tabCtxMenu.querySelector('[data-action="mute"]');
  muteBtn.querySelector('.ico-mute-off').style.display = tab.muted ? 'none' : '';
  muteBtn.querySelector('.ico-mute-on').style.display = tab.muted ? '' : 'none';
  muteBtn.querySelector('span').textContent = tab.muted ? 'Включить звук' : 'Отключить звук';

  $tabCtxMenu.style.left = x + 'px';
  $tabCtxMenu.style.top = y + 'px';
  $tabCtxMenu.classList.remove('hidden');

  // Clamp position
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

  if (action === 'pin') api.pinTab(ctxTabId);
  else if (action === 'mute') api.muteTab(ctxTabId);
  else if (action === 'group') { /* submenu toggle - handled by CSS */ return; }
  else if (color !== undefined) api.setTabGroup(ctxTabId, color || null);
  else if (action === 'close-others') api.closeOtherTabs(ctxTabId);
  else if (action === 'close-right') api.closeTabsToRight(ctxTabId);
  else if (action === 'close') api.closeTab(ctxTabId);

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
  if (action === 'back') api.back();
  else if (action === 'forward') api.forward();
  else if (action === 'reload') api.reload();
  else if (action === 'bookmark-toggle') $btnBookmark.click();
  else if (action === 'new-tab') api.newTab();
  else if (action === 'copy-url') {
    const t = tabs.find(t => t.id === activeTabId);
    if (t && t.url) navigator.clipboard.writeText(t.url).then(() => showToast('URL скопирован'));
  }
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
  if (ctrl && e.key === 't') { e.preventDefault(); api.newTab(); }
  if (ctrl && e.key === 'w') { e.preventDefault(); api.closeTab(activeTabId); }
  if (ctrl && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); $urlbar.focus(); }
  if ((ctrl && e.key === 'r') || e.key === 'F5') { e.preventDefault(); api.reload(); }
  if (ctrl && e.key >= '1' && e.key <= '9') { const i = parseInt(e.key) - 1; if (tabs[i]) api.activateTab(tabs[i].id); }
  if (ctrl && e.key === 'd') { e.preventDefault(); $btnBookmark.click(); }
  if (ctrl && e.key === 'b') { e.preventDefault(); api.setSetting('showBookmarksBar', !settings.showBookmarksBar); }
  if (ctrl && e.key === ',') { e.preventDefault(); $btnSettings.click(); }
  if (ctrl && shift && e.key === 'N') { e.preventDefault(); api.newIncognitoWindow(); }
  if (e.key === 'Escape') { $settingsPanel.classList.add('hidden'); $bookmarksPanel.classList.add('hidden'); hideAllMenus(); }
});

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ══════════════════════════════════════════════════════════════
//  BOOKMARKS BAR CONTEXT MENU
// ══════════════════════════════════════════════════════════════

const $bmCtxMenu = document.getElementById('bm-ctx-menu');
let ctxBmId = null;
let ctxBmUrl = null;

$bookmarksBar.addEventListener('contextmenu', (e) => {
  e.preventDefault(); e.stopPropagation();
  const bmItem = e.target.closest('.bm-item');
  if (!bmItem) return;
  const idx = [...$bookmarksList.children].indexOf(bmItem);
  if (idx === -1) return;
  const bm = bookmarks[idx];
  if (!bm) return;
  ctxBmId = bm.id;
  ctxBmUrl = bm.url;
  showBmCtxMenu(bm, e.clientX, e.clientY);
});

function showBmCtxMenu(bm, x, y) {
  $bmCtxMenu.style.left = x + 'px';
  $bmCtxMenu.style.top = y + 'px';
  $bmCtxMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const rect = $bmCtxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) $bmCtxMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) $bmCtxMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  });
}

$bmCtxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  if (action === 'bm-open') { if (ctxBmUrl) api.newTab(ctxBmUrl); }
  else if (action === 'bm-open-new') { if (ctxBmUrl) api.newTab(ctxBmUrl); }
  else if (action === 'bm-copy-url') { if (ctxBmUrl) navigator.clipboard.writeText(ctxBmUrl).then(() => showToast('URL скопирован')); }
  else if (action === 'bm-delete') { if (ctxBmId) api.removeBookmark(ctxBmId); showToast('Закладка удалена'); }
  hideAllMenus();
});
