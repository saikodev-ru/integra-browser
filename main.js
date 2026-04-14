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
  languages: [
    { name: 'Яндекс', value: 'yandex', url: 'https://yandex.ru/search/?text=' },
    { name: 'Google',  value: 'google',  url: 'https://www.google.com/search?q=' },
    { name: 'DuckDuckGo', value: 'duckduckgo', url: 'https://duckduckgo.com/?q=' },
  ],
};

// ── Settings CRUD ────────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) };
    }
  } catch (e) { console.error('[settings] load error:', e); }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) { console.error('[settings] save error:', e); }
}

let currentSettings = loadSettings();

// ── Bookmarks CRUD ───────────────────────────────────────────
function loadBookmarks() {
  try {
    if (fs.existsSync(bookmarksFile)) {
      return JSON.parse(fs.readFileSync(bookmarksFile, 'utf-8'));
    }
  } catch (e) { console.error('[bookmarks] load error:', e); }
  return [];
}

function saveBookmarks(bookmarks) {
  try {
    fs.writeFileSync(bookmarksFile, JSON.stringify(bookmarks, null, 2), 'utf-8');
  } catch (e) { console.error('[bookmarks] save error:', e); }
}

let bookmarks = loadBookmarks();

function generateBookmarkId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function findBookmark(id) {
  return bookmarks.find(b => b.id === id);
}

function addBookmark(url, title, favicon) {
  // Check if already bookmarked
  const existing = bookmarks.find(b => b.url === url);
  if (existing) return existing;
  const bm = { id: generateBookmarkId(), url, title: title || url, favicon: favicon || null, createdAt: Date.now() };
  bookmarks.push(bm);
  saveBookmarks(bookmarks);
  broadcastBookmarks();
  return bm;
}

function removeBookmark(id) {
  const idx = bookmarks.findIndex(b => b.id === id);
  if (idx === -1) return false;
  bookmarks.splice(idx, 1);
  saveBookmarks(bookmarks);
  broadcastBookmarks();
  return true;
}

function isBookmarked(url) {
  return bookmarks.some(b => b.url === url);
}

function getBookmarkForUrl(url) {
  return bookmarks.find(b => b.url === url) || null;
}

function broadcastBookmarks() {
  if (!mainWindow) return;
  mainWindow.webContents.send('bookmarks-update', bookmarks);
}

// ── Theme ────────────────────────────────────────────────────
nativeTheme.themeSource = currentSettings.theme === 'system' ? 'system' : 'dark';

// ── State ─────────────────────────────────────────────────────
let mainWindow = null;
let bypassProcess = null;
let bypassEnabled = false;

const CHROME_HEIGHT = 92;
const SIDEBAR_W = 0;

let tabs = [];
let activeTabId = null;
let nextTabId = 1;

