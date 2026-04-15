/* ── Integral. Browser · Renderer ───────────────────────────────── */
'use strict';

const api = window.integral;

// ── DOM refs ──────────────────────────────────────────────────
const $tabsList       = document.getElementById('tabs-list');
const $urlbar         = document.getElementById('urlbar');
const $urlbarWrap     = document.getElementById('urlbar-wrap');
const $urlbarTitle    = document.getElementById('urlbar-title');
const $urlbarZoom     = document.getElementById('urlbar-zoom');
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
const $btnHistory     = document.getElementById('btn-history');

const $bookmarksBar   = document.getElementById('bookmarks-bar');
const $bookmarksList  = document.getElementById('bookmarks-list');
const $btnBookmarksPanel = document.getElementById('btn-bookmarks-panel');

const $settingsPanel  = document.getElementById('settings-panel');
const $bookmarksPanel = document.getElementById('bookmarks-panel');
const $bookmarksPanelList = document.getElementById('bookmarks-panel-list');
const $bookmarksSearchInput = document.getElementById('bookmarks-search-input');
const $bookmarksEmpty = document.getElementById('bookmarks-empty');

const $webviewsContainer = document.getElementById('webviews-container');

const $loadingBar = document.getElementById('loading-bar');

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
let isIncognito = false;
let NEWTAB_URL = '';
let SETTINGS_URL = '';
let HISTORY_URL = '';
let ERROR_URL = '';
let webviewPreloadPath = '';
const FALLBACK_URL = 'about:blank';

// ── Init ──────────────────────────────────────────────────────
(async () => {
  try {
    webviewPreloadPath = await api.getWebViewPreloadPath();
    NEWTAB_URL = await api.getNewTabUrl();
    SETTINGS_URL = await api.getSettingsUrl();
    HISTORY_URL = await api.getHistoryUrl();
    ERROR_URL = await api.getErrorUrl();
    console.log('[init] newtab URL:', NEWTAB_URL);

    const state = await api.getState();
    bookmarks = state.bookmarks || [];
    settings = state.settings || {};
    renderBookmarksBar();
    applySettings();

    // Restore saved tabs or create a new tab
    const savedTabs = await api.getSavedTabs();
    if (savedTabs && savedTabs.length > 0) {
      console.log('[init] restoring', savedTabs.length, 'saved tabs');
      savedTabs.forEach((t, i) => {
        const url = t.url && !t.url.startsWith('http://127.0.0.1') ? t.url : NEWTAB_URL;
        if (i === 0) {
          createTab(url, { title: t.title });
        } else {
          createTab(url, { title: t.title, active: false });
        }
      });
    } else {
      console.log('[init] no saved tabs, creating default');
      createTab(NEWTAB_URL);
    }

    // Initial resize — multiple passes to catch async layout
    requestAnimationFrame(() => resizeAllWebviews());
    requestAnimationFrame(() => resizeAllWebviews());
    setTimeout(() => resizeAllWebviews(), 50);
    setTimeout(() => resizeAllWebviews(), 100);
    setTimeout(() => resizeAllWebviews(), 300);
    setTimeout(() => resizeAllWebviews(), 600);
    setTimeout(() => resizeAllWebviews(), 1200);
  } catch (err) {
    console.error('[init] FATAL:', err);
    NEWTAB_URL = NEWTAB_URL || FALLBACK_URL;
    createTab(NEWTAB_URL);
  }
})();

// ── IPC listeners (main process events) ───────────────────────
api.on('fullscreen-change', (fs) => document.body.classList.toggle('fullscreen', fs));
api.on('bypass-no-binary', () => showToast('Бинарник не найден. Положи winws.exe или goodbyedpi.exe в папку bypass/'));
api.on('bookmarks-update', (bm) => { bookmarks = bm || []; renderBookmarksBar(); renderBookmarksPanel(); updateBookmarkStar(); });
api.on('settings-changed', (s) => { settings = s || {}; applySettings(); });
api.on('incognito-mode', (v) => { isIncognito = v; });
api.on('save-tabs', () => {
  const tabData = tabs.map(t => ({
    url: t.url && !t.url.includes('127.0.0.1') && !t.url.startsWith('about:') ? t.url : '',
    title: t.title || '',
  })).filter(t => t.url);
  if (tabData.length > 0) {
    api.saveTabsSession(tabData);
    console.log('[tabs] saved', tabData.length, 'tabs');
  }
});

