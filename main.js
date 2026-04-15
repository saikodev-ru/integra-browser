const { app, BrowserWindow, BrowserView, ipcMain, session, shell, Menu, nativeTheme, dialog, clipboard } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

// ── No telemetry ──────────────────────────────────────────────
app.setPath('crashDumps', path.join(app.getPath('temp'), 'integral-noop'));
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-features', 'Reporting,NetworkQualityEstimator,SafeBrowsingEnhancedProtection');
app.commandLine.appendSwitch('no-report-upload');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');

// ── Local HTTP Server (for serving local pages to BrowserViews with partition) ──
let localServerPort = 0;
const localServer = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, 'src', safePath);

    if (!filePath.startsWith(path.join(__dirname, 'src'))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error('[local-server] error:', e);
    res.writeHead(500); res.end('Internal Error');
  }
});

function startLocalServer() {
  return new Promise((resolve) => {
    localServer.listen(0, '127.0.0.1', () => {
      localServerPort = localServer.address().port;
      console.log('[local-server] listening on 127.0.0.1:' + localServerPort);
      resolve();
    });
  });
}

function getLocalUrl(filename) {
  return `http://127.0.0.1:${localServerPort}/${filename}`;
}

// ── Persistent Data Paths ────────────────────────────────────
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'integral-data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const settingsFile = path.join(dataDir, 'settings.json');
const bookmarksFile = path.join(dataDir, 'bookmarks.json');
const tabsFile = path.join(dataDir, 'tabs.json');
const historyFile = path.join(dataDir, 'history.json');

// ── Default Settings ─────────────────────────────────────────
const DEFAULT_SETTINGS = {
  searchEngine: 'yandex',
  homepage: 'newtab',
  theme: 'dark',
  accentColor: 'violet',
  bypassOnStart: false,
  showBookmarksBar: true,
  clearOnExit: false,
  fontSize: 14,
  transparentChrome: true, // Mica ON by default
};

// ── Settings CRUD ────────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) };
  } catch (e) { console.error('[settings] load error:', e); }
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) { try { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2), 'utf-8'); } catch (e) {} }

let currentSettings = loadSettings();

// ── Bookmarks CRUD ───────────────────────────────────────────
function loadBookmarks() {
  try { if (fs.existsSync(bookmarksFile)) return JSON.parse(fs.readFileSync(bookmarksFile, 'utf-8')); } catch {}
  return [];
}
function saveBookmarks(b) { try { fs.writeFileSync(bookmarksFile, JSON.stringify(b, null, 2), 'utf-8'); } catch {} }

let bookmarks = loadBookmarks();
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function addBookmark(url, title, favicon) {
  const ex = bookmarks.find(b => b.url === url); if (ex) return ex;
  const bm = { id: genId(), url, title: title || url, favicon: favicon || null, createdAt: Date.now() };
  bookmarks.push(bm); saveBookmarks(bookmarks); broadcastBookmarks(); return bm;
}
function removeBookmark(id) { const i = bookmarks.findIndex(b => b.id === id); if (i === -1) return false; bookmarks.splice(i, 1); saveBookmarks(bookmarks); broadcastBookmarks(); return true; }
function isBookmarked(url) { return bookmarks.some(b => b.url === url); }
function getBookmarkForUrl(url) { return bookmarks.find(b => b.url === url) || null; }
function broadcastBookmarks() {
  [mainWindow, ...incognitoWindows].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('bookmarks-update', bookmarks);
  });
}

// ── History CRUD ─────────────────────────────────────────────
function loadHistory() {
  try { if (fs.existsSync(historyFile)) return JSON.parse(fs.readFileSync(historyFile, 'utf-8')); } catch {}
  return [];
}
function saveHistory(h) { try { fs.writeFileSync(historyFile, JSON.stringify(h.slice(0, 5000), null, 2), 'utf-8'); } catch {} }
function addHistoryEntry(url, title) {
  if (!url || url.includes('127.0.0.1') || url.startsWith('about:')) return;
  if (url.includes('settings.html') || url.includes('history.html') || url.includes('error.html') || url.includes('newtab.html')) return;
  const h = loadHistory();
  const existingIdx = h.findIndex(e => e.url === url);
  if (existingIdx !== -1) h.splice(existingIdx, 1);
  h.unshift({ id: genId(), url, title: title || url, timestamp: Date.now() });
  saveHistory(h);
}