// ── DPI Bypass ────────────────────────────────────────────────
function getBypassBinaryPath() {
  const candidates = [
    path.join(process.resourcesPath, 'bypass', 'winws.exe'),
    path.join(process.resourcesPath, 'bypass', 'goodbyedpi.exe'),
    path.join(__dirname, 'bypass', 'winws.exe'),
    path.join(__dirname, 'bypass', 'goodbyedpi.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { path: p, type: p.includes('winws') ? 'winws' : 'goodbyedpi' };
  }
  return null;
}

function startBypass() {
  if (bypassProcess) return;
  const bin = getBypassBinaryPath();
  if (!bin) {
    console.log('[bypass] No binary found in bypass/ dir');
    return false;
  }

  let args = [];
  if (bin.type === 'winws') {
    args = [
      '--wf-tcp=80,443', '--wf-udp=443,50000-65535',
      '--strategy', 'disorder_autottl;fake;syndata;udplen;disorder',
      '--dpi-desync=split2', '--dpi-desync-ttl=5',
      '--dpi-desync-fake-tls=0x00000000',
      '--new', '--dpi-desync=fake,split2',
      '--dpi-desync-repeats=11'
    ];
  } else {
    args = [
      '-p', '-r', '-s', '-n', '-e', '40',
      '--dns-addr', '77.88.8.8',
      '--dns-port', '53',
    ];
  }

  try {
    bypassProcess = spawn(bin.path, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    bypassProcess.on('exit', () => { bypassProcess = null; });
    bypassEnabled = true;
    console.log(`[bypass] Started ${bin.type}`);
    return true;
  } catch (e) {
    console.error('[bypass] Failed to start:', e.message);
    return false;
  }
}

function stopBypass() {
  if (bypassProcess) {
    bypassProcess.kill();
    bypassProcess = null;
  }
  bypassEnabled = false;
}

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'browser.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    createTab();
  });

  mainWindow.on('resize', () => updateViewBounds());
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-change', true);
    updateViewBounds();
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-change', false);
    updateViewBounds();
  });

  mainWindow.on('closed', () => {
    stopBypass();
    mainWindow = null;
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
  const chromeH = isFullscreen ? 0 : CHROME_HEIGHT;

  tabs.forEach(tab => {
    tab.view.setBounds({ x: 0, y: chromeH, width: w, height: h - chromeH });
  });
}

const NEWTAB_URL = `file://${path.join(__dirname, 'src', 'newtab.html')}`;

function resolveTabUrl(url) {
  if (!url || url === 'about:blank' || url === 'newtab') return NEWTAB_URL;
  return url;
}

function getSearchUrl(query) {
  const engine = currentSettings.languages.find(e => e.value === currentSettings.searchEngine);
  const searchUrl = engine ? engine.url : 'https://yandex.ru/search/?text=';
  return searchUrl + encodeURIComponent(query);
}

function createTab(url = NEWTAB_URL) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:main',
    },
  });

  mainWindow.addBrowserView(view);
  view.setAutoResize({ width: true, height: true });

  const tab = { id, view, url: url, title: 'Новая вкладка', favicon: null, loading: false };
  tabs.push(tab);

  const wc = view.webContents;

  wc.on('did-start-loading', () => {
    tab.loading = true;
    sendTabsUpdate();
    if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id));
  });

  wc.on('did-stop-loading', () => {
    tab.loading = false;
    sendTabsUpdate();
    if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id));
  });

  wc.on('page-title-updated', (_, title) => {
    tab.title = title || 'Новая вкладка';
    const displayTitle = tab.url && tab.url.includes('newtab.html') ? 'Новая вкладка' : (tab.title || 'Без названия');
    if (id === activeTabId) mainWindow.setTitle(`${displayTitle} — Integra`);
    sendTabsUpdate();
  });

  wc.on('page-favicon-updated', (_, favicons) => {
    tab.favicon = favicons[0] || null;
    sendTabsUpdate();
  });

  wc.on('did-navigate', (_, url) => {
    tab.url = url;
    if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id));
    sendTabsUpdate();
  });

  wc.on('did-navigate-in-page', (_, url) => {
    tab.url = url;
    if (id === activeTabId) mainWindow.webContents.send('nav-state', getNavState(id));
    sendTabsUpdate();
  });

  wc.on('new-window', (e, newUrl) => {
    e.preventDefault();
    createTab(newUrl);
  });

  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });

  wc.on('context-menu', (_, params) => {
    mainWindow.webContents.send('context-menu', { x: params.x, y: params.y + CHROME_HEIGHT, params });
  });

  setActiveTab(id);
  view.webContents.loadURL(resolveTabUrl(url));

  return id;
}

function setActiveTab(id) {
  activeTabId = id;

  tabs.forEach(t => {
    mainWindow.removeBrowserView(t.view);
  });
  tabs.forEach(t => {
    mainWindow.addBrowserView(t.view);
  });

  updateViewBounds();

  tabs.forEach(t => {
    if (t.id !== id) {
      t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  });

  const tab = getTab(id);
  if (tab) {
    mainWindow.setTitle(`${tab.title} — Integra`);
    mainWindow.webContents.send('nav-state', getNavState(id));
  }
  sendTabsUpdate();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    createTab('about:blank');
    return;
  }

  if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    setActiveTab(tabs[newIdx].id);
  } else {
    sendTabsUpdate();
  }
}

function sendTabsUpdate() {
  if (!mainWindow) return;
  mainWindow.webContents.send('tabs-update', {
    tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading })),
    activeId: activeTabId,
  });
}

function getNavState(id) {
  const tab = getTab(id);
  if (!tab) return {};
  const wc = tab.view.webContents;
  return {
    url: tab.url,
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    loading: tab.loading,
    bypassEnabled,
    bookmarked: isBookmarked(tab.url),
  };
}

// ── Tab reorder (drag-n-drop) ────────────────────────────────
function reorderTab(tabId, newIndex) {
  const oldIndex = tabs.findIndex(t => t.id === tabId);
  if (oldIndex === -1 || newIndex < 0 || newIndex >= tabs.length) return;
  if (oldIndex === newIndex) return;

  const [moved] = tabs.splice(oldIndex, 1);
  tabs.splice(newIndex, 0, moved);
  sendTabsUpdate();
}

