/* ── webview-preload.js ── Preload for BrowserView content ── */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a bridge for internal pages (settings, history, error) to communicate
// with the main process via IPC (instead of sendToHost which was for webview tags)
contextBridge.exposeInMainWorld('chrome', {
  webview: {
    postMessage: (msg) => {
      try { ipcRenderer.send('bv-internal-msg', msg); } catch {}
    },
  },
});

// Listen for responses sent back from main process to internal pages
ipcRenderer.on('internal-response', (e, data) => {
  try {
    window.dispatchEvent(new CustomEvent('integral-response', { detail: data }));
  } catch {}
});

// ── Notification forwarding ──
if (window.Notification) {
  const OrigNotification = window.Notification;
  window.Notification = function(title, options) {
    const notif = new OrigNotification(title, options);
    try {
      ipcRenderer.send('bv-internal-msg', {
        type: 'notification-event',
        title: title,
        body: options ? options.body || '' : '',
        icon: options ? options.icon || '' : '',
        url: options && options.data && options.data.url ? options.data.url : '',
      });
    } catch {}
    return notif;
  };
  window.Notification.prototype = OrigNotification.prototype;
  window.Notification.permission = OrigNotification.permission;
  window.Notification.requestPermission = OrigNotification.requestPermission;
}
