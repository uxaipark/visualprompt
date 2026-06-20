# 05. 예외처리 · 폴백 전체 인벤토리

실제 사이트 검증으로 도출한 예외/폴백 전부. **있는 것**과 **구조적 한계(폴백으로 못 메움)** 를 구분.

## 1. 프록시 — 네트워크/전송

| 상황 | 처리 | 결과 |
|---|---|---|
| 업스트림 fetch throw | try/catch | 502 에러 페이지(HTML) |
| 업스트림 무한 대기 | `AbortController` 15s(`PROXY_FETCH_TIMEOUT`) | **504** (시간 초과 표시) |
| 불통 호스트(연결거부/EHOSTUNREACH) | undici 연결 타임아웃 ~10s | 502, 빠른 실패 |
| apex DNS 미해석(ENOTFOUND) | `www.` 폴백(2~3 라벨) | 복구 시 200/30x |
| 인증서 불일치(TLS/CERT/ALTNAME) | `www.` → `http://` 폴백 | 복구 시 정상 |
| 타임아웃(abort) | **즉시 포기**(재시도 무의미) | 504 |
| 비-GET(POST/PUT…) | `app.all` + raw 바디 전달 | 업스트림 상태 보존(로그인 401 등) |
| 3xx 리다이렉트 | `redirect:'manual'` + Location 재작성 | 브라우저가 따라감(쿠키 보존) |

## 2. 프록시 — 콘텐츠/MIME

| 상황 | 처리 |
|---|---|
| content-type 틀린 JS 모듈 | `Sec-Fetch-Dest:script` 면 무조건 JS |
| Vite `.css` JS 모듈 | dest 우선 → JS(확장자 `.css` 무시) |
| script 요청에 HTML(404/폴백) 응답 | JS 강제 안 함 → 원본 통과(`Unexpected token '<'` 방지) |
| dest 없음(curl 등) | content-type → 확장자 폴백 |
| bare specifier(`three` 등) | **재작성 안 함**(import map 보존) |
| 동적 import 변수 인자 | `__vpImport` 런타임 우회 |

## 3. 프록시 — 쿠키/세션 (로그인)

| 상황 | 처리 |
|---|---|
| `Set-Cookie` Domain 불일치 | Domain 제거 → 프록시 호스트 기본화 |
| `Set-Cookie` Path 스코프 | Path 제거 → `Path=/` 강제 |
| `Secure` 쿠키(http localhost) | Secure 제거 |
| `SameSite=None`(Secure 필요) | `SameSite=Lax` 로 변경 |
| 리다이렉트 중 Set-Cookie 유실 | manual redirect 로 각 홉 보존 |

## 4. 미디어/리소스

| 상황 | 처리 |
|---|---|
| 오디오/비디오 Range(206) | `Content-Range`·`Accept-Ranges` 등 전달(없으면 재생 실패) |
| 캐시/다운로드 | `Cache-Control`·`ETag`·`Last-Modified`·`Content-Disposition` 전달 |
| 서비스워커 등록 | shim 에서 no-op + 기존 등록 해제 |
| favicon 404 노이즈 | 빈 `data:` 아이콘 주입 |
| 교차출처 pushState SecurityError | shim 에서 흡수 |

## 5. 스냅샷 / 렌더 / 세션

| 상황 | 처리 |
|---|---|
| 로컬 스냅샷 읽기 실패 | 실시간 fetch 폴백 |
| 스냅샷 fetch 무한 대기 | AbortController 20s |
| 스냅샷 리소스 다운로드 실패/지연 | 개별 try/catch + 15s 타임아웃(누락 허용) |
| 렌더 networkidle 실패 | `load` 폴백 |
| Playwright 미설치 | `NO_RENDERER`(501) 안내 |
| 로그인 창 못 띄움(디스플레이 없음) | `NO_DISPLAY`(501) |
| 만료된 로그인 토큰 | `NO_LOGIN`(410) |

## 6. AI 편집 (`editSnapshot`) 에러 코드

| code | status | 의미 |
|---|---|---|
| `NO_API_KEY` | 401 | ANTHROPIC_API_KEY 없음 |
| `NO_SNAPSHOT` | 409 | 로컬 스냅샷 없음(먼저 저장) |
| `NO_ELEMENT` | 404 | selector 무효/요소 없음 |
| `TOO_LARGE` | 413 | 대상 outerHTML 과대 |
| `EMPTY` | 502 | AI 응답 비었거나 호출 실패 |

## 7. 클라이언트 (React)

- 모든 `fetch` 가 `try/catch` 로 감싸짐 → 실패 시 사이드패널 **배너**(`kind: 'err'`)로 표시.
- 비-JSON 응답으로 `.json()` 이 throw 해도 catch 되어 배너 처리(하드 크래시 없음).
- iframe 로드 실패 시 프록시가 502 HTML 을 iframe 에 직접 표시(사용자가 원인 확인 가능).
- 스냅샷/세션/AI/스크린샷/저장 각각 진행 배너(`kind: ''`) → 결과 배너(`ok`/`err`).

## 8. ⚠️ 폴백으로 못 메우는 구조적 한계

| 한계 | 이유 | 대안 |
|---|---|---|
| **Next/Vite dev 하이드레이션** | dev 번들러가 자기 오리진 가정 → 프록시(localhost) 에서 부트스트랩 안 됨 | **확장**(실제 탭) |
| **봇차단(403)·법적차단(451)** | 데이터센터 IP/UA 차단 | 확장 / 렌더+세션 |
| **로그인 벽** | 세션/쿠키 필요 | 🔐 세션 + 🎭 렌더, 또는 확장(로그인된 탭) |
| **WebGL 단일 캔버스 내부** | 개별 DOM 없음 | 캔버스 밖 요소만 핀(좌표 기반은 향후) |
| **HMR WebSocket** | dev 핫리로드는 프록시 터널 불가 | 무해(앱 동작), 배포모드 단일포트 권장 |

검증·근거 → [06-verification.md](./06-verification.md), 결정 배경 → [07-limitations-decisions.md](./07-limitations-decisions.md).