// ── IPC: Navigation ──────────────────────────────────────────
ipcMain.on('nav-go', (_, { url }) => {
  const tab = getActiveTab();
  if (!tab) return;
  let target = url.trim();
  if (!target) return;
  const isUrl = /^https?:\/\//i.test(target) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(target) && !target.includes(' ');
  if (!isUrl) {
    target = getSearchUrl(target);
  } else if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }
  tab.url = target;
  tab.view.webContents.loadURL(target);
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

// ── IPC: Window ──────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── IPC: Bypass ──────────────────────────────────────────────
ipcMain.on('bypass-toggle', (e) => {
  if (bypassEnabled) {
    stopBypass();
  } else {
    const ok = startBypass();
    if (!ok) {
      e.sender.send('bypass-no-binary');
    }
  }
  tabs.forEach(t => {
    if (t.id === activeTabId) {
      mainWindow.webContents.send('nav-state', getNavState(activeTabId));
    }
  });
});

// ── IPC: Bookmarks ───────────────────────────────────────────
ipcMain.handle('bookmarks-get', () => bookmarks);

ipcMain.handle('bookmark-add', (_, { url, title, favicon }) => {
  return addBookmark(url, title, favicon);
});

ipcMain.handle('bookmark-remove', (_, { id }) => {
  return removeBookmark(id);
});

ipcMain.handle('bookmark-toggle', (_, { url, title, favicon }) => {
  const existing = getBookmarkForUrl(url);
  if (existing) {
    removeBookmark(existing.id);
    return { action: 'removed', bookmark: existing };
  } else {
    const bm = addBookmark(url, title, favicon);
    return { action: 'added', bookmark: bm };
  }
});

ipcMain.handle('bookmark-check', (_, { url }) => {
  return isBookmarked(url);
});

ipcMain.handle('bookmark-update', (_, { id, updates }) => {
  const bm = findBookmark(id);
  if (!bm) return null;
  Object.assign(bm, updates);
  saveBookmarks(bookmarks);
  broadcastBookmarks();
  return bm;
});

// ── IPC: Settings ────────────────────────────────────────────
ipcMain.handle('settings-get', () => currentSettings);

ipcMain.handle('settings-set', (_, { key, value }) => {
  currentSettings[key] = value;
  saveSettings(currentSettings);

  // Theme
  if (key === 'theme') {
    nativeTheme.themeSource = value === 'system' ? 'system' : 'dark';
  }

  mainWindow?.webContents.send('settings-changed', currentSettings);
  return currentSettings;
});

ipcMain.handle('settings-reset', () => {
  currentSettings = { ...DEFAULT_SETTINGS };
  saveSettings(currentSettings);
  nativeTheme.themeSource = 'dark';
  mainWindow?.webContents.send('settings-changed', currentSettings);
  return currentSettings;
});

ipcMain.handle('settings-export', () => {
  const result = dialog.showOpenDialogSync(mainWindow, {
    title: 'Экспорт настроек',
    defaultPath: 'integra-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openDirectory'],
  });
  if (!result) return { success: false };

  const exportPath = path.join(result[0], 'integra-settings.json');
  try {
    const data = { settings: currentSettings, bookmarks };
    fs.writeFileSync(exportPath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, path: exportPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('settings-import', () => {
  const result = dialog.showOpenDialogSync(mainWindow, {
    title: 'Импорт настроек',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!result) return { success: false };

  try {
    const data = JSON.parse(fs.readFileSync(result[0], 'utf-8'));
    if (data.settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      saveSettings(currentSettings);
      if (data.settings.theme) {
        nativeTheme.themeSource = data.settings.theme === 'system' ? 'system' : 'dark';
      }
    }
    if (Array.isArray(data.bookmarks)) {
      bookmarks = data.bookmarks;
      saveBookmarks(bookmarks);
      broadcastBookmarks();
    }
    mainWindow?.webContents.send('settings-changed', currentSettings);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── IPC: State ───────────────────────────────────────────────
ipcMain.handle('get-state', () => ({
  tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading })),
  activeId: activeTabId,
  navState: getNavState(activeTabId),
  bypassEnabled,
  bypassAvailable: !!getBypassBinaryPath(),
  bookmarks,
  settings: currentSettings,
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [
      '*://*.google-analytics.com/*',
      '*://*.doubleclick.net/*',
      '*://ssl.gstatic.com/safebrowsing/*',
      '*://*.googleapis.com/safebrowsing/*',
    ]},
    (_, callback) => callback({ cancel: true })
  );

  createWindow();

  // Auto-start bypass if setting enabled
  if (currentSettings.bypassOnStart) {
    startBypass();
  }
});

app.on('window-all-closed', () => {
  stopBypass();
  app.quit();
});

app.on('before-quit', () => stopBypass());
