#!/usr/bin/env python3
# verify/report.py — results.jsonl 을 읽어 summary.json + failures.md 생성.
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
            # 재검증본: TIMEOUT 이 아닌 한 무조건 덮어쓴다(개선 반영)
            if prev is None or prev.get('domain') != d or r.get('category') != 'TIMEOUT' or prev.get('category') == 'TIMEOUT':
                store[d] = r
        elif prev is None or (prev.get('category') == 'TIMEOUT' and r.get('category') != 'TIMEOUT'):
            store[d] = r

by_domain = {}
load('results.jsonl', by_domain)
# www 폴백 적용 후 재검증 결과로 덮어쓰기(개선 반영)
load('results_retry.jsonl', by_domain, override=True)
rows = list(by_domain.values())

total = len(rows)
cats = collections.Counter(r.get('category', '?') for r in rows)
ok = cats.get('OK', 0)

CAT_DESC = {
    'OK': '정상 (로딩 + 인터랙션 요소 존재)',
    'CONN_FAIL': '접속 실패 (봇차단 403 / 5xx / 프록시 에러 / 타임아웃)',
    'HYDRATION_FAIL': 'SPA 하이드레이션 실패 (로딩되나 클릭 핸들러 미부착 — 주로 Next/Vue dev)',
    'CRAWL_DEGRADED': '리소스 크롤 저하 (프록시 경유 리소스 다수 실패)',
    'BLANK': '빈 화면 (본문 거의 없음)',
    'LIKELY_BROKEN': '동작 의심 (본문 적고 인터랙션 요소 0)',
    'TIMEOUT': '사이트 타임아웃 (28s 초과)',
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

# 실패 목록 (OK 제외)
fails = [r for r in rows if not r.get('ok')]
order = ['CONN_FAIL', 'HYDRATION_FAIL', 'CRAWL_DEGRADED', 'BLANK', 'LIKELY_BROKEN', 'TIMEOUT']

L = []
L.append('# VisualPrompt 프록시 안정성 검증 리포트')
L.append('')
L.append(f'- 생성: {summary["generatedAt"]}')
L.append(f'- 검증 사이트: **{total}개**')
L.append(f'- 정상(OK): **{ok}개 ({summary["okRate"]}%)**')
L.append(f'- 실패: **{total - ok}개**')
L.append('')
L.append('## 카테고리 요약')
L.append('')
L.append('| 카테고리 | 개수 | 설명 |')
L.append('|---|---|---|')
for c in ['OK'] + order:
    if c in cats:
        L.append(f'| {c} | {cats[c]} | {CAT_DESC.get(c, "")} |')
L.append('')

for cat in order:
    group = [r for r in fails if r.get('category') == cat]
    if not group:
        continue
    L.append(f'## {cat} ({len(group)}개) — {CAT_DESC.get(cat, "")}')
    L.append('')
    L.append('| # | 도메인 | status | 비고 | 에러 메시지 |')
    L.append('|---|---|---|---|---|')
    for i, r in enumerate(sorted(group, key=lambda x: x['domain']), 1):
        errs = ' / '.join(r.get('errs', []))[:200].replace('|', '\\|').replace('\n', ' ')
        note = str(r.get('note', '')).replace('|', '\\|')[:60]
        L.append(f'| {i} | {r["domain"]} | {r.get("status","")} | {note} | {errs} |')
    L.append('')

with open(os.path.join(HERE, 'failures.md'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(L))

print(f'총 {total}  OK {ok} ({summary["okRate"]}%)  실패 {total-ok}')
print('카테고리:', dict(cats))
print('→ verify/summary.json, verify/failures.md 생성')
