# 03. Three Collection Paths + Login Session

One inspector logic, multiple ways to "get on the page". All collected fixpoints land at the same
server endpoint `/api/fixpoints`.

![Collection modes](images/collection-modes.svg)

## 1. Proxy mode (default)

Server fetches → rewrites → injects inspector → re-serves same-origin.
→ [02-proxy-engine.md](./02-proxy-engine.md)

- **Pros**: fast, interaction preserved (the app actually runs), instant for local dev servers.
- **Good for**: built sites, SSR/static, local dev frontends.
- **Bad for**: Next/Vite **dev mode** (no hydration), bot-blocking (403), login required.

`?render=1` for render mode, `?fresh=1` to bypass the snapshot and go live.

## 2. Render mode (Playwright) — `render.js`

Headless Chromium **actually renders** the page, then the finished DOM is captured, rewritten, and served.

- One shared browser + a fresh context per request (cookie isolation, session injectable).
- `renderHtml(url)`: `networkidle` first → fall back to `load` → 600ms hydration settle → `page.content()`.
- `screenshot(url, {fullPage})`: full-page PNG.
- `withSession(url)`: auto-injects the saved login session for that origin.
- If Playwright isn't installed, `renderAvailable()=false`; calling it returns `NO_RENDERER` (501).

**Good for**: rendering naver (bot-blocked) / SPA / Figma / post-login screens *server-side* for snapshot/screenshot.
**Caveat**: a render result is a "finished DOM snapshot", so re-launching a SPA on top can **break
interactivity** (re-mount). Great for "view & pin", but proxy (normal) or the extension is better for
"click & explore".

Measured: naver.com · mohazi.com/login · at-rpm.cloud all render successfully (screenshot/DOM OK).

## 3. Browser extension (MV3) — `extension/`  ★ the answer for hard sites

No proxy — injects the inspector via a content script into **the user's real tab**. The app hydrates
natively, so it collects **everything the proxy can't** (Next dev, logged-in screens, bot-blocking, CSP, Figma).

```
content.js (tab) → chrome.runtime.sendMessage → background.js (SW)
              → fetch(`${server}/api/fixpoints`) → server inbox
```

- `manifest.json`: `content_scripts` `<all_urls>`, `host_permissions` localhost/127.0.0.1,
  background service worker, popup.
- `content.js`: bottom-right 📌 FAB toggle, hover highlight, click popover, pins, `cssPath`/`xPath`/`describe`,
  `sourceClues`. API clues are gathered without the shim via `PerformanceObserver('resource')`.
- `background.js`: handles cross-origin fetch in MV3 (host_permissions). POSTs to the server.
- `popup`: server URL config (`chrome.storage`), toggle collect mode for the current tab.

**Install**: `chrome://extensions` → Developer mode → "Load unpacked" → select `extension/` → confirm server URL.

**Measured (mohazi.com/m/studio, Next dev)**: content script injected ✅ / native enter (hydration) ✅ /
collect mode + popover ✅ / server inbox write ✅ (`fp-001.json`+`.md`, clues captured real component
classes like `hero-cta`·`elis-studio-root`). Confirmed the extension handles 100% of what the proxy couldn't.

## 4. Login session capture — `session.js`

Captures a session to render **post-login screens** of bot-blocked/login sites.

```
Click 🔐 Login → server opens a headed (visible) Chromium window
            → user logs in manually (captcha/2FA/social all handled by the human)
            → Click ✅ Save session → storageState saved to sessions/<host>.json
            → afterwards 🎭 Render that site = renders the logged-in screen
```

- Two-step token flow: `startLogin(url)` → opens window, returns token / `saveLogin(token)` → save storageState, close window.
- `storageStateFor(url)` lets render.js auto-inject when rendering that origin.
- `sessionStatus`/`clearSession`. On a display-less server, returns `NO_DISPLAY` (501).
- ⚠️ **Session files contain credentials** → `sessions/` is `.gitignore`d.

## 5. Path selection summary

| Situation | Path |
|---|---|
| General/built site, local dev server | Proxy |
| Bot-blocked·login·SPA, server-side snapshot/screenshot | Render + 🔐 session |
| Next/Vite dev, hydration-hard, logged-in tab | **Extension** |
| Fast preview caching + AI edit | Snapshot + AI apply |
