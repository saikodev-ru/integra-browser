const { app, BrowserWindow, ipcMain, session, shell, Menu, nativeTheme, dialog } = require('electron');
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
    frame: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      webviewTag: true,
    },
    show: false, titleBarStyle: 'hidden',
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
    // Save tabs before closing
    win.on('close', () => {
      try {
        win.webContents.send('save-tabs');
        // sync save-tabs is not possible, but we have an IPC from renderer
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

// ── IPC: State ───────────────────────────────────────────────
ipcMain.handle('get-state', () => ({
  bookmarks,
  settings: currentSettings,
  bypassEnabled,
  bypassAvailable: !!getBypassBinaryPath(),
  localPort: localServerPort,
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(async () => {
  await startLocalServer();

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*.google-analytics.com/*', '*://*.doubleclick.net/*', '*://ssl.gstatic.com/safebrowsing/*', '*://*.googleapis.com/safebrowsing/*'] },
    (_, cb) => cb({ cancel: true })
  );

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