// ── Native context menu actions (from main process) ──────────
api.on('ctx-action', (action) => {
  if (typeof action === 'string') {
    const wv = getActiveWebView();
    if (action === 'back') { if (wv) wv.goBack(); }
    else if (action === 'forward') { if (wv) wv.goForward(); }
    else if (action === 'reload') { if (wv) wv.reload(); }
    else if (action === 'zoom-in') { zoomIn(); }
    else if (action === 'zoom-out') { zoomOut(); }
    else if (action === 'zoom-reset') { zoomReset(); }
    else if (action === 'bookmark-toggle') $btnBookmark.click();
    else if (action === 'new-tab') createTab(NEWTAB_URL);
    else if (action === 'copied') showToast('Скопировано');
    // Tab context menu actions
    else if (action === 'tab-pin' && ctxTabId) pinTab(ctxTabId);
    else if (action === 'tab-mute' && ctxTabId) muteTab(ctxTabId);
    else if (action === 'tab-close-others' && ctxTabId) closeOtherTabs(ctxTabId);
    else if (action === 'tab-close-right' && ctxTabId) closeTabsToRight(ctxTabId);
    else if (action === 'tab-close' && ctxTabId) closeTab(ctxTabId);
  } else if (action && typeof action === 'object') {
    if (action.action === 'open-link') {
      const t = getActiveTab();
      if (t) { t.url = action.url; t.webview.loadURL(action.url); }
    } else if (action.action === 'open-link-tab') {
      createTab(action.url);
    }
    // Tab group action
    else if (action.action === 'tab-group' && ctxTabId) {
      setTabGroup(ctxTabId, action.color || null);
    }
    // Bookmark context menu actions
    else if (action.action === 'bm-open' && action.url) {
      createTab(action.url);
    }
    else if (action.action === 'bm-open-new' && action.url) {
      createTab(action.url);
    }
    else if (action.action === 'bm-delete' && action.id) {
      api.removeBookmark(action.id).then(() => showToast('Закладка удалена'));
    }
  }
});

// ── Zoom IPC from main ───────────────────────────────────────
api.on('do-zoom', ({ tabId, level }) => {
  const tab = getTab(tabId);
  if (!tab) return;
  tab.zoomLevel = level;
  try { tab.webview.setZoomLevel(level); } catch {}
  if (tab.id === activeTabId) updateZoomIndicator(tab);
});

// ══════════════════════════════════════════════════════════════
//  WEBVIEW RESIZE (explicit pixel dimensions)
// ══════════════════════════════════════════════════════════════

function resizeAllWebviews() {
  const rect = $webviewsContainer.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w <= 0 || h <= 0) return;

  tabs.forEach(tab => {
    if (!tab.webview) return;
    try {
      // Only resize if dimensions actually changed
      const currentW = parseInt(tab.webview.style.width) || 0;
      const currentH = parseInt(tab.webview.style.height) || 0;
      if (currentW === w && currentH === h) return;
      tab.webview.style.width = w + 'px';
      tab.webview.style.height = h + 'px';
    } catch (e) {
      console.warn('[resize] error setting webview size:', e.message);
    }
  });
}

// Schedule a resize after a short delay (handles async layout)
let resizeTimer = null;
function scheduleResize(delay) {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    resizeAllWebviews();
  }, delay || 50);
}

// Watch for container size changes and window resize
window.addEventListener('resize', () => { resizeAllWebviews(); scheduleResize(100); });
window.addEventListener('DOMContentLoaded', () => { scheduleResize(50); });
const resizeObs = new ResizeObserver(() => { resizeAllWebviews(); scheduleResize(50); });
resizeObs.observe($webviewsContainer);

// ══════════════════════════════════════════════════════════════
//  TAB MANAGEMENT
// ══════════════════════════════════════════════════════════════

function getTab(id) { return tabs.find(t => t.id === id); }
function getActiveTab() { return getTab(activeTabId); }
function getActiveWebView() { const t = getActiveTab(); return t ? t.webview : null; }

function resolveTabUrl(url) {
  if (!url || url === 'about:blank' || url === 'newtab' || url === '') return NEWTAB_URL || FALLBACK_URL;
  return url;
}