// ── Tabs Session (save/restore) ──────────────────────────────
function loadTabSession() {
  try {
    if (fs.existsSync(tabsFile)) {
      const data = JSON.parse(fs.readFileSync(tabsFile, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) { console.error('[tabs] load error:', e); }
  return null;
}
function saveTabSession(tabData) {
  try {
    fs.writeFileSync(tabsFile, JSON.stringify(tabData, null, 2), 'utf-8');
  } catch (e) { console.error('[tabs] save error:', e); }
}

// ── Theme ────────────────────────────────────────────────────
nativeTheme.themeSource = currentSettings.theme === 'system' ? 'system' : 'dark';

// ── State ─────────────────────────────────────────────────────
let mainWindow = null;
let bypassProcess = null;
let bypassEnabled = false;
let incognitoWindows = [];

// ── BrowserView Tab Management ────────────────────────────────
const tabViews = new Map(); // id -> { view, url, title, favicon, loading, pinned, muted, audible, group, zoomLevel, window }
let nextTabId = 1;
const windowActiveTabIds = new Map(); // BrowserWindow -> activeTabId

// Chrome UI heights (must match CSS)
const TABBAR_H = 38;
const NAVBAR_H = 46;
const BOOKMARKS_H = 32;

function getChromeOffset(win) {
  if (!win) win = mainWindow;
  let offset = TABBAR_H + NAVBAR_H;
  // Check if this window has bookmarks bar visible
  // For mainWindow, use currentSettings; for incognito, assume same
  if (currentSettings.showBookmarksBar) offset += BOOKMARKS_H;
  return offset;
}

function getViewBounds(win) {
  if (!win) win = mainWindow;
  if (!win || win.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
  const { width, height } = win.getContentBounds();
  return { x: 0, y: getChromeOffset(win), width, height: height - getChromeOffset(win) };
}

function getActiveTabId(win) {
  if (!win) win = mainWindow;
  return windowActiveTabIds.get(win) || null;
}

function setActiveTabId(win, id) {
  if (!win) win = mainWindow;
  windowActiveTabIds.set(win, id);
}

// ── Helper functions ──────────────────────────────────────────
function serializeTab(tab) {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    loading: tab.loading,
    pinned: tab.pinned,
    muted: tab.muted,
    audible: tab.audible,
    group: tab.group,
    zoomLevel: tab.zoomLevel,
  };
}

function isInternalUrl(url) {
  if (!url) return false;
  return url.includes('settings.html') || url.includes('history.html') || url.includes('error.html');
}

function isNewtabUrl(url) {
  return !url || url === 'about:blank' || url.includes('newtab') || url.includes('127.0.0.1');
}

function resolveTabUrl(url) {
  if (!url || url === 'about:blank' || url === 'newtab' || url === '') return getLocalUrl('newtab.html');
  return url;
}

async function getCacheSize() {
  try {
    const cachePath = path.join(app.getPath('userData'), 'Partitions', 'main', 'Cache');
    if (fs.existsSync(cachePath)) {
      const getDirSize = (dir) => {
        let size = 0;
        try {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            const fp = path.join(dir, f);
            const st = fs.statSync(fp);
            if (st.isDirectory()) size += getDirSize(fp);
            else size += st.size;
          }
        } catch {}
        return size;
      };
      const bytes = getDirSize(cachePath);
      if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
      if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return bytes + ' B';
    }
  } catch {}
  return '0 B';
}

// ══════════════════════════════════════════════════════════════
//  BrowserView Tab Operations
// ══════════════════════════════════════════════════════════════

function createTabView(url, opts = {}) {
  const win = opts.window || mainWindow;
  if (!win || win.isDestroyed()) return null;

  const id = nextTabId++;
  const isIncognito = incognitoWindows.includes(win);
  const partition = isIncognito ? ('incognito-' + Date.now()) : 'persist:main';

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: partition,
    },
  });

  const resolvedUrl = resolveTabUrl(url);
  const tab = {
    id, view, url: resolvedUrl,
    title: opts.title || 'Новая вкладка',
    favicon: null, loading: true,
    pinned: opts.pinned || false,
    muted: opts.muted || false,
    audible: false,
    group: opts.group || null,
    zoomLevel: opts.zoomLevel || 0,
    window: win,
  };
  tabViews.set(id, tab);

  // Set up all events on view.webContents
  setupViewEvents(id, view);

  // If this should be active, show it
  if (opts.active !== false) {
    setActiveTab(id, win);
  }

  view.webContents.loadURL(resolvedUrl);

  // Notify renderer
  if (win && !win.isDestroyed()) {
    win.webContents.send('tab-created', serializeTab(tab));
  }

  console.log('[browserview] created tab', id, 'url:', resolvedUrl);
  return id;
}

function setActiveTab(id, win) {
  if (!win) {
    // Find the window that owns this tab
    const tab = tabViews.get(id);
    if (tab) win = tab.window;
    else win = mainWindow;
  }
  if (!win || win.isDestroyed()) return;

  // Remove previous active view
  const prevId = getActiveTabId(win);
  if (prevId && prevId !== id) {
    const prev = tabViews.get(prevId);
    if (prev && prev.view) {
      try { win.removeBrowserView(prev.view); } catch {}
    }
  }

  setActiveTabId(win, id);
  const tab = tabViews.get(id);
  if (tab && tab.view && !win.isDestroyed()) {
    win.addBrowserView(tab.view);
    const bounds = getViewBounds(win);
    if (bounds.width > 0 && bounds.height > 0) {
      tab.view.setBounds(bounds);
    }
    try { tab.view.webContents.setZoomLevel(tab.zoomLevel || 0); } catch {}
  }

  // Notify renderer
  if (!win.isDestroyed() && tab) {
    const wc = tab.view.webContents;
    win.webContents.send('tab-activated', {
      ...serializeTab(tab),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
    });
  }
}

function closeTabView(id, win) {
  const tab = tabViews.get(id);
  if (!tab) return;
  if (!win) win = tab.window;

  try {
    if (win && !win.isDestroyed()) win.removeBrowserView(tab.view);
  } catch {}
  try { tab.view.webContents.close(); } catch {}
  tabViews.delete(id);

  if (win && !win.isDestroyed()) {
    win.webContents.send('tab-closed', { id });
  }

  const currentActiveId = getActiveTabId(win);
  if (currentActiveId === id) {
    // Find remaining tabs for this window
    const remaining = [...tabViews.values()]
      .filter(t => t.window === win)
      .map(t => t.id);
    if (remaining.length > 0) {
      setActiveTab(remaining[remaining.length - 1], win);
    } else {
      windowActiveTabIds.delete(win);
      // Create a new tab if this is the last one
      createTabView(getLocalUrl('newtab.html'), { window: win });
    }
  }
}

