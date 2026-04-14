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
const $toast          = document.getElementById('bypass-toast');
const $ctxMenu        = document.getElementById('ctx-menu');
const $btnBookmark    = document.getElementById('btn-bookmark');
const $icoStar        = document.getElementById('ico-star');
const $icoStarFilled  = document.getElementById('ico-star-filled');
const $btnSettings    = document.getElementById('btn-settings');

// Bookmarks bar
const $bookmarksBar   = document.getElementById('bookmarks-bar');
const $bookmarksList  = document.getElementById('bookmarks-list');
const $btnBookmarksPanel = document.getElementById('btn-bookmarks-panel');

// Panels
const $settingsPanel  = document.getElementById('settings-panel');
const $bookmarksPanel = document.getElementById('bookmarks-panel');
const $bookmarksPanelList = document.getElementById('bookmarks-panel-list');
const $bookmarksSearchInput = document.getElementById('bookmarks-search-input');
const $bookmarksEmpty = document.getElementById('bookmarks-empty');

// Drag-n-drop
const $dragIndicator  = document.getElementById('tab-drag-indicator');

// Loading bar
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

// Drag-n-drop state
let dragTabId = null;
let dragOverTabId = null;

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
})();

// ── IPC listeners ─────────────────────────────────────────────
api.on('tabs-update', ({ tabs: newTabs, activeId }) => {
  tabs = newTabs;
  activeTabId = activeId;
  renderTabs();
});

api.on('nav-state', (state) => applyNavState(state));

api.on('fullscreen-change', (fs) => {
  document.body.classList.toggle('fullscreen', fs);
});

api.on('bypass-no-binary', () => {
  showToast('Бинарник не найден. Положи winws.exe или goodbyedpi.exe в папку bypass/');
});

api.on('context-menu', ({ x, y, params }) => {
  showCtxMenu(x, y, params);
});

api.on('bookmarks-update', (updatedBookmarks) => {
  bookmarks = updatedBookmarks || [];
  renderBookmarksBar();
  renderBookmarksPanel();
  updateBookmarkStar();
});

api.on('settings-changed', (updatedSettings) => {
  settings = updatedSettings || {};
  applySettings();
});

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
      $tabsList.appendChild(el);
    } else {
      updateTabEl(el, tab);
    }

    if ($tabsList.children[idx] !== el) {
      $tabsList.insertBefore(el, $tabsList.children[idx]);
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
    <button class="tab-close" title="Закрыть вкладку">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  // Click to activate
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { api.closeTab(tab.id); return; }
    if (e.target.closest('.tab-close')) return;
    api.activateTab(tab.id);
  });

  // Close button
  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    api.closeTab(tab.id);
  });

  // ── Drag-N-Drop ──
  el.addEventListener('dragstart', (e) => {
    dragTabId = tab.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.id);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragTabId = null;
    dragOverTabId = null;
    $dragIndicator.classList.add('hidden');
    // Remove all drag-over states
    $tabsList.querySelectorAll('.drag-over').forEach(t => t.classList.remove('drag-over'));
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetId = tab.id;
    if (targetId === dragTabId) return;

    // Remove previous drag-over
    $tabsList.querySelectorAll('.drag-over').forEach(t => t.classList.remove('drag-over'));

    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;

    if (e.clientX < midX) {
      el.classList.add('drag-over');
      el.style.borderLeftColor = '';
    } else {
      el.classList.add('drag-over');
    }

    dragOverTabId = targetId;
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('drag-over');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const targetId = tab.id;
    if (dragTabId === null || targetId === dragTabId) return;

    const targetIdx = tabs.findIndex(t => t.id === targetId);
    if (targetIdx === -1) return;

    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    let newIndex = e.clientX < midX ? targetIdx : targetIdx + 1;

    api.reorderTab(dragTabId, newIndex);

    // Clean up
    el.classList.remove('drag-over');
    dragTabId = null;
    dragOverTabId = null;
  });

  updateTabEl(el, tab);
  return el;
}