function isInternalPage(url) {
  if (!url) return false;
  return url.includes('settings.html') || url.includes('history.html') || url.includes('error.html');
}

function createTab(url, opts = {}) {
  try {
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
      // Set explicit size immediately on attach, then re-measure after layout
      resizeAllWebviews();
      requestAnimationFrame(() => resizeAllWebviews());
      scheduleResize(50);
      scheduleResize(150);
      scheduleResize(400);
    });

    webview.addEventListener('did-start-loading', () => {
      const tab = getTab(id);
      if (tab) {
        tab.loading = true;
        renderTabs();
        if (id === activeTabId) updateNavFromTab(tab);
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      const tab = getTab(id);
      if (tab) {
        tab.loading = false;
        renderTabs();
        if (id === activeTabId) updateNavFromTab(tab);
      }
    });

    webview.addEventListener('did-fail-load', (e) => {
      console.warn('[webview] did-fail-load, tab', id, 'code:', e.errorCode, 'url:', e.validatedURL);
      if (e.errorCode === -3) return; // ABORTED — ignore
      const tab = getTab(id);
      if (!tab) return;

      const errorMap = {
        '-2': 502, '-6': 404, '-21': 403, '-100': 404,
        '-102': 502, '-105': 404, '-106': 503, '-109': 502,
        '-200': -1, '-201': -1, '-202': -1, '-203': -1, '-204': -1,
      };

      if (e.errorCode in errorMap) {
        const httpCode = errorMap[e.errorCode];
        const failedUrl = e.validatedURL || tab.url || '';
        tab.loading = false;
        tab.title = httpCode > 0 ? `Ошибка ${httpCode}` : 'Не удалось загрузить';
        const errorPageUrl = `${ERROR_URL}?code=${httpCode}&url=${encodeURIComponent(failedUrl)}`;
        try { tab.webview.loadURL(errorPageUrl); } catch {}
        tab.url = errorPageUrl;
        renderTabs();
        if (id === activeTabId) updateNavFromTab(tab);
        return;
      }

      if (tab.url && tab.url.includes('127.0.0.1')) {
        tab.loading = false;
        tab.title = 'Новая вкладка';
        tab.url = 'about:blank';
        tab.webview.loadURL('about:blank');
        renderTabs();
        if (id === activeTabId) updateNavFromTab(tab);
      }
    });

    webview.addEventListener('page-title-updated', (e) => {
      const tab = getTab(id);
      if (tab) {
        tab.title = e.title || 'Новая вкладка';
        renderTabs();
        if (id === activeTabId) {
          document.title = `${tab.title} — Integral.`
          updateUrlbarTitle(tab);
        }
        if (!isInternalPage(tab.url) && !tab.url.includes('127.0.0.1') && !tab.url.startsWith('about:')) {
          api.historyAdd(tab.url, tab.title);
        }
      }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      const tab = getTab(id);
      if (tab) { tab.favicon = (e.favicons && e.favicons[0]) || null; renderTabs(); }
    });

    webview.addEventListener('did-navigate', (e) => {
      const tab = getTab(id);
      if (tab) {
        tab.url = e.url;
        if (id === activeTabId) updateNavFromTab(tab);
        if (!isInternalPage(e.url) && !e.url.includes('127.0.0.1') && !e.url.startsWith('about:')) {
          api.historyAdd(e.url, tab.title);
        }
      }
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      const tab = getTab(id);
      if (tab) {
        tab.url = e.url;
        if (id === activeTabId) updateNavFromTab(tab);
      }
    });

    // ── Context menu via IPC from preload (more reliable than webview event) ──
    webview.addEventListener('context-menu', (e) => {
      if (id === activeTabId) {
        const rect = webview.getBoundingClientRect();
        api.showContextMenu({
          x: rect.left + e.params.x,
          y: rect.top + e.params.y,
          pageURL: e.params.pageURL,
          linkURL: e.params.linkURL,
          selectionText: e.params.selectionText,
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        });
      }
    });

    webview.addEventListener('audio-state-changed', () => {
      const tab = getTab(id);
      if (tab) { tab.audible = webview.isCurrentlyAudible(); renderTabs(); }
    });

    webview.addEventListener('new-window', (e) => {
      e.preventDefault();
      createTab(e.url);
    });

    webview.addEventListener('plugin-crashed', () => {
      console.error('[webview] plugin crashed, tab', id);
    });

    webview.addEventListener('crashed', () => {
      console.error('[webview] CRASHED, tab', id);
      showToast('Вкладка упала. Перезагрузите страницу.');
    });

    webview.addEventListener('render-process-gone', (e) => {
      console.error('[webview] render process gone, tab', id, 'reason:', e.reason);
    });

    // ── IPC from webview preload (internal page messages + context menu) ──
    webview.addEventListener('ipc-message', (e) => {
      if (e.channel === 'internal-msg') {
        const msg = e.args[0];
        // Handle context menu from preload (more reliable than webview context-menu event)
        if (msg && msg.type === 'context-menu') {
          if (id === activeTabId) {
            const rect = webview.getBoundingClientRect();
            api.showContextMenu({
              x: rect.left + msg.x,
              y: rect.top + msg.y,
              pageURL: msg.pageURL,
              linkURL: msg.linkURL,
              selectionText: msg.selectionText,
              canGoBack: webview.canGoBack(),
              canGoForward: webview.canGoForward(),
            });
          }
          return;
        }
        // Handle notification events from webview
        if (msg && msg.type === 'notification-event') {
          api.showNotificationPopup({
            title: msg.title,
            body: msg.body,
            icon: msg.icon,
            url: msg.url,
          });
          return;
        }
        handleInternalMessage(id, msg);
      }
    });

    // Add to DOM
    $webviewsContainer.appendChild(webview);

    const resolvedUrl = resolveTabUrl(url);
    const tab = {
      id, webview, url: resolvedUrl,
      title: opts.title || 'Новая вкладка',
      favicon: null, loading: true,
      pinned: opts.pinned || false,
      muted: opts.muted || false,
      audible: false,
      group: opts.group || null,
      zoomLevel: opts.zoomLevel || 0,
    };
    tabs.push(tab);

    if (tab.pinned) {
      const idx = tabs.findIndex(t => t.id === id);
      if (idx > 0) {
        tabs.splice(idx, 1);
        const pinnedCount = tabs.filter(t => t.pinned).length;
        tabs.splice(pinnedCount, 0, tab);
      }
    }

    if (opts.active !== false) {
      setActiveTab(id);
    }

    webview.src = resolvedUrl;
    console.log('[tab] created', id, 'url:', resolvedUrl);
    return id;
  } catch (err) {
    console.error('[tab] FATAL createTab error:', err);
    return null;
  }
}

