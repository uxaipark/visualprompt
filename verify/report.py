#!/usr/bin/env python3
# verify/report.py — reads results.jsonl and generates summary.json + failures.md.
import json, os, collections, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
def load(fname, store, override=False):
    p = os.path.join(HERE, fname)
    if not os.path.exists(p):
        return
    for line in open(p, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except:
            continue
        d = r.get('domain')
        prev = store.get(d)
        if override:
            # Re-verification: always overwrite unless TIMEOUT (reflect improvements)
            if prev is None or prev.get('domain') != d or r.get('category') != 'TIMEOUT' or prev.get('category') == 'TIMEOUT':
                store[d] = r
        elif prev is None or (prev.get('category') == 'TIMEOUT' and r.get('category') != 'TIMEOUT'):
            store[d] = r

by_domain = {}
load('results.jsonl', by_domain)
# Overwrite with re-verification results after applying www fallback (reflect improvements)
load('results_retry.jsonl', by_domain, override=True)
rows = list(by_domain.values())

total = len(rows)
cats = collections.Counter(r.get('category', '?') for r in rows)
ok = cats.get('OK', 0)

CAT_DESC = {
    'OK': 'Normal (loaded + interactive elements present)',
    'CONN_FAIL': 'Connection failed (bot-block 403 / 5xx / proxy error / timeout)',
    'HYDRATION_FAIL': 'SPA hydration failed (loads but click handlers not attached — mostly Next/Vue dev)',
    'CRAWL_DEGRADED': 'Resource crawl degraded (many proxied resources failed)',
    'BLANK': 'Blank screen (almost no body content)',
    'LIKELY_BROKEN': 'Likely broken (little body content and 0 interactive elements)',
    'TIMEOUT': 'Site timeout (exceeded 28s)',
}

summary = {
    'generatedAt': datetime.datetime.now().isoformat(timespec='seconds'),
    'total': total,
    'ok': ok,
    'okRate': round(ok / total * 100, 1) if total else 0,
    'categories': dict(cats),
}
with open(os.path.join(HERE, 'summary.json'), 'w', encoding='utf-8') as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

# Failure list (excluding OK)
fails = [r for r in rows if not r.get('ok')]
order = ['CONN_FAIL', 'HYDRATION_FAIL', 'CRAWL_DEGRADED', 'BLANK', 'LIKELY_BROKEN', 'TIMEOUT']

L = []
L.append('# VisualPrompt Proxy Stability Verification Report')
L.append('')
L.append(f'- Generated: {summary["generatedAt"]}')
L.append(f'- Sites verified: **{total}**')
L.append(f'- Normal (OK): **{ok} ({summary["okRate"]}%)**')
L.append(f'- Failed: **{total - ok}**')
L.append('')
L.append('## Category summary')
L.append('')
L.append('| Category | Count | Description |')
L.append('|---|---|---|')
for c in ['OK'] + order:
    if c in cats:
        L.append(f'| {c} | {cats[c]} | {CAT_DESC.get(c, "")} |')
L.append('')

for cat in order:
    group = [r for r in fails if r.get('category') == cat]
    if not group:
        continue
    L.append(f'## {cat} ({len(group)}) — {CAT_DESC.get(cat, "")}')
    L.append('')
    L.append('| # | Domain | status | Note | Error message |')
    L.append('|---|---|---|---|---|')
    for i, r in enumerate(sorted(group, key=lambda x: x['domain']), 1):
        errs = ' / '.join(r.get('errs', []))[:200].replace('|', '\\|').replace('\n', ' ')
        note = str(r.get('note', '')).replace('|', '\\|')[:60]
        L.append(f'| {i} | {r["domain"]} | {r.get("status","")} | {note} | {errs} |')
    L.append('')

with open(os.path.join(HERE, 'failures.md'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(L))

print(f'total {total}  OK {ok} ({summary["okRate"]}%)  failed {total-ok}')
print('categories:', dict(cats))
print('→ generated verify/summary.json, verify/failures.md')