function updateTabEl(el, tab) {
  const isActive = tab.id === activeTabId;
  el.classList.toggle('active', isActive);

  const faviconEl = el.querySelector('.tab-favicon');
  if (tab.loading) {
    faviconEl.innerHTML = '<div class="tab-spinner"></div>';
  } else if (tab.favicon) {
    faviconEl.innerHTML = `<img src="${tab.favicon}" alt="" draggable="false">`;
  } else {
    faviconEl.innerHTML = defaultFaviconSvg();
  }

  el.querySelector('.tab-title').textContent = tab.title || tab.url || 'Новая вкладка';
}

function defaultFaviconSvg() {
  return `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="5" stroke="rgba(255,255,255,.2)" stroke-width="1.2"/>
    <circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,.2)"/>
  </svg>`;
}

// ══════════════════════════════════════════════════════════════
//  NAV STATE
// ══════════════════════════════════════════════════════════════

function applyNavState(state) {
  if (!state) return;

  if (!urlbarFocused) {
    $urlbar.value = formatUrl(state.url);
  }

  $btnBack.disabled = !state.canGoBack;
  $btnForward.disabled = !state.canGoForward;

  isLoading = state.loading;
  $icoReload.style.display = isLoading ? 'none' : '';
  $icoStop.style.display = isLoading ? '' : 'none';

  $spinner.classList.toggle('hidden', !isLoading);

  const isSecure = state.url && state.url.startsWith('https://');
  $secureIcon.classList.toggle('hidden', !isSecure);

  if (isLoading) {
    startLoadBar();
  } else {
    finishLoadBar();
  }

  applyBypassState(state.bypassEnabled);
  updateBookmarkStarState(state.bookmarked);
}

function updateBookmarkStar() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return;
  api.checkBookmark(activeTab.url).then((bookmarked) => {
    updateBookmarkStarState(bookmarked);
  });
}

function updateBookmarkStarState(bookmarked) {
  isBookmarked = !!bookmarked;
  $icoStar.style.display = isBookmarked ? 'none' : '';
  $icoStarFilled.style.display = isBookmarked ? '' : 'none';
  $btnBookmark.classList.toggle('active', isBookmarked);
  $btnBookmark.title = isBookmarked ? 'Удалить из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
}

function applyBypassAvailability(available) {
  if (!available) {
    $btnBypass.style.display = 'none';
  }
}

function applyBypassState(enabled) {
  $btnBypass.classList.toggle('active', enabled);
  $bypassLbl.textContent = enabled ? 'Обход вкл' : 'Обход';
  $btnBypass.title = enabled ? 'Отключить обход DPI/ТСПУ' : 'Включить обход DPI/ТСПУ';
}

// ── URL formatting ─────────────────────────────────────────────
function formatUrl(url) {
  if (!url || url === 'about:blank') return '';
  if (url.includes('newtab.html') || url.startsWith('file://')) return '';
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search;
  } catch { return url; }
}

function resolveInput(raw) {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+/.test(v) && !v.includes(' ')) {
    return 'https://' + v;
  }
  // Use selected search engine from settings
  const engines = {
    yandex: 'https://yandex.ru/search/?text=',
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
  };
  const searchUrl = engines[settings.searchEngine] || engines.yandex;
  return searchUrl + encodeURIComponent(v);
}

// ── Loading bar ───────────────────────────────────────────────
let loadBarValue = 0;

function startLoadBar() {
  $loadingBar.classList.add('active');
  loadBarValue = 10;
  $loadingBar.style.transition = 'width .3s ease, opacity .2s';
  $loadingBar.style.width = loadBarValue + '%';

  clearInterval(loadBarTimer);
  loadBarTimer = setInterval(() => {
    if (loadBarValue < 85) {
      loadBarValue += Math.random() * 8;
      $loadingBar.style.width = Math.min(loadBarValue, 85) + '%';
    }
  }, 400);
}

function finishLoadBar() {
  clearInterval(loadBarTimer);
  $loadingBar.style.transition = 'width .15s ease, opacity .4s .3s';
  $loadingBar.style.width = '100%';
  setTimeout(() => {
    $loadingBar.classList.remove('active');
    $loadingBar.style.width = '0';
  }, 350);
}