function resizeActiveView(win) {
  if (!win) win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const activeId = getActiveTabId(win);
  if (!activeId) return;
  const tab = tabViews.get(activeId);
  if (tab && tab.view) {
    const bounds = getViewBounds(win);
    if (bounds.width > 0 && bounds.height > 0) {
      // Re-add the view to ensure it stays attached (critical for fullscreen transitions)
      try { win.addBrowserView(tab.view); } catch {}
      tab.view.setBounds(bounds);
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  BrowserView Event Setup
// ══════════════════════════════════════════════════════════════

function setupViewEvents(id, view) {
  const wc = view.webContents;

  wc.on('did-start-loading', () => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.loading = true;
      const win = tab.window;
      if (win && !win.isDestroyed()) win.webContents.send('tab-loading', { id, loading: true });
    }
  });

  wc.on('did-stop-loading', () => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.loading = false;
      const win = tab.window;
      if (win && !win.isDestroyed()) win.webContents.send('tab-loading', { id, loading: false });
    }
  });

  wc.on('did-navigate', (event, url) => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.url = url;
      if (!isInternalUrl(url) && !url.includes('127.0.0.1') && !url.startsWith('about:')) {
        addHistoryEntry(url, tab.title);
      }
      const win = tab.window;
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab-url-updated', { id, url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      }
    }
  });

  wc.on('did-navigate-in-page', (event, url) => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.url = url;
      const win = tab.window;
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab-url-updated', { id, url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      }
    }
  });

  wc.on('page-title-updated', (event, title) => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.title = title || 'Новая вкладка';
      if (!isInternalUrl(tab.url) && !tab.url.includes('127.0.0.1') && !tab.url.startsWith('about:')) {
        addHistoryEntry(tab.url, tab.title);
      }
      const win = tab.window;
      if (win && !win.isDestroyed()) win.webContents.send('tab-title-updated', { id, title });
    }
  });

  wc.on('page-favicon-updated', (event, favicons) => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.favicon = (favicons && favicons[0]) || null;
      const win = tab.window;
      if (win && !win.isDestroyed()) win.webContents.send('tab-favicon-updated', { id, favicon: tab.favicon });
    }
  });

  wc.on('did-fail-load', (event, errorCode, errorDesc, validatedURL) => {
    if (errorCode === -3) return; // ABORTED
    const tab = tabViews.get(id);
    if (!tab) return;

    const errorMap = {
      '-2': 502, '-6': 404, '-21': 403, '-100': 404,
      '-102': 502, '-105': 404, '-106': 503, '-109': 502,
      '-200': -1, '-201': -1, '-202': -1, '-203': -1, '-204': -1,
    };

    if (errorCode in errorMap) {
      const httpCode = errorMap[errorCode];
      const failedUrl = validatedURL || tab.url || '';
      tab.loading = false;
      tab.title = httpCode > 0 ? `Ошибка ${httpCode}` : 'Не удалось загрузить';
      const errorPageUrl = `${getLocalUrl('error.html')}?code=${httpCode}&url=${encodeURIComponent(failedUrl)}`;
      wc.loadURL(errorPageUrl);
      tab.url = errorPageUrl;
      const win = tab.window;
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab-loading', { id, loading: false });
        win.webContents.send('tab-title-updated', { id, title: tab.title });
        win.webContents.send('tab-url-updated', { id, url: tab.url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
      }
      return;
    }

    if (tab.url && tab.url.includes('127.0.0.1')) {
      tab.loading = false;
      tab.title = 'Новая вкладка';
      tab.url = 'about:blank';
      wc.loadURL('about:blank');
      const win = tab.window;
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab-loading', { id, loading: false });
        win.webContents.send('tab-title-updated', { id, title: tab.title });
      }
    }
  });

  // New window handler
  wc.setWindowOpenHandler(({ url }) => {
    const tab = tabViews.get(id);
    const win = tab ? tab.window : mainWindow;
    createTabView(url, { window: win });
    return { action: 'deny' };
  });

  // Context menu — handled directly in main process for BrowserView
  wc.on('context-menu', (event, params) => {
    const tab = tabViews.get(id);
    const win = tab ? tab.window : mainWindow;
    if (!win || win.isDestroyed()) return;

    const items = [];

    // Navigation
    items.push(
      { label: '← Назад', enabled: wc.canGoBack(), click: () => wc.goBack() },
      { label: '→ Вперёд', enabled: wc.canGoForward(), click: () => wc.goForward() },
      { label: '↻ Обновить', click: () => wc.reload() },
    );
    items.push({ type: 'separator' });

    // Zoom
    items.push(
      { label: '🔍+ Увеличить', click: () => { const t = tabViews.get(id); if (t) { t.zoomLevel = Math.min(4, (t.zoomLevel||0) + 0.5); wc.setZoomLevel(t.zoomLevel); if (t.id === getActiveTabId(t.window) && t.window && !t.window.isDestroyed()) t.window.webContents.send('tab-zoom-updated', { id, level: t.zoomLevel }); } } },
      { label: '🔍- Уменьшить', click: () => { const t = tabViews.get(id); if (t) { t.zoomLevel = Math.max(-3, (t.zoomLevel||0) - 0.5); wc.setZoomLevel(t.zoomLevel); if (t.id === getActiveTabId(t.window) && t.window && !t.window.isDestroyed()) t.window.webContents.send('tab-zoom-updated', { id, level: t.zoomLevel }); } } },
      { label: '🔍 Сбросить масштаб', click: () => { const t = tabViews.get(id); if (t) { t.zoomLevel = 0; wc.setZoomLevel(0); if (t.id === getActiveTabId(t.window) && t.window && !t.window.isDestroyed()) t.window.webContents.send('tab-zoom-updated', { id, level: 0 }); } } },
    );
    items.push({ type: 'separator' });

    // Selection
    if (params.selectionText) {
      items.push({ label: 'Копировать', click: () => { clipboard.writeText(params.selectionText); } });
      items.push({ type: 'separator' });
    }

    // Link actions
    if (params.linkURL) {
      items.push({ label: 'Открыть в новой вкладке', click: () => createTabView(params.linkURL, { window: win }) });
      items.push({ label: 'Копировать ссылку', click: () => { clipboard.writeText(params.linkURL); } });
      items.push({ type: 'separator' });
    }

    // Bookmark
    items.push({ label: '★ Добавить в закладки', click: () => { const t = tabViews.get(id); if (t && !isNewtabUrl(t.url)) { addBookmark(t.url, t.title, t.favicon); } } });

    // Copy page URL
    items.push({ type: 'separator' });
    items.push({ label: 'Копировать URL страницы', click: () => { const t = tabViews.get(id); if (t) clipboard.writeText(t.url || ''); } });

    const menu = Menu.buildFromTemplate(items);
    menu.popup(win);
  });

  // Audio state
  wc.on('audio-state-changed', () => {
    const tab = tabViews.get(id);
    if (tab) {
      tab.audible = wc.isCurrentlyAudible();
      const win = tab.window;
      if (win && !win.isDestroyed()) win.webContents.send('tab-audio-updated', { id, audible: tab.audible, muted: tab.muted });
    }
  });

  // Render process gone/crashed
  wc.on('render-process-gone', (event, details) => {
    console.error('[browserview] render process gone, tab', id, 'reason:', details.reason);
    const tab = tabViews.get(id);
    const win = tab ? tab.window : mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send('tab-crashed', { id });
  });

  // IPC from internal pages (settings, history, etc.) via webview-preload
  // The preload uses ipcRenderer.send('bv-internal-msg', msg) instead of sendToHost
  wc.ipc.on('bv-internal-msg', (event, msg) => {
    handleInternalPageMessage(id, msg);
  });
}

