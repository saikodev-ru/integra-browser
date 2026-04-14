const { app, BrowserWindow, BrowserView, ipcMain, session, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// ── No telemetry ──────────────────────────────────────────────
app.setPath('crashDumps', path.join(app.getPath('temp'), 'integra-noop'));
// Disable Chromium crash reporting
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
// Performance & privacy flags
app.commandLine.appendSwitch('disable-features', 'Reporting,NetworkQualityEstimator,URLLoading,SafeBrowsingEnhancedProtection');
app.commandLine.appendSwitch('no-report-upload');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-background-networking');

nativeTheme.themeSource = 'dark';

// ── State ─────────────────────────────────────────────────────
let mainWindow = null;
let bypassProcess = null;
let bypassEnabled = false;

const CHROME_HEIGHT = 92; // tabbar(40) + navbar(52)
const SIDEBAR_W = 0;

// tabs: [{ id, view, url, title, favicon, loading }]
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
    // zapret winws preset for RF ТСПУ
    args = [
      '--wf-tcp=80,443', '--wf-udp=443,50000-65535',
      '--strategy', 'disorder_autottl;fake;syndata;udplen;disorder',
      '--dpi-desync=split2', '--dpi-desync-ttl=5',
      '--dpi-desync-fake-tls=0x00000000',
      '--new', '--dpi-desync=fake,split2',
      '--dpi-desync-repeats=11'
    ];
  } else {
    // GoodbyeDPI preset for Russia
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
    // Open first tab
    createTab(); // opens newtab
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

  // Remove default menu
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

  // Wire up events
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

  // Context menu passthrough
  wc.on('context-menu', (_, params) => {
    mainWindow.webContents.send('context-menu', { x: params.x, y: params.y + CHROME_HEIGHT, params });
  });

  setActiveTab(id);
  view.webContents.loadURL(resolveTabUrl(url));

  return id;
}

function setActiveTab(id) {
  activeTabId = id;

  // Re-order views: show active on top
  tabs.forEach(t => {
    mainWindow.removeBrowserView(t.view);
  });
  tabs.forEach(t => {
    mainWindow.addBrowserView(t.view);
    // Only the active view is visible (set bounds)
  });

  updateViewBounds();

  // Hide all non-active views by setting zero-size bounds
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
    // Open a blank tab so we never have 0 tabs
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
  };
}

// ── IPC ───────────────────────────────────────────────────────
ipcMain.on('nav-go', (_, { url }) => {
  const tab = getActiveTab();
  if (!tab) return;
  let target = url.trim();
  if (!target) return;
  // Determine if it's a URL or search query
  const isUrl = /^https?:\/\//i.test(target) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(target) && !target.includes(' ');
  if (!isUrl) {
    target = `https://yandex.ru/search/?text=${encodeURIComponent(target)}`;
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

ipcMain.on('tab-new', (_, { url } = {}) => createTab(url));
ipcMain.on('tab-close', (_, { id }) => closeTab(id));
ipcMain.on('tab-activate', (_, { id }) => setActiveTab(id));

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.on('bypass-toggle', (e) => {
  if (bypassEnabled) {
    stopBypass();
  } else {
    const ok = startBypass();
    if (!ok) {
      e.sender.send('bypass-no-binary');
    }
  }
  // Broadcast updated state to all
  tabs.forEach(t => {
    if (t.id === activeTabId) {
      mainWindow.webContents.send('nav-state', getNavState(activeTabId));
    }
  });
});

ipcMain.handle('get-state', () => ({
  tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, favicon: t.favicon, loading: t.loading })),
  activeId: activeTabId,
  navState: getNavState(activeTabId),
  bypassEnabled,
  bypassAvailable: !!getBypassBinaryPath(),
}));

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  // Block telemetry domains at network level
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
});

app.on('window-all-closed', () => {
  stopBypass();
  app.quit();
});

app.on('before-quit', () => stopBypass());
