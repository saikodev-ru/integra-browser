const { app, BrowserWindow, ipcMain, session, shell, Menu, nativeTheme, dialog, protocol, net } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// ── No telemetry ──────────────────────────────────────────────
app.setPath('crashDumps', path.join(app.getPath('temp'), 'integra-noop'));
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-features', 'Reporting,NetworkQualityEstimator,URLLoading,SafeBrowsingEnhancedProtection');
app.commandLine.appendSwitch('no-report-upload');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');

// ── Register custom protocol for local pages (avoids file:// restrictions in webviews) ──
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true,
      standard: false,
      secure: true,
      corsEnabled: true,
    },
  },
]);

// ── Persistent Data Paths ────────────────────────────────────
const userDataPath = app.getPath('userData');
const dataDir = path.join(userDataPath, 'integra-data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const settingsFile = path.join(dataDir, 'settings.json');
const bookmarksFile = path.join(dataDir, 'bookmarks.json');

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
  languages: [
    { name: 'Яндекс', value: 'yandex', url: 'https://yandex.ru/search/?text=' },
    { name: 'Google',  value: 'google',  url: 'https://www.google.com/search?q=' },
    { name: 'DuckDuckGo', value: 'duckduckgo', url: 'https://duckduckgo.com/?q=' },
  ],
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
  win.on('closed', () => {
    if (!incognito) { stopBypass(); mainWindow = null; }
    else { incognitoWindows = incognitoWindows.filter(w => w !== win); }
  });
  Menu.setApplicationMenu(null);

  if (incognito) {
    incognitoWindows.push(win);
    win.on('closed', () => {
      incognitoWindows = incognitoWindows.filter(w => w !== win);
    });
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

// ── IPC: Paths ───────────────────────────────────────────────
ipcMain.handle('get-webview-preload-path', () => path.join(__dirname, 'webview-preload.js'));
ipcMain.handle('get-newtab-url', () => 'local://newtab.html');

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
  // Broadcast to all windows
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

// ── IPC: State ───────────────────────────────────────────────
ipcMain.handle('get-state', () => ({
  bookmarks,
  settings: currentSettings,
  bypassEnabled,
  bypassAvailable: !!getBypassBinaryPath(),
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  // ── Serve local files via local:// protocol ────────────────
  protocol.handle('local', (request) => {
    try {
      const urlPath = new URL(request.url).pathname.replace(/^\//, '');
      const filePath = path.join(__dirname, 'src', urlPath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      if (!fs.existsSync(filePath)) {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response(fs.createReadStream(filePath), {
        headers: { 'Content-Type': contentType },
      });
    } catch (e) {
      console.error('[protocol] local:// handler error:', e);
      return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  });

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*.google-analytics.com/*', '*://*.doubleclick.net/*', '*://ssl.gstatic.com/safebrowsing/*', '*://*.googleapis.com/safebrowsing/*'] },
    (_, cb) => cb({ cancel: true })
  );
  createWindow(false);
  if (currentSettings.bypassOnStart) startBypass();
});

app.on('window-all-closed', () => { stopBypass(); app.quit(); });
app.on('before-quit', () => stopBypass());