// ══════════════════════════════════════════════════════════════
//  Internal Page Message Handler
// ══════════════════════════════════════════════════════════════

function handleInternalPageMessage(tabId, msg) {
  if (!msg || !msg.type) return;
  const tab = tabViews.get(tabId);
  const wc = tab ? tab.view.webContents : null;
  if (!wc || wc.isDestroyed()) return;

  switch (msg.type) {
    case 'settings-get':
      wc.send('internal-response', { type: 'init-settings', settings: currentSettings });
      break;
    case 'settings-set':
      if (msg.key !== undefined) {
        currentSettings[msg.key] = msg.value; saveSettings(currentSettings);
        if (msg.key === 'theme') nativeTheme.themeSource = msg.value === 'system' ? 'system' : (msg.value === 'light' ? 'light' : 'dark');
        [mainWindow, ...incognitoWindows].forEach(w => {
          if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
        });
        wc.send('internal-response', { type: 'settings-updated', settings: currentSettings });
        // If showBookmarksBar changed, resize BrowserView
        if (msg.key === 'showBookmarksBar') {
          const win = tab.window;
          if (win && !win.isDestroyed()) {
            setTimeout(() => resizeActiveView(win), 50);
            setTimeout(() => resizeActiveView(win), 200);
          }
        }
      }
      break;
    case 'settings-export':
      wc.send('internal-response', { type: 'export-data', data: { settings: currentSettings, bookmarks } });
      break;
    case 'settings-import':
      if (msg.data) {
        if (msg.data.settings) { currentSettings = { ...DEFAULT_SETTINGS, ...msg.data.settings }; saveSettings(currentSettings); }
        if (Array.isArray(msg.data.bookmarks)) { bookmarks = msg.data.bookmarks; saveBookmarks(bookmarks); broadcastBookmarks(); }
        [mainWindow, ...incognitoWindows].forEach(w => {
          if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
        });
      }
      break;
    case 'settings-reset':
      currentSettings = { ...DEFAULT_SETTINGS }; saveSettings(currentSettings);
      nativeTheme.themeSource = 'dark';
      [mainWindow, ...incognitoWindows].forEach(w => {
        if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
      });
      break;
    case 'get-history':
      wc.send('internal-response', { type: 'init-history', entries: loadHistory() });
      break;
    case 'history-delete':
      if (msg.id) { const h = loadHistory().filter(e => e.id !== msg.id); saveHistory(h); }
      break;
    case 'history-clear':
      try { fs.writeFileSync(historyFile, '[]', 'utf-8'); } catch {}
      break;
    case 'history-open':
      if (msg.url) {
        const win = tab ? tab.window : mainWindow;
        createTabView(msg.url, { window: win });
      }
      break;
    case 'open-tab':
      if (msg.url) {
        const win = tab ? tab.window : mainWindow;
        createTabView(msg.url, { window: win });
      }
      break;
    case 'error-retry':
      if (msg.url) wc.loadURL(msg.url);
      break;
    case 'error-home':
      wc.loadURL(getLocalUrl('newtab.html'));
      break;
    case 'cache-get-size':
      getCacheSize().then(size => {
        if (!wc.isDestroyed()) wc.send('internal-response', { type: 'cache-size', size });
      });
      break;
    case 'cache-clear':
      session.defaultSession.clearCache().then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tab-cleared-cache');
        if (!wc.isDestroyed()) wc.send('internal-response', { type: 'cache-cleared' });
      });
      break;
    case 'cookies-get':
      session.defaultSession.cookies.get({}).then(cookies => {
        if (!wc.isDestroyed()) wc.send('internal-response', { type: 'cookies', data: cookies });
      });
      break;
    case 'cookies-clear':
      session.defaultSession.cookies.clearStorageData({}).then(() => {
        if (!wc.isDestroyed()) wc.send('internal-response', { type: 'cookies-cleared' });
      });
      break;
    case 'notification-event':
      showNotificationPopup({ title: msg.title, body: msg.body, icon: msg.icon, url: msg.url });
      break;
  }
}

// ── DPI Bypass ────────────────────────────────────────────────
function getBypassBinaryPath() {
  const c = [
    path.join(process.resourcesPath, 'bypass', 'winws.exe'),
    path.join(process.resourcesPath, 'bypass', 'goodbyedpi.exe'),
    path.join(__dirname, 'bypass', 'winws.exe'),
    path.join(__dirname, 'bypass', 'goodbyedpi.exe'),
  ];
  for (const p of c) { if (fs.existsSync(p)) return { path: p, type: p.includes('winws') ? 'winws' : 'goodbyedpi' }; }
  return null;
}

