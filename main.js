const { app, BrowserWindow, BrowserView, ipcMain, session, shell, Menu, nativeTheme, dialog } = require('electron');
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

const TABBAR_H = 40;
const NAVBAR_H = 52;
const BOOKMARKSBAR_H = 34;
let bookmarksBarVisible = false;

function getChromeHeight() {
  return TABBAR_H + NAVBAR_H + (bookmarksBarVisible ? BOOKMARKSBAR_H : 0);
}

let tabs = [];
let activeTabId = null;
let nextTabId = 1;
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

// ── Recalculate bookmarks bar visibility ─────────────────────
function recalcBookmarksBar() {
  const show = currentSettings.showBookmarksBar && bookmarks.length > 0;
  if (show === bookmarksBarVisible) return;
  bookmarksBarVisible = show;
  updateViewBounds();
  if (mainWindow) mainWindow.webContents.send('bookmarks-bar-visibility', show);
}

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 700, minHeight: 500,
    frame: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
    show: false, titleBarStyle: 'hidden',
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'browser.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); createTab(); });
  mainWindow.on('resize', () => updateViewBounds());
  mainWindow.on('enter-full-screen', () => { mainWindow.webContents.send('fullscreen-change', true); updateViewBounds(); });
  mainWindow.on('leave-full-screen', () => { mainWindow.webContents.send('fullscreen-change', false); updateViewBounds(); });
  mainWindow.on('closed', () => { stopBypass(); mainWindow = null; });
  Menu.setApplicationMenu(null);
}

// ── Incognito Window ─────────────────────────────────────────
function createIncognitoWindow(url) {
  const ses = session.fromPartition('incognito-' + Date.now());
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 700, minHeight: 500,
    frame: false, backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
    show: false, titleBarStyle: 'hidden',
  });
  win.loadFile(path.join(__dirname, 'src', 'browser.html'));
  incognitoWindows.push(win);

  win.webContents.executeJavaScript(`
    document.body.classList.add('incognito-mode');
  `);

  win.once('ready-to-show', () => { win.show(); });
  win.on('closed', () => {
    incognitoWindows = incognitoWindows.filter(w => w !== win);
    // Clear incognito session data
    ses.clearStorageData().catch(() => {});
  });

  Menu.setApplicationMenu(null);
}

// ── Tab helpers ───────────────────────────────────────────────
function getTab(id) { return tabs.find(t => t.id === id); }
function getActiveTab() { return getTab(activeTabId); }

function updateViewBounds() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  const isFullscreen = mainWindow.isFullScreen();
  const chromeH = isFullscreen ? 0 : getChromeHeight();
  tabs.forEach(tab => {
    if (!tab.pinned || tab.id === activeTabId) {
      tab.view.setBounds({ x: 0, y: chromeH, width: w, height: h - chromeH });
    } else {
      tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  });
}

const NEWTAB_URL = `file://${path.join(__dirname, 'src', 'newtab.html')}`;
function resolveTabUrl(url) { if (!url || url === 'about:blank' || url === 'newtab') return NEWTAB_URL; return url; }
function getSearchUrl(query) {
  const e = currentSettings.languages.find(x => x.value === currentSettings.searchEngine);
  return (e ? e.url : 'https://yandex.ru/search/?text=') + encodeURIComponent(query);
}

function createTab(url = NEWTAB_URL, opts = {}) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:main' },
  });
  mainWindow.addBrowserView(view);
  view.setAutoResize({ width: true, height: true });

  const tab = {
    id, view, url, title: 'Новая вкладка', favicon: null, loading: false,
    pinned: opts.pinned || false,
    muted: opts.muted || false,
    audible: false,
    group: opts.group || null,
  };
  tabs.push(tab);

  const wc = view.webContents;
  wc.on('did-start-loading', () => { tab.loading = true; sendTabsUpdate(); if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id)); });
  wc.on('did-stop-loading', () => { tab.loading = false; sendTabsUpdate(); if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id)); });
  wc.on('page-title-updated', (_, title) => {
    tab.title = title || 'Новая вкладка';
    const d = tab.url && tab.url.includes('newtab.html') ? 'Новая вкладка' : (tab.title || 'Без названия');
    if (id === activeTabId) mainWindow.setTitle(`${d} — Integra`);
    sendTabsUpdate();
  });
  wc.on('page-favicon-updated', (_, fav) => { tab.favicon = fav[0] || null; sendTabsUpdate(); });
  wc.on('did-navigate', (_, u) => { tab.url = u; if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id)); sendTabsUpdate(); });
  wc.on('did-navigate-in-page', (_, u) => { tab.url = u; if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id)); sendTabsUpdate(); });
  wc.on('new-window', (e, newUrl) => { e.preventDefault(); createTab(newUrl); });
  wc.setWindowOpenHandler(({ url: u }) => { createTab(u); return { action: 'deny' }; });
  wc.on('context-menu', (_, params) => { mainWindow.webContents.send('context-menu', { x: params.x, y: params.y + getChromeHeight(), params }); });

  // Audio events
  wc.on('audio-state-changed', (_, audible) => {
    tab.audible = audible;
    sendTabsUpdate();
  });

  // Set initial muted state
  wc.setAudioMuted(tab.muted);

  // If pinned, insert at the beginning
  if (tab.pinned) {
    // Move tab to pinned section
    const idx = tabs.findIndex(t => t.id === id);
    if (idx > 0) {
      tabs.splice(idx, 1);
      const pinnedCount = tabs.filter(t => t.pinned).length;
      tabs.splice(pinnedCount, 0, tab);
    }
  }

  setActiveTab(id);
  view.webContents.loadURL(resolveTabUrl(url));
  return id;
}

