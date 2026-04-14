const { app, BrowserWindow, ipcMain, session, shell, Menu, nativeTheme, dialog, clipboard } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

// ── No telemetry ──────────────────────────────────────────────
app.setPath('crashDumps', path.join(app.getPath('temp'), 'integra-noop'));
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-features', 'Reporting,NetworkQualityEstimator,SafeBrowsingEnhancedProtection');
app.commandLine.appendSwitch('no-report-upload');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');

// ── Local HTTP Server (for serving local pages to webviews with partition) ──
let localServerPort = 0;
const localServer = http.createServer((req, res) => {
  try {
    // Decode and sanitize path
    const urlPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    // Security: prevent directory traversal
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
const dataDir = path.join(userDataPath, 'integra-data');
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
  bypassOnStart: false,
  showBookmarksBar: true,
  clearOnExit: false,
  fontSize: 14,
  transparentChrome: false,
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
function broadcastBookmarks() { if (mainWindow) mainWindow.webContents.send('bookmarks-update', bookmarks); }

// ── History CRUD ─────────────────────────────────────────────
function loadHistory() {
  try { if (fs.existsSync(historyFile)) return JSON.parse(fs.readFileSync(historyFile, 'utf-8')); } catch {}
  return [];
}
function saveHistory(h) { try { fs.writeFileSync(historyFile, JSON.stringify(h.slice(0, 5000), null, 2), 'utf-8'); } catch {} }
function addHistoryEntry(url, title) {
  if (!url || url.includes('127.0.0.1') || url.startsWith('about:')) return;
  // Skip internal pages
  if (url.includes('settings.html') || url.includes('history.html') || url.includes('error.html') || url.includes('newtab.html')) return;
  const h = loadHistory();
  // Remove duplicate
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
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      webviewTag: true,
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
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-change', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-change', false));

  if (!incognito) {
    win.on('close', () => {
      try {
        win.webContents.send('save-tabs');
      } catch (e) {}
    });
    win.on('closed', () => { stopBypass(); mainWindow = null; });
  } else {
    win.on('closed', () => { incognitoWindows = incognitoWindows.filter(w => w !== win); });
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
ipcMain.on('window-incognito', () => createWindow(true));

// ── IPC: Paths & URLs ────────────────────────────────────────
ipcMain.handle('get-webview-preload-path', () => path.join(__dirname, 'webview-preload.js'));
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
  if (key === 'theme') nativeTheme.themeSource = value === 'system' ? 'system' : 'dark';
  [mainWindow, ...incognitoWindows].forEach(w => {
    if (w) w.webContents.send('settings-changed', currentSettings);
  });
  return currentSettings;
});
ipcMain.handle('settings-reset', () => {
  currentSettings = { ...DEFAULT_SETTINGS }; saveSettings(currentSettings);
  nativeTheme.themeSource = 'dark';
  [mainWindow, ...incognitoWindows].forEach(w => {
    if (w) w.webContents.send('settings-changed', currentSettings);
  });
  return currentSettings;
});
ipcMain.handle('settings-export', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  const r = dialog.showOpenDialogSync(win, { title: 'Экспорт настроек', defaultPath: 'integra-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openDirectory'] });
  if (!r) return { success: false };
  try { fs.writeFileSync(path.join(r[0], 'integra-settings.json'), JSON.stringify({ settings: currentSettings, bookmarks }, null, 2), 'utf-8'); return { success: true }; }
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
      if (w) w.webContents.send('settings-changed', currentSettings);
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
  // Estimate cache size from session
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
});
ipcMain.handle('cache-clear', async () => {
  await session.defaultSession.clearCache();
  return { success: true };
});

// ── IPC: Zoom ────────────────────────────────────────────────
ipcMain.on('zoom-in', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && mainWindow) {
    const activeTabId = e.sender === mainWindow.webContents ? 'active' : null;
    // Send to renderer to handle per-tab zoom
    // We use a different approach: the renderer handles zoom locally
  }
});
ipcMain.on('zoom-out', (e) => {});
ipcMain.on('zoom-reset', (e) => {});

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

// ── IPC: Native Context Menu for Webview ─────────────────────
ipcMain.on('show-page-context-menu', (e, params) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;

  const sendAction = (action) => win.webContents.send('ctx-action', action);

  const items = [];

  // Navigation
  items.push(
    { label: '← Назад', enabled: !!params.canGoBack, click: () => sendAction('back') },
    { label: '→ Вперёд', enabled: !!params.canGoForward, click: () => sendAction('forward') },
    { label: '↻ Обновить', click: () => sendAction('reload') },
  );
  items.push({ type: 'separator' });

  // Zoom
  items.push(
    { label: '🔍+ Увеличить', click: () => sendAction('zoom-in') },
    { label: '🔍- Уменьшить', click: () => sendAction('zoom-out') },
    { label: '🔍 Сбросить масштаб', click: () => sendAction('zoom-reset') },
  );
  items.push({ type: 'separator' });

  // Edit (if text selected)
  if (params.selectionText) {
    items.push(
      { label: 'Копировать выделенное', click: () => { clipboard.writeText(params.selectionText); sendAction('copied'); } },
    );
    items.push({ type: 'separator' });
  }

  // Link actions
  if (params.linkURL && params.linkURL !== '') {
    items.push(
      { label: 'Открыть ссылку', click: () => sendAction({ action: 'open-link', url: params.linkURL }) },
      { label: 'Открыть в новой вкладке', click: () => sendAction({ action: 'open-link-tab', url: params.linkURL }) },
      { label: 'Копировать ссылку', click: () => { clipboard.writeText(params.linkURL); sendAction('copied'); } },
    );
    items.push({ type: 'separator' });
  }

  // Page actions
  items.push(
    { label: '★ Добавить в закладки', click: () => sendAction('bookmark-toggle') },
    { label: '+ Новая вкладка', click: () => sendAction('new-tab') },
  );
  items.push({ type: 'separator' });
  items.push(
    { label: 'Копировать URL страницы', click: () => { clipboard.writeText(params.pageURL || ''); sendAction('copied'); } },
  );

  const menu = Menu.buildFromTemplate(items);
  menu.popup(win, Math.round(params.x), Math.round(params.y));
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
  // Prefetch for bookmarks after a short delay
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