function startBypass() {
  if (bypassProcess) return;
  const bin = getBypassBinaryPath();
  if (!bin) return false;
  let args = bin.type === 'winws'
    ? ['--wf-tcp=80,443', '--wf-udp=443,50000-65535', '--strategy', 'disorder_autottl;fake;syndata;udplen;disorder', '--dpi-desync=split2', '--dpi-desync-ttl=5', '--dpi-desync-fake-tls=0x00000000', '--new', '--dpi-desync=fake,split2', '--dpi-desync-repeats=11']
    : ['-p', '-r', '-s', '-n', '-e', '40', '--dns-addr', '77.88.8.8', '--dns-port', '53'];
  try {
    bypassProcess = spawn(bin.path, args, { detached: false, stdio: 'ignore', windowsHide: true });
    bypassProcess.on('exit', () => { bypassProcess = null; });
    bypassEnabled = true; return true;
  } catch (e) { return false; }
}
function stopBypass() { if (bypassProcess) { bypassProcess.kill(); bypassProcess = null; } bypassEnabled = false; }

// ── Window ────────────────────────────────────────────────────
function createWindow(incognito = false) {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 700, minHeight: 500,
    frame: false,
    backgroundMaterial: 'mica',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      // No webviewTag — using BrowserView instead
    },
    show: false,
  });
  win.loadFile(path.join(__dirname, 'src', 'browser.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (incognito) {
      win.webContents.executeJavaScript(`document.body.classList.add('incognito-mode')`);
      win.webContents.send('incognito-mode', true);
    }
  });

  // ── Fullscreen state preservation + BrowserView resize ──
  win.on('resize', () => resizeActiveView(win));
  win.on('maximize', () => {
    setTimeout(() => resizeActiveView(win), 50);
    setTimeout(() => resizeActiveView(win), 200);
    repositionNotifications();
  });
  win.on('unmaximize', () => {
    setTimeout(() => resizeActiveView(win), 50);
    setTimeout(() => resizeActiveView(win), 200);
    repositionNotifications();
  });
  win.on('enter-full-screen', () => {
    // Multiple resize attempts for robust fullscreen transition
    [50, 100, 200, 400].forEach(delay => {
      setTimeout(() => resizeActiveView(win), delay);
    });
    win.webContents.send('fullscreen-change', true);
  });
  win.on('leave-full-screen', () => {
    // Multiple resize attempts for robust fullscreen transition
    [50, 100, 200, 400].forEach(delay => {
      setTimeout(() => resizeActiveView(win), delay);
    });
    win.webContents.send('fullscreen-change', false);
  });

  // Reposition notification popups when window moves/resizes
  win.on('move', repositionNotifications);

  if (!incognito) {
    win.on('close', () => {
      try {
        // Save tabs directly from main process tabViews
        const tabData = [...tabViews.values()]
          .filter(t => t.window === win)
          .map(t => ({
            url: t.url && !t.url.includes('127.0.0.1') && !t.url.startsWith('about:') ? t.url : '',
            title: t.title || '',
          }))
          .filter(t => t.url);
        if (tabData.length > 0) saveTabSession(tabData);
      } catch (e) {}
    });
    win.on('closed', () => {
      // Clean up all BrowserView tabs for this window
      const tabsToRemove = [...tabViews.values()].filter(t => t.window === win).map(t => t.id);
      tabsToRemove.forEach(tid => {
        const tab = tabViews.get(tid);
        if (tab) {
          try { tab.view.webContents.close(); } catch {}
          tabViews.delete(tid);
        }
      });
      windowActiveTabIds.delete(win);
      stopBypass();
      mainWindow = null;
    });
  } else {
    win.on('closed', () => {
      // Clean up all BrowserView tabs for this incognito window
      const tabsToRemove = [...tabViews.values()].filter(t => t.window === win).map(t => t.id);
      tabsToRemove.forEach(tid => {
        const tab = tabViews.get(tid);
        if (tab) {
          try { tab.view.webContents.close(); } catch {}
          tabViews.delete(tid);
        }
      });
      windowActiveTabIds.delete(win);
      incognitoWindows = incognitoWindows.filter(w => w !== win);
    });
  }

  Menu.setApplicationMenu(null);

  if (incognito) {
    incognitoWindows.push(win);
  } else {
    mainWindow = win;
  }
  return win;
}

// ── IPC: Window ──────────────────────────────────────────────
ipcMain.on('window-minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.on('window-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
});
ipcMain.on('window-close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});
ipcMain.on('window-incognito', () => {
  const win = createWindow(true);
  // Create initial new tab for incognito window after renderer is ready
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      createTabView(getLocalUrl('newtab.html'), { window: win });
    }, 100);
  });
});

// ── IPC: Paths & URLs ────────────────────────────────────────
ipcMain.handle('get-newtab-url', () => getLocalUrl('newtab.html'));
ipcMain.handle('get-settings-url', () => getLocalUrl('settings.html'));
ipcMain.handle('get-history-url', () => getLocalUrl('history.html'));
ipcMain.handle('get-error-url', () => getLocalUrl('error.html'));

// ── IPC: Bypass ──────────────────────────────────────────────
ipcMain.on('bypass-toggle', (e) => {
  if (bypassEnabled) stopBypass(); else { if (!startBypass()) e.sender.send('bypass-no-binary'); }
});

// ── IPC: Bookmarks ───────────────────────────────────────────
ipcMain.handle('bookmarks-get', () => bookmarks);
ipcMain.handle('bookmark-add', (_, { url, title, favicon }) => { const bm = addBookmark(url, title, favicon); return bm; });
ipcMain.handle('bookmark-remove', (_, { id }) => { const r = removeBookmark(id); return r; });
ipcMain.handle('bookmark-toggle', (_, { url, title, favicon }) => {
  const ex = getBookmarkForUrl(url);
  if (ex) { removeBookmark(ex.id); return { action: 'removed', bookmark: ex }; }
  const bm = addBookmark(url, title, favicon); return { action: 'added', bookmark: bm };
});
ipcMain.handle('bookmark-check', (_, { url }) => isBookmarked(url));

