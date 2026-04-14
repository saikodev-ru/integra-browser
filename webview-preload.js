/* ── webview-preload.js ── Minimal preload for webview content ── */
'use strict';

// Prevent the native Chromium context menu so our custom one can show
document.addEventListener('contextmenu', (e) => e.preventDefault());
