# 02. Proxy Engine

`server/proxy.js` (rewriting) + `server/index.js` (routing/transport/fallback) +
`server/public/shim.js` (runtime hooks). The core logic, hardened against real-world sites.
Each item: **why it's needed** and **how it works**.

![Proxy request handling](images/proxy-flow.svg)

## 1. URL rewriting — static (proxy.js)

Every resource URL is rewritten to `/proxy?url=<encoded>`. `rwAbs(u, baseUrl)`:
- Special schemes (`data:`/`blob:`/`javascript:`/`mailto:`/`#`) pass through.
- Already `/proxy?url=` → left as-is (no double wrapping).
- Absolutized via `new URL(u, baseUrl)`; only http/https go through the proxy.

| Target | Handling |
|---|---|
| HTML | cheerio rewrites `script[src]`, `img[src/srcset]`, `link[href]`, `source`, `video`, `audio`, `iframe`, `track`, `embed`, `input[src]` |
| HTML inline | `[style]` attrs, `<style>` blocks (`rewriteCss`), inline `<script type="module">` (specifiers only) |
| CSS | `url(...)`, `@import` (`rewriteCss`) |
| JS module | specifier rewrite + dynamic-import bypass + prelude (`rewriteJsModule`) |

Also: **strip CSP `<meta>`**, **strip `integrity`** (so rewritten resources aren't blocked by SRI).

## 2. ES module rewriting and bare-specifier preservation ⚠️

`rewriteModuleSpecifiers` rewrites the **path** in `import/export ... from '...'`, side-effect
`import '...'`, and dynamic `import('...')`. But:

> **Never rewrite bare specifiers** (`three`, `react`, `@scope/pkg`, `three/addons/...`).
> These must be resolved by an **import map** or the loader (`isResolvableSpecifier`: only rewrite
> specifiers starting with `/`, `./`, `../`, or `http(s)://`).

Violating this turns `import * as THREE from 'three'` into `/proxy?url=.../three` (404) and **kills the
entire three.js app** (observed & fixed). The runtime prelude `R()` has the same guard.

### Dynamic import bypass
`import(` → `__vpImport(`, and a once-guarded prelude is prepended to each JS module.
`__vpImport(u)` does `import(R(u))`, routing the URL through the proxy at runtime (handles variable args).

## 3. Runtime hooks (shim.js)

Hooks **URLs generated at runtime** that static rewriting can't catch. Injected first in `<head>`.

| Hook | Reason |
|---|---|
| `fetch` / `XMLHttpRequest.open` / `navigator.sendBeacon` | Route API/dynamic requests through proxy + network log (`__VP_NET__`, for backend clues) |
| element `src`/`href` props (script/img/link/iframe/media/source) | setter→rw, getter→unrw (consistent even when code reads the URL back) |
| `Element.setAttribute` | rewrite `src`/`srcset`/(non-anchor)`href` |
| `history.pushState`/`replaceState` | absorb cross-origin `SecurityError` + initial path spoof (prevents SPA-router 404 flash) |
| **Service Worker neutralization** | SW scope/origin breaks under proxy and is unnecessary. `register` no-op + unregister existing (prevents a broken SW from caching-blocking the page) |

## 4. All HTTP methods + body forwarding

`app.all('/proxy')`. Originally only GET was handled, so **all login POSTs and analytics beacons 404'd** —
fixed.
- `express.json()` **skips** `/proxy` (preserve raw body). Non-GET bodies are collected as a raw Buffer
  via `readRawBody(req)` and forwarded upstream.
- Request headers are forwarded except `host`·`connection`·`content-length`·`accept-encoding`·`sec-fetch-*`
  (content-type·authorization·cookie·accept preserved → login/API works).
- Upstream **status code is preserved** (login failure 401, beacons 204, etc.).

## 5. Redirects + cookies (login core)

- `redirect: 'manual'` — handle 3xx directly. Rewrite `Location` to `/proxy?url=...` so the **browser
  follows it**. fetch's `redirect:'follow'` loses intermediate `Set-Cookie`, breaking login.
- **`Set-Cookie` rewriting** (`rewriteSetCookie`) so session cookies persist/transmit even on the proxy
  (localhost):
  - strip `Domain=` → defaults to proxy host
  - strip `Path=`, then force `Path=/` → sent on every `/proxy` request (avoids path-scope breakage)
  - strip `Secure` (storable over http localhost)
  - `SameSite=None` → `Lax` (works without Secure)
- Stored cookies are then auto-attached to subsequent request headers and forwarded upstream.

## 6. Content-type detection (MIME)

Servers often send the wrong content-type, so the browser's **`Sec-Fetch-Dest` is the primary signal**.

| dest | Handling |
|---|---|
| `script`/`worker`/`serviceworker` | **JS** (unless the response is `text/html` — see below) |
| `style` | **CSS** (not forced if response is html) |
| `document`/`iframe`/`frame` | **HTML** (rewrite + inject) |
| none (curl, etc.) | content-type → extension fallback |

Avoids two traps:
1. **`text/css` MIME rejection**: Vite serves `.css` as a JS module. Deciding by extension would emit a
   JS module as `text/css` and the browser rejects it → if `dest=script`, always JS.
2. **`Unexpected token '<'`**: when a script request gets HTML (404/SPA fallback), executing it as JS
   breaks on `<` → if the response is HTML, don't force JS/CSS; pass through and fail honestly.

## 7. Media streaming (Range)

`<audio>`/`<video>` use **Range requests (partial content, 206)**. On buffer passthrough, forward these
upstream headers: `Content-Range`, `Accept-Ranges`, `Content-Disposition`, `Cache-Control`, `ETag`,
`Last-Modified`, `Expires`, `Vary`, `Content-Language`.

> A 206 without `Content-Range` is treated as invalid by the browser → **audio/video playback fails**
> (observed & fixed). Playback, seeking, and downloads now work.

## 8. Timeout + fallback chain

- **Timeout**: upstream fetch wrapped in `AbortController` (default 15s, `PROXY_FETCH_TIMEOUT`).
  Exceeded → **504**. Prevents infinite hangs. (Unreachable hosts fail faster via undici's ~10s connect timeout.)
- **Fallback chain** (GET documents only, by error type):
  - `ENOTFOUND`/`EAI_AGAIN`/cert error + apex (2–3 labels) → **retry `www.`** (rescues unresolved apex / cert mismatch)
  - cert/TLS error + https → **retry `http://`**
  - **on timeout (abort): give up immediately** → no wasted retries, 504
- In the 1000-site verification, the `www.` fallback recovered 26 sites (china.com, suning.com, japanpost.jp, …).

## 9. Snapshot serving priority

For `/proxy` (GET document):
1. not `?fresh=1` and a local snapshot exists → serve snapshot (`x-vp-source: local`)
2. `?render=1` → Playwright render (`x-vp-source: render`)
3. otherwise → live fetch (`x-vp-source: live`)

API calls (POST etc.) skip snapshot/render and always go live.

## 10. Response header hygiene

- `access-control-allow-origin: *` (allow extension/cross-origin)
- inject `<meta name="referrer" content="no-referrer">`
- if the page has no icon link, inject an empty `data:` icon (suppress default `/favicon.ico` 404 noise)
