/* ── Integra Browser · Renderer ──────────────────────────────── */
'use strict';

const api = window.integra;

// ── DOM refs ──────────────────────────────────────────────────
const $tabsList   = document.getElementById('tabs-list');
const $urlbar     = document.getElementById('urlbar');
const $btnBack    = document.getElementById('btn-back');
const $btnForward = document.getElementById('btn-forward');
const $btnReload  = document.getElementById('btn-reload');
const $icoReload  = document.getElementById('ico-reload');
const $icoStop    = document.getElementById('ico-stop');
const $secureIcon = document.getElementById('secure-icon');
const $spinner    = document.getElementById('urlbar-spinner');
const $btnBypass  = document.getElementById('btn-bypass');
const $bypassLbl  = document.getElementById('bypass-label');
const $toast      = document.getElementById('bypass-toast');
const $ctxMenu    = document.getElementById('ctx-menu');

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

// ── Init ──────────────────────────────────────────────────────
(async () => {
  const state = await api.getState();
  tabs = state.tabs;
  activeTabId = state.activeId;
  renderTabs();
  applyNavState(state.navState);
  applyBypassAvailability(state.bypassAvailable);
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
  showToast('⚠ Бинарник не найден. Положи winws.exe или goodbyedpi.exe в папку bypass/');
});

api.on('context-menu', ({ x, y, params }) => {
  showCtxMenu(x, y, params);
});

// ── Tab Rendering ─────────────────────────────────────────────
function renderTabs() {
  const existing = new Map([...$tabsList.querySelectorAll('.tab')].map(el => [+el.dataset.id, el]));
  const newIds = new Set(tabs.map(t => t.id));

  // Remove gone tabs
  existing.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

  tabs.forEach((tab, idx) => {
    let el = existing.get(tab.id);

    if (!el) {
      el = buildTabEl(tab);
      $tabsList.appendChild(el);
    } else {
      updateTabEl(el, tab);
    }

    // Maintain order
    if ($tabsList.children[idx] !== el) {
      $tabsList.insertBefore(el, $tabsList.children[idx]);
    }
  });
}

function buildTabEl(tab) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = tab.id;
  el.innerHTML = `
    <div class="tab-favicon"></div>
    <div class="tab-title"></div>
    <button class="tab-close" title="Закрыть вкладку">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { api.closeTab(tab.id); return; } // middle click
    if (e.target.closest('.tab-close')) return;
    api.activateTab(tab.id);
  });

  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    api.closeTab(tab.id);
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

// ── Nav State ─────────────────────────────────────────────────
function applyNavState(state) {
  if (!state) return;

  // URL bar (only if not focused by user)
  if (!urlbarFocused) {
    $urlbar.value = formatUrl(state.url);
  }

  $btnBack.disabled = !state.canGoBack;
  $btnForward.disabled = !state.canGoForward;

  isLoading = state.loading;
  $icoReload.style.display = isLoading ? 'none' : '';
  $icoStop.style.display = isLoading ? '' : 'none';

  $spinner.classList.toggle('hidden', !isLoading);

  // Secure icon
  const isSecure = state.url && state.url.startsWith('https://');
  $secureIcon.classList.toggle('hidden', !isSecure);

  // Loading bar
  if (isLoading) {
    startLoadBar();
  } else {
    finishLoadBar();
  }

  // Bypass
  applyBypassState(state.bypassEnabled);
}

function applyBypassAvailability(available) {
  if (!available) {
    $btnBypass.style.display = 'none'; // hide if no binary
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
  try {
    const u = new URL(url);
    // Show clean version: strip trailing slash on homepage, keep path
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
  return `https://yandex.ru/search/?text=${encodeURIComponent(v)}`;
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
  // Show full URL on focus
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) $urlbar.value = activeTab.url === 'about:blank' ? '' : activeTab.url;
  $urlbar.select();
});

$urlbar.addEventListener('blur', () => {
  urlbarFocused = false;
  // Restore formatted URL
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

// Click on urlbar wrap to focus input
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

// ── Toast ─────────────────────────────────────────────────────
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

// ── Context menu ──────────────────────────────────────────────
function showCtxMenu(x, y, params) {
  $ctxMenu.style.left = x + 'px';
  $ctxMenu.style.top = y + 'px';
  $ctxMenu.classList.remove('hidden');

  // Store params for action use
  $ctxMenu._params = params;
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
  else if (action === 'open-external' && params?.linkURL) api.openExternal(params.linkURL);

  $ctxMenu.classList.add('hidden');
});

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 't') { e.preventDefault(); api.newTab(); }
  if (ctrl && e.key === 'w') { e.preventDefault(); api.closeTab(activeTabId); }
  if (ctrl && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); $urlbar.focus(); }
  if (ctrl && e.key === 'r' || e.key === 'F5') { e.preventDefault(); api.reload(); }
  if (e.key === 'F5') { e.preventDefault(); api.reload(); }

  // Ctrl+1..9 to switch tabs
  if (ctrl && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) api.activateTab(tabs[idx].id);
  }
});
