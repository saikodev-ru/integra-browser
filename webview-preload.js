/* ── webview-preload.js ── Preload for webview content ── */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a bridge for internal pages (settings, history, error) to communicate
// with the parent renderer via IPC message relay
contextBridge.exposeInMainWorld('chrome', {
  webview: {
    postMessage: (msg) => {
      try { ipcRenderer.sendToHost('internal-msg', msg); } catch {}
    },
  },
});

// Listen for responses sent back from parent renderer to internal pages
ipcRenderer.on('internal-response', (e, data) => {
  try {
    window.dispatchEvent(new CustomEvent('integral-response', { detail: data }));
  } catch {}
});

// ── Context menu: intercept and forward to host via IPC ──
// This is more reliable than the webview's 'context-menu' event
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  try {
    const selection = window.getSelection ? window.getSelection().toString() : '';
    const linkEl = e.target.closest('a[href]');
    const imgEl = e.target.closest('img');
    ipcRenderer.sendToHost('internal-msg', {
      type: 'context-menu',
      x: e.clientX,
      y: e.clientY,
      pageURL: window.location.href,
      linkURL: linkEl ? (linkEl.href || '') : '',
      linkText: linkEl ? (linkEl.textContent || '') : '',
      srcURL: imgEl ? (imgEl.src || '') : '',
      selectionText: selection || '',
      frameUrl: '',
    });
  } catch {}
});
