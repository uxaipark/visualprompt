# 06. 안정성 검증 — 1000개 사이트

대표 웹사이트 1000개를 프록시로 접속해 로딩·리소스 크롤·JS 에러·인터랙션을 자동 측정.
하니스는 `verify/` 에 있고(재현 가능), 결과 데이터는 `.gitignore`.

## 1. 방법

- **목록**: `verify/sites.txt` — 공개 top-100000 도메인의 상위 1000 + 한국 인기/하드케이스.
- **하니스**: `verify/run.mjs` — Playwright 로 각 사이트를 `/proxy?url=` 로드(동시성 8, 사이트당 28s).
  - 측정: 최종 status, 요청 총수/실패수(프록시 경유 리소스), pageerror/console error,
    본문 길이·요소 수·링크/버튼/입력 수, framework, React fiber, Next `__next_f` 소비 여부.
- **재개**: `results.jsonl` 에 증분 저장, 이미 처리한 도메인 스킵.
- **리포트**: `verify/report.py` → `summary.json` + `failures.md`(카테고리별 + 에러 메시지).

## 2. 분류 기준

| 카테고리 | 정의 |
|---|---|
| `OK` | 로딩 + 인터랙션 요소 존재 |
| `CONN_FAIL` | 접속 실패(봇차단 403 / 5xx / 프록시 에러 / 타임아웃) |
| `HYDRATION_FAIL` | 로딩되나 클릭 핸들러 미부착(Next/SPA dom hydration 실패) |
| `CRAWL_DEGRADED` | 프록시 경유 리소스 다수 실패(>8 & >35%) |
| `BLANK` | 본문 거의 없음 |
| `LIKELY_BROKEN` | 본문 적고 인터랙션 요소 0 (소프트 휴리스틱) |
| `TIMEOUT` | 사이트당 28s 초과 |

## 3. 결과 (www 폴백 적용 후)

```
총 1000  OK 638 (63.8%)  실패 362
```

| 카테고리 | 개수 |
|---|---|
| OK | 638 |
| CONN_FAIL | 287 |
| LIKELY_BROKEN | 27 |
| CRAWL_DEGRADED | 21 |
| HYDRATION_FAIL | 16 |
| BLANK | 11 |

### CONN_FAIL(287) 귀속 분석
| status | 개수 | 귀속 |
|---|---|---|
| 403 외(451·429·401…) | 약 146 | **사이트 측** — 데이터센터 IP/봇 차단(불가피) |
| 502 | 약 67 | dead-apex·TLS·차단(일부 www 폴백 구제) |
| 0·522·503(불통/타임아웃) | 약 49 | 미응답·우리 IP 차단(불가피) |
| 404 | 약 23 | bare apex 에 페이지 없음 |

> 실패 362 중 약 **285개(78%)가 사이트 측 차단/불통** — 데이터센터에서 도는 *어떤* 서버 프록시도
> 못 뚫는다. 이건 **확장**이 전부 우회한다(실제 탭).

## 4. 검증으로 발견·수정한 실제 버그

| 발견 | 수정 |
|---|---|
| apex DNS/cert 실패 502 (livedoor.jp·china.com·suning.com…) | **www 폴백** → 26개 복구(61.2% → 63.8%) |
| 모든 비-GET 404(로그인/분석 POST) | `app.all` + 바디 전달 |
| 로그인 세션 미유지 | Set-Cookie 재작성 + manual redirect |
| 오디오 재생 실패 | Range 헤더 전달 |
| `text/css` 모듈 거부 / `Unexpected token '<'` | Sec-Fetch-Dest 우선 MIME |
| three.js 통째 사망 | bare specifier 보존 |
| SW 등록 실패 노이즈 | shim SW 무력화 |

## 5. HYDRATION_FAIL(16) — Next/SPA dev

mohazi.com, kurly.com, vercel.app, openai.com, msn.com, weather.com, icloud.com, time.com,
wetransfer.com 등. 프록시가 로드는 하지만 클라이언트 하이드레이션이 부팅 안 됨.
→ 구조적 한계, **확장으로 우회**. mohazi.com/m/studio 는 확장 수집 실측 성공(04·03 문서).

## 6. 한계/주의

- `LIKELY_BROKEN`(amazon·reddit·nytimes 등)은 "본문/클릭요소가 적다"는 **소프트 휴리스틱**이라
  일부는 실제 부분 동작(완전 차단 아님). 정밀 판정하려면 개별 재현 필요.
- 측정은 데이터센터/로컬 IP 기준이라 봇차단 비율이 실제 사용자(가정 IP)보다 높게 잡힐 수 있다.
- 재현: `cd visualprompt && CONC=8 LIMIT=1000 node verify/run.mjs && python3 verify/report.py`.
