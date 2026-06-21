# 07. Structural Limits · Design Decision Log

## A. Structural limits (not coverable by fallback)

### A1. Next.js / Vite **dev mode** hydration
- **Symptom**: loads/renders through the proxy, but click handlers don't attach (React fiber 0, Next
  `__next_f` not consumed).
- **Cause**: the dev bundler's (Turbopack/Vite dev) client bootstrap assumes **"the app runs on its own
  real origin"**. The proxy serves from `localhost:5173`, so that bootstrap doesn't execute.
- **Evidence**: reproduces even with shim and JS rewriting disabled; chunks are byte-identical and
  syntactically valid; zero network failures → not our bug (verified).
- **Alternative**: **browser extension** (real tab, native hydration). Verified live on mohazi.com/m/studio.
- **Note**: a **built/deployed** version of the same app (`next build && next start`) is likely to proxy fine.

### A2. Bot block / legal block / unreachable
- 403 (Cloudflare/Akamai challenge), 451 (legal), 522/503/timeout. Datacenter IP/UA blocking.
- **Alternative**: extension (home IP / real browser), or render+session.

### A3. WebGL single-canvas internals
- Unity/Flutter CanvasKit/three.js draw the screen into **one `<canvas>`** → inner UI has no DOM →
  not addressable by selector (Chrome DevTools can't either).
- **Now**: normal DOM elements outside the canvas pin fine.
- **Future**: coordinate-based fixpoints over the canvas (x,y + region + screenshot crop), reusing the render screenshot.

### A4. HMR WebSocket
- A dev server's hot-reload (ws) can't tunnel through the proxy → console error. **Harmless** (app works).
- If the target is also on :5173, it collides with VP's Vite (:5173) and gets noisier → prefer the
  single-port production mode (`npm run preview`).

## B. Design decision log

| # | Decision | Reason / alternative |
|---|---|---|
| D1 | iframe + **server proxy** | plain iframe blocked by X-Frame-Options/CSP/cross-origin. Proxy makes it same-origin. |
| D2 | full URL rewriting + shim runtime hooks | `<base>` alone breaks SPA dynamic fetch/import. |
| D3 | `Sec-Fetch-Dest`-first MIME | many servers send wrong content-type (Vite `.css` module, etc.). Most reliable signal. |
| D4 | **never** touch bare specifiers | rewriting import-map targets kills three.js et al. |
| D5 | `redirect:'manual'` + Set-Cookie rewrite | fixes login 302 cookie loss / domain mismatch. |
| D6 | **three separate** collection paths | proxy limits covered by render·extension. No single path does it all. |
| D7 | render engine = **Playwright (Chromium)** | render naver/login/SPA with a real browser. ~150MB install trade-off accepted. |
| D8 | login = **headed manual login** → storageState | captcha/2FA/social can't be automated → human logs in once, session reused. |
| D9 | fixpoint = **file drop (inbox) + built-in AI edit** | files for the server agent to pick up; AI edit for instant preview. |
| D10 | fixpoint markdown includes **search terms / candidate files** | agent finds source by code search instead of selector. |
| D11 | extension **background does the POST** | MV3 content-script cross-origin limits → the host-permissioned SW handles it. |
| D12 | upstream **timeout + error-typed fallback** | prevent infinite hangs and wasted retries (no fallback on timeout). |

## C. Known non-goals (intentionally not built)

- **Bot-block evasion** (captcha solving, IP rotation, etc.): not done. Legitimately bypass via extension/session.
- **Full dev-bundler proxying**: low ROI → prefer the extension.
- **Full cookie domain isolation**: a single localhost session is enough at the dev-tool level.

## D. Future candidates

1. WebGL/canvas **coordinate-based fixpoints** + screenshot annotation.
2. Extension **pin-list panel / session integration / fixpoint preview**.
3. A script that **watches the inbox and auto-edits code** end-to-end.
4. Additional fallbacks beyond `http://` (retry backoff); precise re-verification of `LIKELY_BROKEN` false negatives.
5. **CI** for the verification harness (periodic regression detection).
