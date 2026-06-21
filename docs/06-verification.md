# 06. Stability Verification — 1000 Sites

1000 representative websites were loaded through the proxy to automatically measure loading, resource
crawling, JS errors, and interactivity. The harness lives in `verify/` (reproducible); result data is
`.gitignore`d.

## 1. Method

- **List**: `verify/sites.txt` — top 1000 of a public top-100000 domain list + popular Korean/hard cases.
- **Harness**: `verify/run.mjs` — Playwright loads each site via `/proxy?url=` (concurrency 8, 28s/site).
  - Measures: final status, total/failed requests (proxied resources), pageerror/console error,
    body length·element count·link/button/input count, framework, React fiber, Next `__next_f` consumption.
- **Resumable**: incremental append to `results.jsonl`, skips already-processed domains.
- **Report**: `verify/report.py` → `summary.json` + `failures.md` (per category + error messages).

## 2. Classification

| Category | Definition |
|---|---|
| `OK` | loaded + interactive elements present |
| `CONN_FAIL` | connection failure (bot-block 403 / 5xx / proxy error / timeout) |
| `HYDRATION_FAIL` | loads but click handlers not attached (Next/SPA DOM hydration failed) |
| `CRAWL_DEGRADED` | many proxied resources fail (>8 & >35%) |
| `BLANK` | almost no body |
| `LIKELY_BROKEN` | little body and zero interactive elements (soft heuristic) |
| `TIMEOUT` | exceeded 28s/site |

## 3. Results (after www fallback)

```
total 1000   OK 638 (63.8%)   failed 362
```

| Category | Count |
|---|---|
| OK | 638 |
| CONN_FAIL | 287 |
| LIKELY_BROKEN | 27 |
| CRAWL_DEGRADED | 21 |
| HYDRATION_FAIL | 16 |
| BLANK | 11 |

### CONN_FAIL (287) attribution
| status | count | attribution |
|---|---|---|
| 403 + (451·429·401…) | ~146 | **site-side** — datacenter IP / bot blocking (unavoidable) |
| 502 | ~67 | dead-apex·TLS·blocking (some recovered by www fallback) |
| 0·522·503 (unreachable/timeout) | ~49 | no response / our IP blocked (unavoidable) |
| 404 | ~23 | no page at the bare apex |

> Of the 362 failures, ~**285 (78%) are site-side blocking/unreachable** — no server proxy from a
> datacenter can break through these. The **extension** bypasses all of them (real tab).

## 4. Real bugs found & fixed during verification

| Found | Fix |
|---|---|
| Apex DNS/cert failures → 502 (livedoor.jp·china.com·suning.com…) | **www fallback** → recovered 26 (61.2% → 63.8%) |
| All non-GET 404 (login/analytics POST) | `app.all` + body forward |
| Login session not retained | Set-Cookie rewrite + manual redirect |
| Audio playback failure | Range header forwarding |
| `text/css` module rejection / `Unexpected token '<'` | Sec-Fetch-Dest-first MIME |
| three.js dying entirely | bare-specifier preservation |
| SW registration error noise | shim SW neutralization |

## 5. HYDRATION_FAIL (16) — Next/SPA dev

mohazi.com, kurly.com, vercel.app, openai.com, msn.com, weather.com, icloud.com, time.com,
wetransfer.com, etc. The proxy loads them but the client hydration never boots.
→ Structural limit, **bypassed via the extension**. mohazi.com/m/studio was collected successfully via
the extension in a live measurement (docs 03·04).

## 6. Limits/caveats

- `LIKELY_BROKEN` (amazon·reddit·nytimes, etc.) is a **soft heuristic** ("little body/few clickables");
  some actually partially work (not fully blocked). Precise judgment needs per-domain re-runs.
- Measured from a datacenter/local IP, so bot-block rates may be higher than for a real user (home IP).
- Reproduce: `cd visualprompt && CONC=8 LIMIT=1000 node verify/run.mjs && python3 verify/report.py`.
