# navegador-custom

This is a browser project I'm building as a personal case study. It's customized with the things I need and want. I built it to better understand how browsers actually work under the hood, and to end up with a lighter browser shaped around my own taste rather than a general-purpose one.

It's free for anyone to download and adjust to their own liking.

Built with Electron on top of Chromium, with tabs, navigation, and search handled by a UI I wrote myself instead of Chromium's default chrome.

## Current status

The foundation (Milestone 1) is complete, and most of the everyday-usability milestone (Milestone 2) is done too. The project is still in active early development — no packaged releases yet, and several planned features are not implemented.

### Implemented

- Tab management: open, close, switch, always keeps at least one tab open
- Navigation: address bar with URL/search detection, back/forward/reload
- Default search via DuckDuckGo
- Keyboard shortcuts: `Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+L`, `Ctrl+R`/`F5`, `Ctrl+D`, `Ctrl+F`, `Ctrl+S`, `Ctrl+P`, `Ctrl+M`
- In-page find (`Ctrl+F`) with next/previous navigation
- Downloads panel (`Ctrl+D`) tracking in-progress and completed downloads
- Dedicated history tab (`Ctrl+H`) with Today/Yesterday/Last 7 days/Last 30 days/All filters, per-item deletion, and clear-all
- Tab audio mute/unmute with a clickable indicator icon

### Pending

- Tab reordering via drag & drop
- Dedicated new-tab page with quick shortcuts/favorites
- Bookmarks (add/remove, persisted, quick access)
- Performance work: lazy-loading inactive tabs, memory usage monitoring, cleanup on tab close, startup time
- Polish: dark mode/theming, settings panel, friendly error pages (offline, DNS failure)
- Packaging: app icon/branding, Linux build (AppImage/deb)

See `development-plan.md` for the full milestone/issue breakdown.

## Running locally

```sh
bun install
bun run watch
```

`bun run watch` restarts the app automatically on every file change (no true hot-reload — the whole Electron process restarts, so in-memory state like open tabs and history resets each time). Use `bun run start` instead for a single run without auto-restart.

Requires a Linux/macOS/Windows desktop environment (it's an Electron app, not a web app). On Linux without a working Chromium sandbox setup or under Wayland, use `bun run dev` (or `bun run watch`, which already wraps it) — it adds `--no-sandbox --ozone-platform=wayland`.
