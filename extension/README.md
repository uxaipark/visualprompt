# VisualPrompt Collector (browser extension)

Pin edit prompts onto UI elements **on the real page in the current tab** (no proxy) and
send them straight to the VisualPrompt server inbox (`fixpoints/pending`).
Works on logged-in screens, SPAs, bot-blocked, and Figma sites too (it's just your own browser).

## Install (developer mode / load unpacked)
1. Chrome → `chrome://extensions` → turn on **Developer mode** (top right)
2. **Load unpacked** → select this `extension/` folder
3. Click the extension icon → check the **VP server URL** (default `http://localhost:3001`) → save

## Usage
- Turn collect mode ON with the **📌 FAB** button (bottom right) or the popup's "Enable collect mode"
- Click an element → write a prompt in the bubble → save → a toast shows `✅ Saved: fp-NNN`
- It accumulates as `.json`/`.md` in the server's `fixpoints/pending/`, and the agent processes it per `fixpoints/AGENT.md`

## How it works
- `content.js` injects an inspector (highlight/pin/locator/source clues) into the page
- On save, `background.js` (service worker) POSTs to `${server}/api/fixpoints` (MV3 cross-origin)
- The server's `/api` allows CORS

## Notes
- Can't inject into **internal browser pages** like `chrome://` or the extension store (browser policy)
- If you change the server URL away from localhost, add that origin to `host_permissions` in `manifest.json`