function setActiveTab(id) {
  activeTabId = id;
  tabs.forEach(t => { mainWindow.removeBrowserView(t.view); });
  tabs.forEach(t => { mainWindow.addBrowserView(t.view); });
  updateViewBounds();
  tabs.forEach(t => { if (t.id !== id) t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); });
  const tab = getTab(id);
  if (tab) { mainWindow.setTitle(`${tab.title} — Integra`); mainWindow.webContents.send('nav-state', getNavState(id)); }
  sendTabsUpdate();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  // Pinned tabs can't be closed individually (but let's allow it)
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  if (tabs.length === 0) { createTab('about:blank'); return; }
  if (activeTabId === id) { setActiveTab(tabs[Math.min(idx, tabs.length - 1)].id); }
  else sendTabsUpdate();
}

function sendTabsUpdate() {
  if (!mainWindow) return;
  mainWindow.webContents.send('tabs-update', {
    tabs: tabs.map(t => ({
      id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading,
      pinned: t.pinned, muted: t.muted, audible: t.audible, group: t.group,
    })),
    activeId: activeTabId,
  });
}

function getNavState(id) {
  const tab = getTab(id); if (!tab) return {};
  const wc = tab.view.webContents;
  return {
    url: tab.url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward(),
    loading: tab.loading, bypassEnabled, bookmarked: isBookmarked(tab.url),
    pinned: tab.pinned, muted: tab.muted, audible: tab.audible, group: tab.group,
  };
}

// ── Tab reorder ──────────────────────────────────────────────
function reorderTab(tabId, newIndex) {
  const old = tabs.findIndex(t => t.id === tabId);
  if (old === -1 || newIndex < 0 || newIndex >= tabs.length || old === newIndex) return;
  const [moved] = tabs.splice(old, 1);
  tabs.splice(newIndex, 0, moved);
  sendTabsUpdate();
}

// ── Tab features: pin, mute, group ──────────────────────────
function pinTab(id) {
  const tab = getTab(id); if (!tab) return;
  tab.pinned = !tab.pinned;
  if (tab.pinned) {
    // Move to pinned section
    const idx = tabs.findIndex(t => t.id === id);
    tabs.splice(idx, 1);
    const pinnedCount = tabs.filter(t => t.pinned).length;
    tabs.splice(tab.pinned ? pinnedCount - 1 : pinnedCount, 0, tab);
  }
  sendTabsUpdate();
  if (activeTabId === id) mainWindow.webContents.send('nav-state', getNavState(id));
}

function muteTab(id) {
  const tab = getTab(id); if (!tab) return;
  tab.muted = !tab.muted;
  tab.view.webContents.setAudioMuted(tab.muted);
  sendTabsUpdate();
  if (activeTabId === id) mainWindow.webContents.send('nav-state', getNavState(id));
}

function setTabGroup(id, group) {
  const tab = getTab(id); if (!tab) return;
  tab.group = group;
  sendTabsUpdate();
  if (activeTabId === id) mainWindow.webContents.send('nav-state', getNavState(id));
}

function closeOtherTabs(id) {
  const toClose = tabs.filter(t => t.id !== id).map(t => t.id);
  toClose.forEach(tid => closeTab(tid));
}

function closeTabsToRight(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const toClose = tabs.slice(idx + 1).map(t => t.id);
  toClose.forEach(tid => closeTab(tid));
}

// ── IPC: Navigation ──────────────────────────────────────────
ipcMain.on('nav-go', (_, { url }) => {
  const tab = getActiveTab(); if (!tab) return;
  let target = url.trim(); if (!target) return;
  const isUrl = /^https?:\/\//i.test(target) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(target) && !target.includes(' ');
  if (!isUrl) target = getSearchUrl(target);
  else if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  tab.url = target; tab.view.webContents.loadURL(target);
});
ipcMain.on('nav-back', () => getActiveTab()?.view.webContents.goBack());
ipcMain.on('nav-forward', () => getActiveTab()?.view.webContents.goForward());
ipcMain.on('nav-reload', () => getActiveTab()?.view.webContents.reload());
ipcMain.on('nav-stop', () => getActiveTab()?.view.webContents.stop());

