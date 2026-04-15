const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('integral', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  newIncognitoWindow: () => ipcRenderer.send('window-incognito'),

  // Bypass
  toggleBypass: () => ipcRenderer.send('bypass-toggle'),

  // Paths & URLs
  getNewTabUrl: () => ipcRenderer.invoke('get-newtab-url'),
  getSettingsUrl: () => ipcRenderer.invoke('get-settings-url'),
  getHistoryUrl: () => ipcRenderer.invoke('get-history-url'),
  getErrorUrl: () => ipcRenderer.invoke('get-error-url'),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks-get'),
  addBookmark: (url, title, favicon) => ipcRenderer.invoke('bookmark-add', { url, title, favicon }),
  removeBookmark: (id) => ipcRenderer.invoke('bookmark-remove', { id }),
  toggleBookmark: (url, title, favicon) => ipcRenderer.invoke('bookmark-toggle', { url, title, favicon }),
  checkBookmark: (url) => ipcRenderer.invoke('bookmark-check', { url }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings-set', { key, value }),
  resetSettings: () => ipcRenderer.invoke('settings-reset'),
  exportSettings: () => ipcRenderer.invoke('settings-export'),
  importSettings: () => ipcRenderer.invoke('settings-import'),

  // Tabs session
  getSavedTabs: () => ipcRenderer.invoke('get-saved-tabs'),
  saveTabsSession: (tabData) => ipcRenderer.send('save-tabs-session', tabData),

  // History
  historyGet: () => ipcRenderer.invoke('history-get'),
  historyAdd: (url, title) => ipcRenderer.send('history-add', { url, title }),
  historyClear: () => ipcRenderer.send('history-clear'),
  historyDelete: (id) => ipcRenderer.send('history-delete', { id }),

  // Cookies
  cookiesGet: () => ipcRenderer.invoke('cookies-get'),
  cookiesClear: () => ipcRenderer.invoke('cookies-clear'),

  // Cache
  cacheGetSize: () => ipcRenderer.invoke('cache-get-size'),
  cacheClear: () => ipcRenderer.invoke('cache-clear'),

  // Native context menus (tab and bookmark only — page context menu handled by BrowserView in main)
  showTabContextMenu: (params) => ipcRenderer.send('show-tab-context-menu', params),
  showBmContextMenu: (params) => ipcRenderer.send('show-bm-context-menu', params),

  // BrowserView Tab Management
  tabCreate: (url, opts) => ipcRenderer.invoke('tab-create', { url, opts }),
  tabClose: (id) => ipcRenderer.send('tab-close', { id }),
  tabSetActive: (id) => ipcRenderer.send('tab-set-active', { id }),
  tabNavigate: (id, url) => ipcRenderer.send('tab-navigate', { id, url }),
  tabGoBack: (id) => ipcRenderer.send('tab-go-back', { id }),
  tabGoForward: (id) => ipcRenderer.send('tab-go-forward', { id }),
  tabReload: (id) => ipcRenderer.send('tab-reload', { id }),
  tabStop: (id) => ipcRenderer.send('tab-stop', { id }),
  tabSetZoom: (id, level) => ipcRenderer.send('tab-set-zoom', { id, level }),
  tabSetMuted: (id, muted) => ipcRenderer.send('tab-set-muted', { id, muted }),
  tabSetPinned: (id, pinned) => ipcRenderer.send('tab-set-pinned', { id, pinned }),
  tabSetGroup: (id, group) => ipcRenderer.send('tab-set-group', { id, group }),
  tabGetAll: () => ipcRenderer.invoke('tab-get-all'),
  tabGetActive: () => ipcRenderer.invoke('tab-get-active'),
  notifyChromeHeight: (height) => ipcRenderer.send('notify-chrome-height', { height }),
  rendererReady: () => ipcRenderer.send('renderer-ready'),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Notification popups
  showNotificationPopup: (data) => ipcRenderer.send('show-notification-popup', data),

  // Zoom (via main process for active tab)
  zoomIn: () => ipcRenderer.send('zoom-in'),
  zoomOut: () => ipcRenderer.send('zoom-out'),
  zoomReset: () => ipcRenderer.send('zoom-reset'),

  // Listeners
  on: (channel, fn) => {
    const allowed = [
      'fullscreen-change', 'bypass-no-binary', 'bookmarks-update',
      'settings-changed', 'incognito-mode',
      'ctx-action', 'tab-cleared-cache',
      // BrowserView tab events
      'tab-created', 'tab-activated', 'tab-closed', 'tab-loading',
      'tab-url-updated', 'tab-title-updated', 'tab-favicon-updated',
      'tab-audio-updated', 'tab-state-updated', 'tab-zoom-updated',
      'tab-crashed',
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
});
