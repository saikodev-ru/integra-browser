# Integra Browser — Worklog

---
## Task ID: core-rewrite
**Date:** 2025-01-XX
**Summary:** Complete rewrite of all browser JS/CSS/HTML files with critical fixes and major new features.

### What was done:

#### Critical Fixes:
1. **Webview sizing — Switched to FLEX LAYOUT**
   - `html, body` now use `display: flex; flex-direction: column`
   - `#tabbar`, `#navbar`, `#bookmarks-bar` are `flex-shrink: 0` with fixed heights
   - `#webviews-container` uses `flex: 1; position: relative; overflow: hidden`
   - Removed all `position: fixed` from chrome elements and `calc()` from webview container
   - Webviews use `position: absolute; inset: 0` inside the flex-grown container
   - Removed the `body.show-bookmarks #webviews-container` calc rule — flex handles it automatically

2. **Window dragging — Removed `#drag-region` div, proper CSS fix**
   - Deleted `<div id="drag-region">` from browser.html
   - `#tabbar` gets `-webkit-app-region: drag`
   - `#tabs-list` and all interactive children get `-webkit-app-region: no-drag`
   - `#navbar` gets `-webkit-app-region: drag`
   - `.nav-left`, `.nav-right`, `.nav-bar-wrap`, `#win-controls` get `-webkit-app-region: no-drag`
   - Gaps between buttons in navbar create natural drag zones

3. **Transparency — Added `backgroundMaterial: 'acrylic'`**
   - In main.js `createWindow()`: added `backgroundMaterial: 'acrylic'`, removed `backgroundColor: '#111111'`
   - CSS transparent mode uses `rgba(20, 20, 20, 0.75)` / `rgba(20, 20, 20, 0.70)` backgrounds

4. **Context menu — Kept native Menu.popup() approach**
   - webview-preload.js retains `e.preventDefault()` on contextmenu (prevents Chromium default)
   - Host-side `webview.addEventListener('context-menu', ...)` fires regardless for our native menu

5. **Tab fixed sizes**
   - `.tab` now has `width: 220px; max-width: 220px; min-width: 120px`

#### New Features:
6. **Safari-style URL bar**
   - Added `#urlbar-title` overlay that shows page title when unfocused
   - `.focused` and `.has-value` classes on `#urlbar-wrap` control title visibility
   - Added `#urlbar-zoom` indicator badge for non-default zoom levels
   - URL bar input gets full URL on focus, shows formatted title when blurred

7. **Tab animations**
   - `.tab` has transitions for background, width, opacity, transform
   - `.tab.closing` uses `@keyframes tabClose` animation (250ms)
   - `.tab.drag-over-left::after` and `.tab.drag-over-right::after` use `::after` pseudo-elements for drop indicators

8. **Zoom control**
   - Keyboard shortcuts: `Ctrl+=/+`, `Ctrl+-`, `Ctrl+0`
   - Per-tab zoom tracking: `tab.zoomLevel`
   - Zoom restored on tab switch
   - Visual indicator in URL bar (badge showing percentage)
   - Added zoom items to native context menu

9. **HTTP error pages**
   - `did-fail-load` handler maps error codes to HTTP-like codes
   - Loads `error.html?code=XXX&url=...` for errors like DNS_NOT_FOUND, CONNECTION_REFUSED, etc.
   - Added `get-error-url` IPC handler in main.js and preload.js

10. **Settings as tab page**
    - Settings button opens `settings.html` in a new tab (or activates existing)
    - Falls back to panel overlay if settings URL not available

11. **History tracking**
    - Added `history.json` file in data directory
    - `loadHistory()`, `saveHistory()`, `addHistoryEntry()` functions in main.js
    - IPC handlers: `history-get`, `history-add`, `history-clear`, `history-delete`
    - History recorded on `did-navigate` and `page-title-updated` events
    - History button in navbar (clock icon) opens `history.html` in a tab
    - `Ctrl+H` keyboard shortcut

12. **Smart caching & tracker blocking**
    - Expanded tracker blocking list (Google Analytics, Facebook, Yandex, etc.)
    - Cache management: `cache-get-size` and `cache-clear` IPC handlers
    - Cache size estimation from filesystem

13. **Innovative page loading**
    - `session.defaultSession.preconnect()` for common search engines on startup
    - DNS prefetch for bookmarked sites after 3-second delay

14. **Cookie management**
    - IPC handlers: `cookies-get`, `cookies-clear`

15. **Internal page communication**
    - webview-preload.js exposes `window.chrome.webview.postMessage()` using `ipcRenderer.sendToHost()`
    - Parent renderer listens for `ipc-message` events with channel `internal-msg`
    - Parent can send responses back via `webview.send('internal-response', data)`
    - webview-preload.js dispatches `CustomEvent('integra-response')` for responses
    - Renderer handles various internal message types: navigate, get-settings, set-setting, get-history, etc.

### Key Decisions:
- **Flex over fixed positioning**: Eliminates calc() sizing issues and ensures webview container always fills remaining space
- **App-region drag on tabbar/navbar**: Proper Electron window dragging without the hacky `pointer-events:none` overlay div
- **backgroundMaterial: 'acrylic'**: Native Windows transparency without complex backdrop-filter CSS that doesn't work with webviews
- **Tab close animation**: 250ms CSS animation with `.closing` class, DOM removal deferred via setTimeout
- **History in JSON file**: Simple, fast, no database overhead. Limited to 5000 entries. Deduplicates on insert.
- **IPC bridge for internal pages**: Uses webview's built-in `ipc-message` / `sendToHost` mechanism for reliable parent↔child communication