function setActiveTab(id) {
  activeTabId = id;
  tabs.forEach(t => { t.webview.style.display = 'none'; });
  const tab = getTab(id);
  if (tab) {
    tab.webview.style.display = 'block';
    // Explicit resize on tab switch
    resizeAllWebviews();
    requestAnimationFrame(() => resizeAllWebviews());
    // Restore zoom level
    try { tab.webview.setZoomLevel(tab.zoomLevel || 0); } catch {}
    updateNavFromTab(tab);
    document.title = `${tab.title} — Integral.`
    updateBookmarkStarState(isBookmarkedUrl(tab.url));
    updateUrlbarTitle(tab);
    updateZoomIndicator(tab);
  }
  renderTabs();
}

function closeTab(id, animate = true) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];

  if (animate) {
    const tabEl = $tabsList.querySelector(`.tab[data-id="${id}"]`);
    if (tabEl) {
      tabEl.classList.add('closing');
      setTimeout(() => {
        tab.webview.remove();
        tabs.splice(tabs.findIndex(t => t.id === id), 1);
        finishClose(idx, id);
      }, 250);
      return;
    }
  }

  tab.webview.remove();
  tabs.splice(idx, 1);
  finishClose(idx, id);
}

function finishClose(idx, id) {
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
  toClose.forEach(tid => closeTab(tid, false));
}

function closeTabsToRight(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.slice(idx + 1).map(t => t.id).forEach(tid => closeTab(tid, false));
}

function reorderTab(tabId, newIndex) {
  const old = tabs.findIndex(t => t.id === tabId);
  if (old === -1 || newIndex < 0 || newIndex >= tabs.length || old === newIndex) return;
  const [moved] = tabs.splice(old, 1);
  tabs.splice(newIndex, 0, moved);
  renderTabs();
}

