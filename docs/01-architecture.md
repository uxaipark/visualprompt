# 01. Architecture

## 1. Problem statement

When editing a web UI with AI prompts, **describing "which element to fix" in words is hard.**
Keep the page open as-is, point at the element directly with the mouse → write a prompt → collect it
together with DOM locators and source clues, producing a **"modification harness"** that lets an agent
fix exactly the targeted part.

## 2. Why a proxy (the core decision)

Loading an arbitrary URL in a plain iframe fails because:
1. it gets blocked by `X-Frame-Options` / `CSP`, and
2. it is cross-origin, so the parent app cannot access the iframe's DOM.

→ The server **fetches the page → strips blocking headers → rewrites resource URLs → injects the
inspector script → re-serves it from the same origin**. Now the iframe is same-origin with the host
app and can read/manipulate the DOM directly.

To cover the limits of this proxy approach (dev SPAs, bot-blocking, etc.) two more paths were added —
**render (Playwright)** and **browser extension**. → [03-collection-modes.md](./03-collection-modes.md)

## 3. Components

![Architecture](images/architecture.svg)

### Frontend (`client/`)
| File | Role |
|---|---|
| `App.jsx` | Relays `postMessage` between iframe ↔ inspector; global state store (accumulated pins across pages, views, snapshot, session, fixpoints) |
| `Toolbar.jsx` | URL input, UI-prompt toggle, 🎭 render toggle, 🔐 login, 📌 pin show/hide, snapshot, 📸 screenshot |
| `SidePanel.jsx` | Pin list, navigation history, server inbox panel, MD/JSON/all export, AI apply |
| `lib/exporters.js` | Pins → Markdown/JSON harness, screenshot download |

### Backend (`server/`)
| File | Role |
|---|---|
| `index.js` | Express routing (`/proxy`, `/api/*`, `/__vp/*`, `/snap`), script injection, fallback logic |
| `proxy.js` | URL rewriting engine (HTML/CSS/JS) |
| `render.js` | Playwright headless render + screenshot + session injection |
| `session.js` | Headed manual login → save storageState (per origin) |
| `snapshot.js` | Full-resource offline snapshot + AI edit (Claude API) |
| `inbox.js` | Fixpoint save/list/apply/delete + AGENT.md generation |
| `public/shim.js` | Injected first into proxied `<head>` — runtime hooks |
| `public/inspector.js` | Injected at end of proxied `<body>` — pins, locators, clue collection |

### Browser extension (`extension/`, MV3)
| File | Role |
|---|---|
| `content.js` | Injects the inspector into the real tab (FAB, pins, locators, clues) |
| `background.js` | Service worker — POSTs fixpoints to the VP server (cross-origin) |
| `popup.{html,js}` | Server URL config, collect-mode toggle |

## 4. Communication protocol (iframe ↔ host)

Bidirectional `postMessage`, disambiguated by the `source` field:
- host → inspector: `{ source: 'vp-host', type, ... }`
- inspector → host: `{ source: 'vp', type, ... }`

| Direction | type | Meaning |
|---|---|---|
| host→insp | `set-mode` | prompt mode on/off |
| host→insp | `set-pins` | pin visibility on/off (when pins block surroundings) |
| host→insp | `focus`/`edit`/`delete` | pin operations |
| host→insp | `restore` | restore saved pins (by selector/xpath) |
| host→insp | `clear` | remove all pins |
| insp→host | `ready` | inspector booted |
| insp→host | `view-change` | screen (view) transition detected |
| insp→host | `prompt-added`/`-updated`/`-deleted` | pin changes |
| insp→host | `navigate` | link click → host loads the URL |

## 5. Data flow — how one pin is born

![Pin flow](images/pin-flow.svg)

```
1. User toggles UI-prompt mode  → host: post('set-mode',{on:true})
2. Inspector: hover highlight (shows cssPath)
3. User clicks element → Inspector: popover (shows selector/xpath)
4. User writes prompt → Save
5. Inspector: describe(node) + sourceClues(node) → post 'prompt-added'
6. App: append to entries + dropFixpoint() → POST /api/fixpoints
7. Server inbox.js: create fixpoints/pending/fp-NNN.{json,md} + refresh AGENT.md
8. (optional) Agent: read pending, find source by search terms, edit, move to applied/
```

## 6. Run modes

| Mode | Command | Ports |
|---|---|---|
| Development (hot reload) | `npm run dev` | client :5173 + server :3001 |
| Production (single serve) | `npm run preview` | :3001 |
| Install | `bash install.sh` | deps + Chromium + .env |

In dev mode Vite (:5173) proxies `/proxy`·`/__vp`·`/api`·`/snap` to :3001 so the iframe stays
same-origin with the host (`vite.config.js`).