// ── IPC: Settings ────────────────────────────────────────────
ipcMain.handle('settings-get', () => currentSettings);
ipcMain.handle('settings-set', (_, { key, value }) => {
  currentSettings[key] = value; saveSettings(currentSettings);
  if (key === 'theme') nativeTheme.themeSource = value === 'system' ? 'system' : (value === 'light' ? 'light' : 'dark');
  [mainWindow, ...incognitoWindows].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
  });
  // If showBookmarksBar changed, resize BrowserViews
  if (key === 'showBookmarksBar') {
    [mainWindow, ...incognitoWindows].forEach(w => {
      if (w && !w.isDestroyed()) {
        setTimeout(() => resizeActiveView(w), 50);
        setTimeout(() => resizeActiveView(w), 200);
      }
    });
  }
  return currentSettings;
});
ipcMain.handle('settings-reset', () => {
  currentSettings = { ...DEFAULT_SETTINGS }; saveSettings(currentSettings);
  nativeTheme.themeSource = 'dark';
  [mainWindow, ...incognitoWindows].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
  });
  return currentSettings;
});
ipcMain.handle('settings-export', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const r = dialog.showOpenDialogSync(win, { title: 'Экспорт настроек', defaultPath: 'integral-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openDirectory'] });
  if (!r) return { success: false };
  try { fs.writeFileSync(path.join(r[0], 'integral-settings.json'), JSON.stringify({ settings: currentSettings, bookmarks }, null, 2), 'utf-8'); return { success: true }; }
  catch (ex) { return { success: false, error: ex.message }; }
});
ipcMain.handle('settings-import', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const r = dialog.showOpenDialogSync(win, { title: 'Импорт настроек', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (!r) return { success: false };
  try {
    const d = JSON.parse(fs.readFileSync(r[0], 'utf-8'));
    if (d.settings) { currentSettings = { ...DEFAULT_SETTINGS, ...d.settings }; saveSettings(currentSettings); nativeTheme.themeSource = d.settings.theme === 'system' ? 'system' : 'dark'; }
    if (Array.isArray(d.bookmarks)) { bookmarks = d.bookmarks; saveBookmarks(bookmarks); broadcastBookmarks(); }
    [mainWindow, ...incognitoWindows].forEach(w => {
      if (w && !w.isDestroyed()) w.webContents.send('settings-changed', currentSettings);
    });
    return { success: true };
  } catch (ex) { return { success: false, error: ex.message }; }
});

// ── IPC: Tabs Session ────────────────────────────────────────
ipcMain.handle('get-saved-tabs', () => loadTabSession());
ipcMain.on('save-tabs-session', (_, tabData) => saveTabSession(tabData));

// ── IPC: History ─────────────────────────────────────────────
ipcMain.handle('history-get', () => loadHistory());
ipcMain.on('history-add', (_, { url, title }) => addHistoryEntry(url, title));
ipcMain.on('history-clear', () => { try { fs.writeFileSync(historyFile, '[]', 'utf-8'); } catch {} });
ipcMain.on('history-delete', (_, { id }) => {
  const h = loadHistory().filter(e => e.id !== id);
  saveHistory(h);
});

// ── IPC: Cookies ─────────────────────────────────────────────
ipcMain.handle('cookies-get', async () => {
  return session.defaultSession.cookies.get({});
});
ipcMain.handle('cookies-clear', async () => {
  await session.defaultSession.cookies.clearStorageData({});
  return { success: true };
});

// ── IPC: Cache ───────────────────────────────────────────────
ipcMain.handle('cache-get-size', async () => {
  return getCacheSize();
});
ipcMain.handle('cache-clear', async () => {
  await session.defaultSession.clearCache();
  return { success: true };
});

// ══════════════════════════════════════════════════════════════
//  IPC: BrowserView Tab Management (Renderer → Main)
// ══════════════════════════════════════════════════════════════

ipcMain.handle('tab-create', (_, { url, opts }) => {
  const win = opts && opts.window ? opts.window : mainWindow;
  return createTabView(url, { ...opts, window: win });
});

ipcMain.on('tab-close', (_, { id }) => {
  closeTabView(id);
});

ipcMain.on('tab-set-active', (_, { id }) => {
  const tab = tabViews.get(id);
  const win = tab ? tab.window : mainWindow;
  setActiveTab(id, win);
});

ipcMain.on('tab-navigate', (_, { id, url }) => {
  const tab = tabViews.get(id);
  if (tab && tab.view) {
    tab.url = url;
    tab.loading = true;
    tab.view.webContents.loadURL(url);
    const win = tab.window;
    if (win && !win.isDestroyed()) win.webContents.send('tab-loading', { id, loading: true });
  }
});

ipcMain.on('tab-go-back', (_, { id }) => {
  const tab = tabViews.get(id);
  if (tab && tab.view) tab.view.webContents.goBack();
});

ipcMain.on('tab-go-forward', (_, { id }) => {
  const tab = tabViews.get(id);
  if (tab && tab.view) tab.view.webContents.goForward();
});

ipcMain.on('tab-reload', (_, { id }) => {
  const tab = tabViews.get(id);
  if (tab && tab.view) tab.view.webContents.reload();
});

ipcMain.on('tab-stop', (_, { id }) => {
  const tab = tabViews.get(id);
  if (tab && tab.view) tab.view.webContents.stop();
});

ipcMain.on('tab-set-zoom', (_, { id, level }) => {
  const tab = tabViews.get(id);
  if (tab) {
    tab.zoomLevel = level;
    try { tab.view.webContents.setZoomLevel(level); } catch {}
    if (tab.window && !tab.window.isDestroyed() && id === getActiveTabId(tab.window)) {
      tab.window.webContents.send('tab-zoom-updated', { id, level });
    }
  }
});

ipcMain.on('tab-set-muted', (_, { id, muted }) => {
  const tab = tabViews.get(id);
  if (tab) {
    tab.muted = muted;
    tab.view.webContents.setAudioMuted(muted);
    const win = tab.window;
    if (win && !win.isDestroyed()) win.webContents.send('tab-audio-updated', { id, audible: tab.audible, muted: tab.muted });
  }
});

ipcMain.on('tab-set-pinned', (_, { id, pinned }) => {
  const tab = tabViews.get(id);
  if (tab) {
    tab.pinned = pinned;
    const win = tab.window;
    if (win && !win.isDestroyed()) win.webContents.send('tab-state-updated', { id, pinned });
  }
});

ipcMain.on('tab-set-group', (_, { id, group }) => {
  const tab = tabViews.get(id);
  if (tab) {
    tab.group = group;
    const win = tab.window;
    if (win && !win.isDestroyed()) win.webContents.send('tab-state-updated', { id, group });
  }
});

ipcMain.handle('tab-get-all', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  return [...tabViews.values()]
    .filter(t => t.window === win)
    .map(serializeTab);
});