function isBookmarkedUrl(url) {
  return url && !url.includes('newtab') && !url.includes('127.0.0.1') && !url.startsWith('about:') && bookmarks.some(b => b.url === url);
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
    if (!el) {
      el = buildTabEl(tab);
      // Add enter animation
      requestAnimationFrame(() => el.classList.add('entering'));
      setTimeout(() => el.classList.remove('entering'), 260);
    } else updateTabEl(el, tab);
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
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); ctxTabId = tab.id; api.showTabContextMenu({ x: e.clientX, y: e.clientY, pinned: tab.pinned, muted: tab.muted }); });

  // ── Drag-n-drop with animations ──
  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.id);
    // Create a drag image
    const dragImage = el.cloneNode(true);
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.width = el.offsetWidth + 'px';
    dragImage.style.opacity = '0.7';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, e.offsetX, e.offsetY);
    requestAnimationFrame(() => dragImage.remove());
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    $tabsList.querySelectorAll('.drag-over-left,.drag-over-right').forEach(t => t.classList.remove('drag-over-left','drag-over-right'));
  });
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
//  NAVIGATION
// ══════════════════════════════════════════════════════════════

function updateNavFromTab(tab) {
  if (!tab) return;
  try {
    const wv = tab.webview;
    if (!urlbarFocused) $urlbar.value = isNewtabUrl(tab.url) ? '' : tab.url;
    $btnBack.disabled = !wv.canGoBack();
    $btnForward.disabled = !wv.canGoForward();
    isLoading = tab.loading;
    $icoReload.style.display = isLoading ? 'none' : '';
    $icoStop.style.display = isLoading ? '' : 'none';
    $spinner.classList.toggle('hidden', !isLoading);
    $secureIcon.classList.toggle('hidden', !(tab.url && tab.url.startsWith('https://')));
    if (isLoading) startLoadBar(); else finishLoadBar();
    updateBookmarkStarState(isBookmarkedUrl(tab.url));
    updateUrlbarTitle(tab);
    updateZoomIndicator(tab);
    $urlbarWrap.classList.toggle('has-value', !!$urlbar.value);
  } catch (e) {
    console.error('[nav] updateNavFromTab error:', e);
  }
}

function updateUrlbarTitle(tab) {
  if (!tab || urlbarFocused) return;
  if (isNewtabUrl(tab.url) || isInternalPage(tab.url)) {
    $urlbarTitle.textContent = tab.title || 'Новая вкладка';
  } else {
    $urlbarTitle.textContent = tab.title || formatUrl(tab.url) || 'Новая вкладка';
  }
}

function updateZoomIndicator(tab) {
  if (!tab) return;
  const level = tab.zoomLevel || 0;
  if (level === 0) {
    $urlbarZoom.classList.add('hidden');
  } else {
    $urlbarZoom.classList.remove('hidden');
    $urlbarZoom.textContent = Math.round(100 * Math.pow(1.2, level)) + '%';
  }
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
  if (url.includes('newtab') || url.includes('127.0.0.1') || url.startsWith('file://')) return '';
  try { const u = new URL(url); return u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search; } catch { return url; }
}

function resolveInput(raw) {
  const v = raw.trim(); if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+/.test(v) && !v.includes(' ')) return 'https://' + v;
  const engines = { yandex: 'https://yandex.ru/search/?text=', google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
  return (engines[settings.searchEngine] || engines.yandex) + encodeURIComponent(v);
}

function isNewtabUrl(url) {
  return !url || url === 'about:blank' || url.includes('newtab') || url.includes('127.0.0.1');
}

// ── Loading bar ───────────────────────────────────────────────
let loadBarValue = 0;
function startLoadBar() { $loadingBar.classList.add('active'); loadBarValue = 10; $loadingBar.style.transition = 'width .3s ease, opacity .2s'; $loadingBar.style.width = loadBarValue + '%'; clearInterval(loadBarTimer); loadBarTimer = setInterval(() => { if (loadBarValue < 85) { loadBarValue += Math.random() * 8; $loadingBar.style.width = Math.min(loadBarValue, 85) + '%'; } }, 400); }
function finishLoadBar() { clearInterval(loadBarTimer); $loadingBar.style.transition = 'width .15s ease, opacity .4s .3s'; $loadingBar.style.width = '100%'; setTimeout(() => { $loadingBar.classList.remove('active'); $loadingBar.style.width = '0'; }, 350); }

