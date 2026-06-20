# 01. 아키텍처

## 1. 문제 정의

AI 프롬프트로 웹 UI 를 고칠 때 **"어떤 element 를 고칠지" 를 말/글로 설명하기 어렵다.**
페이지를 그대로 열어두고 마우스로 직접 element 를 지목 → 프롬프트 작성 → DOM 위치정보·소스 단서와
함께 취합하여, 에이전트가 타깃 부분만 정확히 수정하는 **"수정 하네스(harness)"** 를 추출한다.

## 2. 왜 프록시인가 (핵심 결정)

임의 URL 을 단순 iframe 으로 띄우면:
1. `X-Frame-Options` / `CSP` 로 차단되고,
2. 다른 출처라 부모 앱에서 iframe 의 DOM 에 접근할 수 없다.

→ 서버가 페이지를 **fetch → 차단 헤더 제거 → 리소스 URL 재작성 → 인스펙터 스크립트 주입 →
같은 출처로 재서빙**하면, iframe 이 호스트 앱과 same-origin 이 되어 DOM 을 직접 읽고 조작할 수 있다.

이 프록시 방식의 한계(SPA dev·봇차단 등)를 보완하기 위해 **렌더(Playwright)** 와
**브라우저 확장** 두 경로를 추가했다. → [03-collection-modes.md](./03-collection-modes.md)

## 3. 컴포넌트

### 프론트엔드 (`client/`)
| 파일 | 역할 |
|---|---|
| `App.jsx` | iframe ↔ inspector `postMessage` 중계, 전역 상태 저장소(핀 누적·뷰·스냅샷·세션·fixpoint) |
| `Toolbar.jsx` | URL 입력, UI 프롬프트 토글, 🎭 렌더 토글, 🔐 로그인, 📌 핀 숨김/보임, 스냅샷, 📸 스크린샷 |
| `SidePanel.jsx` | 핀 리스트, 탐색 기록, 서버 inbox 패널, MD/JSON/전체 추출, AI 적용 |
| `lib/exporters.js` | 핀 → Markdown/JSON 하네스 변환, 스크린샷 다운로드 |

### 백엔드 (`server/`)
| 파일 | 역할 |
|---|---|
| `index.js` | Express 라우팅(`/proxy`, `/api/*`, `/__vp/*`, `/snap`), 스크립트 주입, 폴백 로직 |
| `proxy.js` | URL 재작성 엔진 (HTML/CSS/JS) |
| `render.js` | Playwright 헤드리스 렌더 + 스크린샷 + 세션 주입 |
| `session.js` | 헤드드 로그인 → storageState 저장 (origin 별) |
| `snapshot.js` | 전체 자원 오프라인 스냅샷 + AI 편집(Claude API) |
| `inbox.js` | fixpoint 저장/목록/처리/삭제 + AGENT.md 생성 |
| `public/shim.js` | 프록시 페이지 `<head>` 첫 주입 — 런타임 후킹 |
| `public/inspector.js` | 프록시 페이지 `<body>` 끝 주입 — 핀·locator·단서 수집 |

### 브라우저 확장 (`extension/`, MV3)
| 파일 | 역할 |
|---|---|
| `content.js` | 실제 탭에 인스펙터 주입 (FAB·핀·locator·단서) |
| `background.js` | service worker — VP 서버로 fixpoint POST (cross-origin) |
| `popup.{html,js}` | 서버 URL 설정, 수집 모드 토글 |

## 4. 통신 프로토콜 (iframe ↔ 호스트)

`postMessage` 로 양방향. `source` 필드로 구분:
- 호스트 → 인스펙터: `{ source: 'vp-host', type, ... }`
- 인스펙터 → 호스트: `{ source: 'vp', type, ... }`

| 방향 | type | 의미 |
|---|---|---|
| host→insp | `set-mode` | 프롬프트 모드 on/off |
| host→insp | `set-pins` | 핀 표시 on/off (주변부 가릴 때) |
| host→insp | `focus`/`edit`/`delete` | 핀 조작 |
| host→insp | `restore` | 저장된 핀 복원 (selector/xpath 기반) |
| host→insp | `clear` | 전체 핀 제거 |
| insp→host | `ready` | 인스펙터 부팅 완료 |
| insp→host | `view-change` | 화면(뷰) 전환 감지 |
| insp→host | `prompt-added`/`-updated`/`-deleted` | 핀 변경 |
| insp→host | `navigate` | 링크 클릭 → 호스트가 URL 로드 |

## 5. 데이터 흐름 — 핀 하나가 만들어지기까지

```
1. 사용자: UI 프롬프트 토글 ON  → host: post('set-mode',{on:true})
2. 인스펙터: hover 하이라이트(cssPath 표시)
3. 사용자: 요소 클릭 → 인스펙터: 팝오버(selector/xpath 표시)
4. 사용자: 프롬프트 입력 → 저장
5. 인스펙터: describe(node)+sourceClues(node) → post 'prompt-added'
6. App: entries 에 추가 + dropFixpoint() → POST /api/fixpoints
7. 서버 inbox.js: fixpoints/pending/fp-NNN.{json,md} 생성 + AGENT.md 갱신
8. (선택) 에이전트: pending 읽고 검색어로 레포 소스 찾아 수정 → applied 로 이동
```

## 6. 실행 모드

| 모드 | 명령 | 포트 |
|---|---|---|
| 개발(핫리로드) | `npm run dev` | 클라 :5173 + 서버 :3001 |
| 배포(단일 서빙) | `npm run preview` | :3001 |
| 설치 | `bash install.sh` | 의존성 + Chromium + .env |

dev 모드에서 Vite(:5173)가 `/proxy`·`/__vp`·`/api`·`/snap` 을 :3001 로 프록시해
iframe 이 호스트와 same-origin 이 되게 한다(`vite.config.js`).