ipcMain.handle('tab-get-active', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  return getActiveTabId(win);
});

ipcMain.on('notify-chrome-height', (e, { height }) => {
  // Resize active BrowserView when chrome height changes (e.g., bookmarks bar toggle)
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  setTimeout(() => resizeActiveView(win), 30);
  setTimeout(() => resizeActiveView(win), 100);
});

// Renderer signals it's ready for tab events
ipcMain.on('renderer-ready', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;

  if (win === mainWindow) {
    // Restore saved tabs or create a new tab for main window
    const savedTabs = loadTabSession();
    if (savedTabs && savedTabs.length > 0) {
      console.log('[init] restoring', savedTabs.length, 'saved tabs');
      savedTabs.forEach((t, i) => {
        const url = t.url && !t.url.startsWith('http://127.0.0.1') ? t.url : getLocalUrl('newtab.html');
        if (i === 0) {
          createTabView(url, { title: t.title, window: win });
        } else {
          createTabView(url, { title: t.title, active: false, window: win });
        }
      });
    } else {
      console.log('[init] no saved tabs, creating default');
      createTabView(getLocalUrl('newtab.html'), { window: win });
    }
  } else {
    // Incognito window — create a single new tab
    createTabView(getLocalUrl('newtab.html'), { window: win });
  }
});

// ── IPC: Zoom ────────────────────────────────────────────────
ipcMain.on('zoom-in', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const activeId = getActiveTabId(win);
  if (activeId) {
    const tab = tabViews.get(activeId);
    if (tab) {
      tab.zoomLevel = Math.min(4, (tab.zoomLevel || 0) + 0.5);
      try { tab.view.webContents.setZoomLevel(tab.zoomLevel); } catch {}
      if (win && !win.isDestroyed()) win.webContents.send('tab-zoom-updated', { id: activeId, level: tab.zoomLevel });
    }
  }
});
ipcMain.on('zoom-out', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const activeId = getActiveTabId(win);
  if (activeId) {
    const tab = tabViews.get(activeId);
    if (tab) {
      tab.zoomLevel = Math.max(-3, (tab.zoomLevel || 0) - 0.5);
      try { tab.view.webContents.setZoomLevel(tab.zoomLevel); } catch {}
      if (win && !win.isDestroyed()) win.webContents.send('tab-zoom-updated', { id: activeId, level: tab.zoomLevel });
    }
  }
});
ipcMain.on('zoom-reset', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const activeId = getActiveTabId(win);
  if (activeId) {
    const tab = tabViews.get(activeId);
    if (tab) {
      tab.zoomLevel = 0;
      try { tab.view.webContents.setZoomLevel(0); } catch {}
      if (win && !win.isDestroyed()) win.webContents.send('tab-zoom-updated', { id: activeId, level: 0 });
    }
  }
});

// ── IPC: Native Context Menu for Tabs ────────────────────────
ipcMain.on('show-tab-context-menu', (e, params) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;

  const sendAction = (action) => win.webContents.send('ctx-action', action);

  const items = [];

  items.push(
    { label: params.pinned ? 'Открепить вкладку' : 'Закрепить вкладку', click: () => sendAction('tab-pin') },
    { label: params.muted ? 'Включить звук' : 'Отключить звук', click: () => sendAction('tab-mute') },
    { type: 'separator' },
  );

  // Group color submenu
  const groupColors = [
    { label: 'Красная', color: 'red' },
    { label: 'Оранжевая', color: 'orange' },
    { label: 'Жёлтая', color: 'yellow' },
    { label: 'Зелёная', color: 'green' },
    { label: 'Синяя', color: 'blue' },
    { label: 'Фиолетовая', color: 'purple' },
  ];

  const groupSubmenu = groupColors.map(gc => ({
    label: gc.label,
    click: () => sendAction({ action: 'tab-group', color: gc.color }),
  }));
  groupSubmenu.push({ type: 'separator' });
  groupSubmenu.push({ label: 'Без группы', click: () => sendAction({ action: 'tab-group', color: null }) });

  items.push({ label: 'Цвет группы', submenu: groupSubmenu });
  items.push({ type: 'separator' });

  items.push(
    { label: 'Закрыть другие', click: () => sendAction('tab-close-others') },
    { label: 'Закрыть справа', click: () => sendAction('tab-close-right') },
    { label: 'Закрыть вкладку', click: () => sendAction('tab-close') },
  );

  const menu = Menu.buildFromTemplate(items);
  menu.popup(win, Math.round(params.x), Math.round(params.y));
});

// ── IPC: Native Context Menu for Bookmarks Bar ─────────────────
ipcMain.on('show-bm-context-menu', (e, params) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;

  const sendAction = (action) => win.webContents.send('ctx-action', action);

  const items = [];
  items.push(
    { label: 'Открыть', click: () => sendAction({ action: 'bm-open', url: params.url }) },
    { label: 'Открыть в новой вкладке', click: () => sendAction({ action: 'bm-open-new', url: params.url }) },
    { type: 'separator' },
    { label: 'Копировать URL', click: () => { clipboard.writeText(params.url || ''); sendAction('copied'); } },
    { label: 'Удалить', click: () => sendAction({ action: 'bm-delete', id: params.id }) },
  );

  const menu = Menu.buildFromTemplate(items);
  menu.popup(win, Math.round(params.x), Math.round(params.y));
});