// ══════════════════════════════════════════════════════════════
//  SAFARI-STYLE URL BAR
// ══════════════════════════════════════════════════════════════

$urlbar.addEventListener('focus', () => {
  urlbarFocused = true;
  $urlbarWrap.classList.add('focused');
  const t = getActiveTab();
  if (t) $urlbar.value = isNewtabUrl(t.url) ? '' : t.url;
  $urlbar.select();
});
$urlbar.addEventListener('blur', () => {
  urlbarFocused = false;
  $urlbarWrap.classList.remove('focused');
  const t = getActiveTab();
  if (t) {
    $urlbar.value = isNewtabUrl(t.url) ? '' : formatUrl(t.url);
    $urlbarWrap.classList.toggle('has-value', !!$urlbar.value);
  }
});
$urlbar.addEventListener('input', () => {
  $urlbarWrap.classList.toggle('has-value', !!$urlbar.value);
});
$urlbar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const raw = $urlbar.value; const u = resolveInput(raw);
    if (u) {
      const t = getActiveTab();
      if (t) {
        t.url = u;
        t.loading = true;
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
$urlbarWrap.addEventListener('click', () => $urlbar.focus());

// ══════════════════════════════════════════════════════════════
//  ZOOM CONTROL
// ══════════════════════════════════════════════════════════════

function setZoomLevel(delta) {
  const tab = getActiveTab();
  if (!tab) return;
  const newLevel = Math.max(-3, Math.min(4, (tab.zoomLevel || 0) + delta));
  tab.zoomLevel = newLevel;
  try { tab.webview.setZoomLevel(newLevel); } catch {}
  updateZoomIndicator(tab);
}

function zoomIn() { setZoomLevel(0.5); }
function zoomOut() { setZoomLevel(-0.5); }
function zoomReset() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.zoomLevel = 0;
  try { tab.webview.setZoomLevel(0); } catch {}
  updateZoomIndicator(tab);
}

// ══════════════════════════════════════════════════════════════
//  NAV BUTTONS
// ══════════════════════════════════════════════════════════════

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
$newTabBtn.addEventListener('click', () => {
  createTab(NEWTAB_URL || FALLBACK_URL);
});
$newTabBtn.setAttribute('draggable', 'false');
$newTabBtn.style.webkitAppRegion = 'no-drag';
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
  if (!t || !t.url || isNewtabUrl(t.url)) return;
  const r = await api.toggleBookmark(t.url, t.title, t.favicon);
  showToast(r.action === 'added' ? 'Закладка добавлена' : 'Закладка удалена');
});

