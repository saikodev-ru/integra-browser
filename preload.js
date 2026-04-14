const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('integra', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  newIncognitoWindow: () => ipcRenderer.send('window-incognito'),

  // Bypass
  toggleBypass: () => ipcRenderer.send('bypass-toggle'),

  // Paths & URLs
  getWebViewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),
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

  // Native context menus
  showContextMenu: (params) => ipcRenderer.send('show-page-context-menu', params),
  showTabContextMenu: (params) => ipcRenderer.send('show-tab-context-menu', params),
  showBmContextMenu: (params) => ipcRenderer.send('show-bm-context-menu', params),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Listeners
  on: (channel, fn) => {
    const allowed = [
      'fullscreen-change', 'bypass-no-binary', 'bookmarks-update',
      'settings-changed', 'incognito-mode', 'save-tabs',
      'ctx-action', 'do-zoom',
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
});
