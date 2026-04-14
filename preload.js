const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('integra', {
  // Navigation
  go: (url) => ipcRenderer.send('nav-go', { url }),
  back: () => ipcRenderer.send('nav-back'),
  forward: () => ipcRenderer.send('nav-forward'),
  reload: () => ipcRenderer.send('nav-reload'),
  stop: () => ipcRenderer.send('nav-stop'),

  // Tabs
  newTab: (url) => ipcRenderer.send('tab-new', { url }),
  closeTab: (id) => ipcRenderer.send('tab-close', { id }),
  activateTab: (id) => ipcRenderer.send('tab-activate', { id }),
  reorderTab: (id, newIndex) => ipcRenderer.send('tab-reorder', { id, newIndex }),
  pinTab: (id) => ipcRenderer.send('tab-pin', { id }),
  muteTab: (id) => ipcRenderer.send('tab-mute', { id }),
  setTabGroup: (id, group) => ipcRenderer.send('tab-group', { id, group }),
  closeOtherTabs: (id) => ipcRenderer.send('tab-close-others', { id }),
  closeTabsToRight: (id) => ipcRenderer.send('tab-close-right', { id }),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  newIncognitoWindow: (url) => ipcRenderer.send('window-incognito', { url }),

  // Bypass
  toggleBypass: () => ipcRenderer.send('bypass-toggle'),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('bookmarks-get'),
  addBookmark: (url, title, favicon) => ipcRenderer.invoke('bookmark-add', { url, title, favicon }),
  removeBookmark: (id) => ipcRenderer.invoke('bookmark-remove', { id }),
  toggleBookmark: (url, title, favicon) => ipcRenderer.invoke('bookmark-toggle', { url, title, favicon }),
  checkBookmark: (url) => ipcRenderer.invoke('bookmark-check', { url }),
  updateBookmark: (id, updates) => ipcRenderer.invoke('bookmark-update', { id, updates }),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings-set', { key, value }),
  resetSettings: () => ipcRenderer.invoke('settings-reset'),
  exportSettings: () => ipcRenderer.invoke('settings-export'),
  importSettings: () => ipcRenderer.invoke('settings-import'),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Listeners
  on: (channel, fn) => {
    const allowed = ['tabs-update', 'nav-state', 'fullscreen-change', 'context-menu', 'bypass-no-binary', 'bookmarks-update', 'settings-changed', 'bookmarks-bar-visibility'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