// ── IPC: Tabs ─────────────────────────────────────────────────
ipcMain.on('tab-new', (_, { url } = {}) => createTab(url));
ipcMain.on('tab-close', (_, { id }) => closeTab(id));
ipcMain.on('tab-activate', (_, { id }) => setActiveTab(id));
ipcMain.on('tab-reorder', (_, { id, newIndex }) => reorderTab(id, newIndex));
ipcMain.on('tab-pin', (_, { id }) => pinTab(id));
ipcMain.on('tab-mute', (_, { id }) => muteTab(id));
ipcMain.on('tab-group', (_, { id, group }) => setTabGroup(id, group));
ipcMain.on('tab-close-others', (_, { id }) => closeOtherTabs(id));
ipcMain.on('tab-close-right', (_, { id }) => closeTabsToRight(id));

// ── IPC: Window ──────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('window-incognito', (_, { url }) => createIncognitoWindow(url));

// ── IPC: Bypass ──────────────────────────────────────────────
ipcMain.on('bypass-toggle', (e) => {
  if (bypassEnabled) stopBypass(); else { if (!startBypass()) e.sender.send('bypass-no-binary'); }
  if (mainWindow) mainWindow.webContents.send('nav-state', getNavState(activeTabId));
});

// ── IPC: Bookmarks ───────────────────────────────────────────
ipcMain.handle('bookmarks-get', () => bookmarks);
ipcMain.handle('bookmark-add', (_, { url, title, favicon }) => { const bm = addBookmark(url, title, favicon); recalcBookmarksBar(); return bm; });
ipcMain.handle('bookmark-remove', (_, { id }) => { const r = removeBookmark(id); recalcBookmarksBar(); return r; });
ipcMain.handle('bookmark-toggle', (_, { url, title, favicon }) => {
  const ex = getBookmarkForUrl(url);
  if (ex) { removeBookmark(ex.id); recalcBookmarksBar(); return { action: 'removed', bookmark: ex }; }
  const bm = addBookmark(url, title, favicon); recalcBookmarksBar(); return { action: 'added', bookmark: bm };
});
ipcMain.handle('bookmark-check', (_, { url }) => isBookmarked(url));
ipcMain.handle('bookmark-update', (_, { id, updates }) => {
  const bm = getBookmarkForUrl(url); if (!bm) return null; // keep as-is
  const found = bookmarks.find(b => b.id === id); if (!found) return null;
  Object.assign(found, updates); saveBookmarks(bookmarks); broadcastBookmarks(); return found;
});

// ── IPC: Settings ────────────────────────────────────────────
ipcMain.handle('settings-get', () => currentSettings);
ipcMain.handle('settings-set', (_, { key, value }) => {
  currentSettings[key] = value; saveSettings(currentSettings);
  if (key === 'theme') nativeTheme.themeSource = value === 'system' ? 'system' : 'dark';
  if (key === 'showBookmarksBar') recalcBookmarksBar();
  mainWindow?.webContents.send('settings-changed', currentSettings);
  return currentSettings;
});
ipcMain.handle('settings-reset', () => {
  currentSettings = { ...DEFAULT_SETTINGS }; saveSettings(currentSettings);
  nativeTheme.themeSource = 'dark'; recalcBookmarksBar();
  mainWindow?.webContents.send('settings-changed', currentSettings);
  return currentSettings;
});
ipcMain.handle('settings-export', () => {
  const r = dialog.showOpenDialogSync(mainWindow, { title: 'Экспорт настроек', defaultPath: 'integra-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openDirectory'] });
  if (!r) return { success: false };
  try { fs.writeFileSync(path.join(r[0], 'integra-settings.json'), JSON.stringify({ settings: currentSettings, bookmarks }, null, 2), 'utf-8'); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('settings-import', () => {
  const r = dialog.showOpenDialogSync(mainWindow, { title: 'Импорт настроек', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (!r) return { success: false };
  try {
    const d = JSON.parse(fs.readFileSync(r[0], 'utf-8'));
    if (d.settings) { currentSettings = { ...DEFAULT_SETTINGS, ...d.settings }; saveSettings(currentSettings); nativeTheme.themeSource = d.settings.theme === 'system' ? 'system' : 'dark'; }
    if (Array.isArray(d.bookmarks)) { bookmarks = d.bookmarks; saveBookmarks(bookmarks); broadcastBookmarks(); }
    recalcBookmarksBar();
    mainWindow?.webContents.send('settings-changed', currentSettings);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ── IPC: State ───────────────────────────────────────────────
ipcMain.handle('get-state', () => ({
  tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading, pinned: t.pinned, muted: t.muted, audible: t.audible, group: t.group })),
  activeId: activeTabId, navState: getNavState(activeTabId), bypassEnabled, bypassAvailable: !!getBypassBinaryPath(),
  bookmarks, settings: currentSettings, bookmarksBarVisible,
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*.google-analytics.com/*', '*://*.doubleclick.net/*', '*://ssl.gstatic.com/safebrowsing/*', '*://*.googleapis.com/safebrowsing/*'] },
    (_, cb) => cb({ cancel: true })
  );
  createWindow();
  recalcBookmarksBar();
  if (currentSettings.bypassOnStart) startBypass();
});

app.on('window-all-closed', () => { stopBypass(); app.quit(); });
app.on('before-quit', () => stopBypass());
