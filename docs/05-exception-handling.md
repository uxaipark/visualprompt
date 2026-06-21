# 05. Exception Handling & Fallback Inventory

The full set of exceptions/fallbacks derived from real-site verification. Distinguishes **what's
handled** from **structural limits (not coverable by fallback)**.

## 1. Proxy — network/transport

| Situation | Handling | Result |
|---|---|---|
| Upstream fetch throws | try/catch | 502 error page (HTML) |
| Upstream hangs forever | `AbortController` 15s (`PROXY_FETCH_TIMEOUT`) | **504** (shows timeout) |
| Unreachable host (refused/EHOSTUNREACH) | undici connect timeout ~10s | 502, fast fail |
| Apex DNS unresolved (ENOTFOUND) | `www.` fallback (2–3 labels) | 200/30x if recovered |
| Cert mismatch (TLS/CERT/ALTNAME) | `www.` → `http://` fallback | works if recovered |
| Timeout (abort) | **give up immediately** (retry pointless) | 504 |
| Non-GET (POST/PUT…) | `app.all` + raw body forward | upstream status preserved (login 401, etc.) |
| 3xx redirect | `redirect:'manual'` + Location rewrite | browser follows (cookies preserved) |

## 2. Proxy — content/MIME

| Situation | Handling |
|---|---|
| JS module with wrong content-type | `Sec-Fetch-Dest:script` → always JS |
| Vite `.css` JS module | dest-first → JS (ignore `.css` extension) |
| script request gets HTML (404/fallback) | don't force JS → pass through (prevents `Unexpected token '<'`) |
| no dest (curl, etc.) | content-type → extension fallback |
| bare specifier (`three`, etc.) | **not rewritten** (preserve import map) |
| dynamic import with variable arg | `__vpImport` runtime bypass |

## 3. Proxy — cookies/session (login)

| Situation | Handling |
|---|---|
| `Set-Cookie` Domain mismatch | strip Domain → default to proxy host |
| `Set-Cookie` Path scope | strip Path → force `Path=/` |
| `Secure` cookie (http localhost) | strip Secure |
| `SameSite=None` (needs Secure) | change to `SameSite=Lax` |
| Set-Cookie lost during redirect | manual redirect preserves each hop |

## 4. Media/resources

| Situation | Handling |
|---|---|
| Audio/video Range (206) | forward `Content-Range`·`Accept-Ranges`, etc. (else playback fails) |
| Cache/download | forward `Cache-Control`·`ETag`·`Last-Modified`·`Content-Disposition` |
| Service worker registration | shim no-ops + unregisters existing |
| favicon 404 noise | inject empty `data:` icon |
| cross-origin pushState SecurityError | absorbed in shim |

## 5. Snapshot / render / session

| Situation | Handling |
|---|---|
| Local snapshot read fails | fall back to live fetch |
| Snapshot fetch hangs | AbortController 20s |
| Snapshot resource download fails/slow | per-item try/catch + 15s timeout (missing allowed) |
| Render networkidle fails | `load` fallback |
| Playwright not installed | `NO_RENDERER` (501) notice |
| Can't open login window (no display) | `NO_DISPLAY` (501) |
| Expired login token | `NO_LOGIN` (410) |

## 6. AI edit (`editSnapshot`) error codes

| code | status | Meaning |
|---|---|---|
| `NO_API_KEY` | 401 | ANTHROPIC_API_KEY missing |
| `NO_SNAPSHOT` | 409 | no local snapshot (save first) |
| `NO_ELEMENT` | 404 | invalid selector / no element |
| `TOO_LARGE` | 413 | target outerHTML too large |
| `EMPTY` | 502 | empty AI response or call failed |

## 7. Client (React)

- Every `fetch` is wrapped in `try/catch` → on failure, shown as a side-panel **banner** (`kind: 'err'`).
- Even if `.json()` throws on a non-JSON response, it's caught and shown as a banner (no hard crash).
- On iframe load failure, the proxy renders a 502 HTML directly in the iframe (user sees the cause).
- Snapshot/session/AI/screenshot/save each show a progress banner (`kind: ''`) → result banner (`ok`/`err`).

## 8. ⚠️ Structural limits (not coverable by fallback)

| Limit | Reason | Alternative |
|---|---|---|
| **Next/Vite dev hydration** | dev bundler assumes its own origin → bootstrap doesn't run under proxy (localhost) | **Extension** (real tab) |
| **Bot block (403) / legal block (451)** | datacenter IP/UA blocking | Extension / render+session |
| **Login wall** | needs session/cookies | 🔐 session + 🎭 render, or extension (logged-in tab) |
| **WebGL single canvas internals** | no per-element DOM | pin only DOM outside the canvas (coordinate-based is future work) |
| **HMR WebSocket** | dev hot-reload can't tunnel through proxy | harmless (app works); prefer single-port production mode |

Evidence → [06-verification.md](./06-verification.md), rationale → [07-limitations-decisions.md](./07-limitations-decisions.md).