// ── URL bar events ─────────────────────────────────────────────
$urlbar.addEventListener('focus', () => {
  urlbarFocused = true;
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) $urlbar.value = activeTab.url === 'about:blank' ? '' : activeTab.url;
  $urlbar.select();
});

$urlbar.addEventListener('blur', () => {
  urlbarFocused = false;
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) $urlbar.value = formatUrl(activeTab.url);
});

$urlbar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = resolveInput($urlbar.value);
    if (url) {
      api.go(url);
      $urlbar.blur();
    }
  }
  if (e.key === 'Escape') {
    $urlbar.blur();
  }
});

document.getElementById('urlbar-wrap').addEventListener('click', () => $urlbar.focus());

// ── Nav buttons ───────────────────────────────────────────────
$btnBack.addEventListener('click', () => api.back());
$btnForward.addEventListener('click', () => api.forward());
$btnReload.addEventListener('click', () => isLoading ? api.stop() : api.reload());
document.getElementById('btn-new-tab').addEventListener('click', () => api.newTab());

// ── Window controls ───────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click', () => api.minimize());
document.getElementById('btn-max').addEventListener('click', () => api.maximize());
document.getElementById('btn-close').addEventListener('click', () => api.close());

// ── Bypass ────────────────────────────────────────────────────
$btnBypass.addEventListener('click', () => api.toggleBypass());

// ══════════════════════════════════════════════════════════════
//  BOOKMARKS
// ══════════════════════════════════════════════════════════════

// Toggle bookmark on current page
$btnBookmark.addEventListener('click', async () => {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || !activeTab.url || activeTab.url.includes('newtab.html')) return;

  const result = await api.toggleBookmark(activeTab.url, activeTab.title, activeTab.favicon);
  if (result.action === 'added') {
    showToast('Закладка добавлена');
  } else {
    showToast('Закладка удалена');
  }
});