function renderBookmarksBar() {
  $bookmarksList.innerHTML = '';
  if (!settings.showBookmarksBar || bookmarks.length === 0) {
    $bookmarksBar.classList.add('hidden');
    // Bar hidden → container gets taller, resize webviews
    scheduleResize(30);
    return;
  }
  $bookmarksBar.classList.remove('hidden');
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
//  SETTINGS AS TAB
// ══════════════════════════════════════════════════════════════

$btnSettings.addEventListener('click', () => {
  const existing = tabs.find(t => t.url && t.url.includes('settings.html'));
  if (existing) { setActiveTab(existing.id); return; }
  if (SETTINGS_URL) createTab(SETTINGS_URL);
  else openPanel($settingsPanel);
});
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

function openPanel(p) { p.classList.remove('hidden'); }
function closePanel(p) { p.classList.add('hidden'); }
document.querySelectorAll('.panel-backdrop').forEach(b => b.addEventListener('click', () => b.closest('.panel').classList.add('hidden')));

// ══════════════════════════════════════════════════════════════
//  HISTORY BUTTON
// ══════════════════════════════════════════════════════════════

$btnHistory.addEventListener('click', () => {
  const existing = tabs.find(t => t.url && t.url.includes('history.html'));
  if (existing) { setActiveTab(existing.id); return; }
  if (HISTORY_URL) createTab(HISTORY_URL);
});

// ══════════════════════════════════════════════════════════════
//  INTERNAL PAGE MESSAGE HANDLER
// ══════════════════════════════════════════════════════════════

function handleInternalMessage(tabId, msg) {
  if (!msg || !msg.type) return;
  const tab = getTab(tabId);
  if (!tab) return;

  switch (msg.type) {
    case 'settings-get':
      // Send initial settings to the internal page
      api.getSettings().then(s => {
        tab.webview.send('internal-response', { type: 'init-settings', settings: s || {} });
      }).catch(() => {});
      break;
    case 'navigate':
      if (msg.url) {
        tab.url = msg.url;
        tab.loading = true;
        try { tab.webview.loadURL(msg.url); } catch {}
        renderTabs();
      }
      break;
    case 'settings-set':
      if (msg.key !== undefined) {
        api.setSetting(msg.key, msg.value);
      }
      break;
    case 'get-history':
      api.historyGet().then(history => {
        tab.webview.send('internal-response', { type: 'init-history', entries: history || [] });
      });
      break;
    case 'history-delete':
      if (msg.id) api.historyDelete(msg.id);
      break;
    case 'history-clear':
      api.historyClear();
      break;
    case 'open-tab':
      if (msg.url) createTab(msg.url);
      break;
    case 'get-cookies':
      api.cookiesGet().then(cookies => {
        tab.webview.send('internal-response', { type: 'cookies', data: cookies || [] });
      });
      break;
    case 'cookies-clear':
      api.cookiesClear();
      break;
    case 'cache-clear':
      api.cacheClear().then(() => showToast('Кэш очищен'));
      break;
    case 'cache-get-size':
      api.cacheGetSize().then(size => {
        tab.webview.send('internal-response', { type: 'cache-size', size });
      });
      break;
    case 'settings-export':
      api.exportSettings().then(data => {
        tab.webview.send('internal-response', { type: 'export-data', data });
      }).catch(() => {
        tab.webview.send('internal-response', { type: 'export-error' });
      });
      break;
    case 'settings-import':
      api.importSettings(msg.data).then(r => {
        if (r.success) {
          tab.webview.send('internal-response', { type: 'import-success' });
          settings = api.getSettings().then(s => { settings = s; applySettings(); });
        } else {
          tab.webview.send('internal-response', { type: 'import-error', error: r.error });
        }
      }).catch(() => {
        tab.webview.send('internal-response', { type: 'import-error' });
      });
      break;
    case 'settings-reset':
      api.resetSettings().then(() => {
        settings = api.getSettings().then(s => { settings = s; applySettings(); });
        tab.webview.send('internal-response', { type: 'settings-reset-done' });
      });
      break;
    case 'history-open':
      if (msg.url) createTab(msg.url);
      break;
    case 'error-retry':
      if (msg.url) {
        tab.url = msg.url;
        tab.loading = true;
        try { tab.webview.loadURL(msg.url); } catch {}
        renderTabs();
      }
      break;
    case 'error-home':
      createTab(NEWTAB_URL);
      break;
  }
}

// ══════════════════════════════════════════════════════════════
//  CONTEXT MENUS (all native via Electron Menu)
// ══════════════════════════════════════════════════════════════

// ── Bookmarks Bar Context Menu (native via IPC) ──────────────
$bookmarksBar.addEventListener('contextmenu', (e) => {
  e.preventDefault(); e.stopPropagation();
  const bmItem = e.target.closest('.bm-item');
  if (!bmItem) return;
  const idx = [...$bookmarksList.children].indexOf(bmItem);
  if (idx === -1) return;
  const bm = bookmarks[idx]; if (!bm) return;
  api.showBmContextMenu({ x: e.clientX, y: e.clientY, url: bm.url, id: bm.id });
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
  if (ctrl && e.key === 't') { e.preventDefault(); createTab(NEWTAB_URL); }
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
  if (ctrl && e.key === 'h') { e.preventDefault(); $btnHistory.click(); }
  // Zoom shortcuts
  if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
  if (ctrl && e.key === '-') { e.preventDefault(); zoomOut(); }
  if (ctrl && e.key === '0') { e.preventDefault(); zoomReset(); }
  if (e.key === 'Escape') {
    $settingsPanel.classList.add('hidden');
    $bookmarksPanel.classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
