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

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Bypass
  toggleBypass: () => ipcRenderer.send('bypass-toggle'),

  // State
  getState: () => ipcRenderer.invoke('get-state'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Listeners
  on: (channel, fn) => {
    const allowed = ['tabs-update', 'nav-state', 'fullscreen-change', 'context-menu', 'bypass-no-binary'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, ...args) => fn(...args));
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