// ── Bookmarks Bar ────────────────────────────────────────────
function renderBookmarksBar() {
  $bookmarksList.innerHTML = '';
  if (!settings.showBookmarksBar) {
    $bookmarksBar.classList.add('hidden');
    document.body.classList.remove('bookmarks-visible');
    return;
  }

  if (bookmarks.length === 0) {
    $bookmarksBar.classList.add('hidden');
    document.body.classList.remove('bookmarks-visible');
    return;
  }

  $bookmarksBar.classList.remove('hidden');
  document.body.classList.add('bookmarks-visible');

  // Show max ~10 bookmarks on bar
  const visible = bookmarks.slice(0, 10);
  visible.forEach((bm) => {
    const el = document.createElement('button');
    el.className = 'bm-item';
    el.title = bm.title + '\n' + bm.url;

    let faviconHtml;
    if (bm.favicon) {
      faviconHtml = `<img src="${bm.favicon}" alt="" draggable="false">`;
    } else {
      faviconHtml = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="bm-default-icon">
        <path d="M6 1l1.5 3 3.3.5-2.4 2.3.6 3.3L6 8.5 2.6 10.1l.6-3.3L1.2 4.5l3.3-.5z" stroke="currentColor" stroke-width="1" fill="none"/>
      </svg>`;
    }

    el.innerHTML = `
      <div class="bm-item-favicon">${faviconHtml}</div>
      <div class="bm-item-title">${escapeHtml(bm.title)}</div>
    `;

    el.addEventListener('click', () => {
      api.newTab(bm.url);
    });

    $bookmarksList.appendChild(el);
  });
}

// ── Bookmarks Panel ──────────────────────────────────────────
function renderBookmarksPanel(filter = '') {
  $bookmarksPanelList.innerHTML = '';
  const query = filter.toLowerCase().trim();

  let filtered = bookmarks;
  if (query) {
    filtered = bookmarks.filter(bm =>
      bm.title.toLowerCase().includes(query) ||
      bm.url.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    $bookmarksEmpty.classList.remove('hidden');
    if (query && bookmarks.length > 0) {
      $bookmarksEmpty.querySelector('p').textContent = 'Ничего не найдено';
      $bookmarksEmpty.querySelector('.text-muted').textContent = 'Попробуйте другой запрос';
    } else {
      $bookmarksEmpty.querySelector('p').textContent = 'Закладок пока нет';
      $bookmarksEmpty.querySelector('.text-muted').textContent = 'Нажмите ★ чтобы добавить';
    }
    return;
  }

  $bookmarksEmpty.classList.add('hidden');

  filtered.forEach((bm) => {
    const el = document.createElement('div');
    el.className = 'bm-panel-item';

    let iconHtml;
    if (bm.favicon) {
      iconHtml = `<img src="${bm.favicon}" alt="">`;
    } else {
      iconHtml = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="bm-default-icon">
        <path d="M8 2l2 4 4.5.7-3.3 3.2.8 4.5L8 12.2l-4 2.2.8-4.5L1.5 6.7 6 6z" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>`;
    }

    let displayUrl = bm.url;
    try {
      const u = new URL(bm.url);
      displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    } catch {}

    el.innerHTML = `
      <div class="bm-panel-item-icon">${iconHtml}</div>
      <div class="bm-panel-item-info">
        <div class="bm-panel-item-title">${escapeHtml(bm.title)}</div>
        <div class="bm-panel-item-url">${escapeHtml(displayUrl)}</div>
      </div>
      <button class="bm-panel-item-delete" title="Удалить закладку">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    // Click to open
    el.addEventListener('click', (e) => {
      if (e.target.closest('.bm-panel-item-delete')) return;
      api.newTab(bm.url);
      closePanel($bookmarksPanel);
    });

    // Delete
    el.querySelector('.bm-panel-item-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      api.removeBookmark(bm.id).then(() => {
        el.style.transition = 'opacity .15s, transform .15s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => {
          el.remove();
          // Check if empty now
          const remaining = $bookmarksPanelList.querySelectorAll('.bm-panel-item');
          if (remaining.length === 0) {
            renderBookmarksPanel(query);
          }
        }, 150);
      });
    });

    $bookmarksPanelList.appendChild(el);
  });
}

$btnBookmarksPanel.addEventListener('click', () => {
  openPanel($bookmarksPanel);
  $bookmarksSearchInput.value = '';
  renderBookmarksPanel();
  setTimeout(() => $bookmarksSearchInput.focus(), 100);
});

$bookmarksSearchInput.addEventListener('input', () => {
  renderBookmarksPanel($bookmarksSearchInput.value);
});

document.getElementById('bookmarks-panel-close').addEventListener('click', () => {
  closePanel($bookmarksPanel);
});

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════

function applySettings() {
  if (!settings) return;

  // Bookmarks bar
  renderBookmarksBar();

  // Theme radio
  const themeRadios = document.querySelectorAll('input[name="theme"]');
  themeRadios.forEach(radio => {
    radio.checked = radio.value === (settings.theme || 'dark');
  });

  // Search engine
  document.getElementById('setting-search-engine').value = settings.searchEngine || 'yandex';

  // Toggles
  document.getElementById('setting-show-bookmarks').checked = settings.showBookmarksBar !== false;
  document.getElementById('setting-bypass-start').checked = !!settings.bypassOnStart;
  document.getElementById('setting-clear-exit').checked = !!settings.clearOnExit;

  // Font size
  const fontSlider = document.getElementById('setting-font-size');
  fontSlider.value = settings.fontSize || 14;
  document.getElementById('font-size-value').textContent = (settings.fontSize || 14) + 'px';
  document.body.style.fontSize = (settings.fontSize || 14) + 'px';
}

$btnSettings.addEventListener('click', () => {
  openPanel($settingsPanel);
});

document.getElementById('settings-close').addEventListener('click', () => {
  closePanel($settingsPanel);
});

// Search engine select
document.getElementById('setting-search-engine').addEventListener('change', (e) => {
  api.setSetting('searchEngine', e.target.value);
});

// Theme radios
document.querySelectorAll('input[name="theme"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    api.setSetting('theme', e.target.value);
  });
});

// Bookmarks bar toggle
document.getElementById('setting-show-bookmarks').addEventListener('change', (e) => {
  api.setSetting('showBookmarksBar', e.target.checked);
});

// Bypass on start toggle
document.getElementById('setting-bypass-start').addEventListener('change', (e) => {
  api.setSetting('bypassOnStart', e.target.checked);
});

// Clear on exit toggle
document.getElementById('setting-clear-exit').addEventListener('change', (e) => {
  api.setSetting('clearOnExit', e.target.checked);
});

// Font size slider
document.getElementById('setting-font-size').addEventListener('input', (e) => {
  const size = parseInt(e.target.value);
  document.getElementById('font-size-value').textContent = size + 'px';
  document.body.style.fontSize = size + 'px';
  api.setSetting('fontSize', size);
});

// Export settings
document.getElementById('btn-export-settings').addEventListener('click', async () => {
  const result = await api.exportSettings();
  if (result.success) {
    showToast('Настройки экспортированы');
  } else {
    showToast('Ошибка экспорта');
  }
});

// Import settings
document.getElementById('btn-import-settings').addEventListener('click', async () => {
  const result = await api.importSettings();
  if (result.success) {
    showToast('Настройки импортированы');
    applySettings();
  } else {
    showToast('Ошибка импорта: ' + (result.error || ''));
  }
});

// Reset settings
document.getElementById('btn-reset-settings').addEventListener('click', async () => {
  await api.resetSettings();
  settings = await api.getSettings();
  applySettings();
  showToast('Настройки сброшены');
});

// ── Panel helpers ────────────────────────────────────────────
function openPanel(panel) {
  panel.classList.remove('hidden');
}

function closePanel(panel) {
  panel.classList.add('hidden');
}

// Close panels on backdrop click
document.querySelectorAll('.panel-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', () => {
    backdrop.closest('.panel').classList.add('hidden');
  });
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
  toastTimer = setTimeout(() => {
    $toast.classList.remove('show');
    setTimeout(() => $toast.classList.add('hidden'), 250);
  }, 3500);
}

// ══════════════════════════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════════════════════════
function showCtxMenu(x, y, params) {
  $ctxMenu.style.left = x + 'px';
  $ctxMenu.style.top = y + 'px';
  $ctxMenu.classList.remove('hidden');
  $ctxMenu._params = params;

  // Update bookmark toggle text
  const bmToggle = $ctxMenu.querySelector('[data-action="bookmark-toggle"]');
  if (bmToggle && params) {
    bmToggle.textContent = isBookmarked ? '✦ Убрать из закладок' : '★ Добавить в закладки';
  }
}

document.addEventListener('click', () => $ctxMenu.classList.add('hidden'));
document.addEventListener('contextmenu', (e) => e.preventDefault());

$ctxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  const action = btn.dataset.action;
  const params = $ctxMenu._params;

  if (action === 'back') api.back();
  else if (action === 'forward') api.forward();
  else if (action === 'reload') api.reload();
  else if (action === 'new-tab') api.newTab();
  else if (action === 'bookmark-toggle') $btnBookmark.click();
  else if (action === 'open-external' && params?.linkURL) api.openExternal(params.linkURL);

  $ctxMenu.classList.add('hidden');
});

// ══════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 't') { e.preventDefault(); api.newTab(); }
  if (ctrl && e.key === 'w') { e.preventDefault(); api.closeTab(activeTabId); }
  if (ctrl && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); $urlbar.focus(); }
  if ((ctrl && e.key === 'r') || e.key === 'F5') { e.preventDefault(); api.reload(); }

  // Ctrl+1..9 to switch tabs
  if (ctrl && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) api.activateTab(tabs[idx].id);
  }

  // Ctrl+D to toggle bookmark
  if (ctrl && e.key === 'd') {
    e.preventDefault();
    $btnBookmark.click();
  }

  // Ctrl+B to toggle bookmarks bar
  if (ctrl && e.key === 'b') {
    e.preventDefault();
    api.setSetting('showBookmarksBar', !settings.showBookmarksBar);
  }

  // Ctrl+, to open settings
  if (ctrl && e.key === ',') {
    e.preventDefault();
    $btnSettings.click();
  }

  // Escape to close panels
  if (e.key === 'Escape') {
    $settingsPanel.classList.add('hidden');
    $bookmarksPanel.classList.add('hidden');
  }
});

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