// ── Notification Popup System ──────────────────────────────────
let activeNotifications = [];

function showNotificationPopup(notifData) {
  if (!mainWindow) return;

  const mainBounds = mainWindow.getBounds();
  const notifWidth = 360;
  const notifHeight = 80;
  const padding = 12;

  const yPos = mainBounds.y + padding + (activeNotifications.length * (notifHeight + 8));
  const xPos = mainBounds.x + mainBounds.width - notifWidth - padding;

  const notifWin = new BrowserWindow({
    width: notifWidth,
    height: notifHeight,
    x: xPos,
    y: yPos,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const iconHtml = notifData.icon
    ? `<img src="${notifData.icon}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
    : `<div style="width:36px;height:36px;border-radius:8px;background:rgba(139,92,246,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#a78bfa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#a78bfa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;

  const escapedTitle = (notifData.title || 'Уведомление').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escapedBody = (notifData.body || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const html = `<!DOCTYPE html><html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, 'Segoe UI', sans-serif;
      background: rgba(26,26,27,.92);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      height: 100vh;
      overflow: hidden;
      cursor: pointer;
      animation: notifIn .3s cubic-bezier(.16,1,.3,1) both;
    }
    @keyframes notifIn { from { opacity:0; transform:translateY(-8px) scale(.96); } to { opacity:1; transform:none; } }
    @keyframes notifOut { from { opacity:1; transform:none; } to { opacity:0; transform:translateY(-8px) scale(.96); } }
    .notif-out { animation: notifOut .25s cubic-bezier(.16,1,.3,1) both; }
    .notif-content { flex:1; min-width:0; }
    .notif-title { font-size:13px; font-weight:700; color:#efefef; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3; }
    .notif-body { font-size:12px; font-weight:500; color:rgba(239,239,239,.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; line-height:1.3; }
  </style></head><body>
    ${iconHtml}
    <div class="notif-content">
      <div class="notif-title">${escapedTitle}</div>
      ${escapedBody ? `<div class="notif-body">${escapedBody}</div>` : ''}
    </div>
  </body></html>`;

  notifWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  const notifEntry = { win: notifWin, timer: null, url: notifData.url || null };
  activeNotifications.push(notifEntry);

  notifWin.webContents.on('did-finish-load', () => {
    notifWin.webContents.executeJavaScript(`
      document.body.addEventListener('click', () => {
        window.close();
      });
    `);
  });

  notifEntry.timer = setTimeout(() => {
    closeNotification(notifEntry);
  }, 5000);

  notifWin.on('closed', () => {
    clearTimeout(notifEntry.timer);
    activeNotifications = activeNotifications.filter(n => n !== notifEntry);
    repositionNotifications();
  });

  return notifEntry;
}

function closeNotification(entry) {
  if (!entry || entry.win.isDestroyed()) return;
  entry.win.webContents.executeJavaScript(`
    document.body.classList.add('notif-out');
  `).then(() => {
    setTimeout(() => {
      try { entry.win.close(); } catch {}
    }, 250);
  }).catch(() => {
    try { entry.win.close(); } catch {}
  });
}

function repositionNotifications() {
  if (!mainWindow) return;
  const mainBounds = mainWindow.getBounds();
  const notifWidth = 360;
  const notifHeight = 80;
  const padding = 12;

  activeNotifications.forEach((entry, i) => {
    if (entry.win.isDestroyed()) return;
    const yPos = mainBounds.y + padding + (i * (notifHeight + 8));
    const xPos = mainBounds.x + mainBounds.width - notifWidth - padding;
    entry.win.setPosition(xPos, yPos);
  });
}

// ── IPC: Notification Popup ────────────────────────────────────
ipcMain.on('show-notification-popup', (_, notifData) => {
  showNotificationPopup(notifData);
});

// ── IPC: State ───────────────────────────────────────────────
ipcMain.handle('get-state', () => ({
  bookmarks,
  settings: currentSettings,
  bypassEnabled,
  bypassAvailable: !!getBypassBinaryPath(),
  localPort: localServerPort,
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── Tracker Blocking ─────────────────────────────────────────
const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'connect.facebook.net', 'analytics.facebook.com',
  'hotjar.com', 'mixpanel.com', 'amplitude.com', 'segment.io',
  'mc.yandex.ru', 'counter.yadro.ru',
  'hm.baidu.com', 'analytics.google.com', 'bat.bing.com',
];

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(async () => {
  await startLocalServer();

  // Tracker blocking via webRequest
  const trackerPatterns = TRACKER_DOMAINS.map(d => `*://*.${d}/*`);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [...trackerPatterns, '*://ssl.gstatic.com/safebrowsing/*', '*://*.googleapis.com/safebrowsing/*'] },
    (_, cb) => cb({ cancel: true })
  );

  // Preconnect to common search engines on startup
  try {
    ['https://yandex.ru', 'https://www.google.com', 'https://duckduckgo.com'].forEach(url => {
      session.defaultSession.preconnect(url);
    });
  } catch (e) {
    console.warn('[preconnect] failed:', e.message);
  }

  // DNS prefetch for bookmarked sites
  function prefetchDns(urls) {
    try {
      urls.slice(0, 20).forEach(url => {
        try { session.defaultSession.preconnect(new URL(url).origin); } catch {}
      });
    } catch {}
  }
  setTimeout(() => {
    try { prefetchDns(bookmarks.map(b => b.url)); } catch {}
  }, 3000);

  createWindow(false);
  if (currentSettings.bypassOnStart) startBypass();
});

app.on('window-all-closed', () => {
  localServer.close();
  stopBypass();
  app.quit();
});
app.on('before-quit', () => {
  localServer.close();
  stopBypass();
});
