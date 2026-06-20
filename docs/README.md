# VisualPrompt 설계 문서

웹 UI 위에 수정 프롬프트를 핀으로 꽂아 **수정 포인트(fixpoint)** 를 수집하고,
서버 inbox 에 구조화 문서로 적재해 **에이전트가 실제 소스를 고치게** 하는 도구의 설계 문서.

## 목차

| 문서 | 내용 |
|---|---|
| [01-architecture.md](./01-architecture.md) | 전체 아키텍처, 컴포넌트, 데이터 흐름 |
| [02-proxy-engine.md](./02-proxy-engine.md) | 프록시 엔진 — URL 재작성, MIME, 메서드/쿠키/Range, 폴백 |
| [03-collection-modes.md](./03-collection-modes.md) | 수집 경로 3종(프록시·렌더·확장) + 로그인 세션 |
| [04-fixpoints-inbox.md](./04-fixpoints-inbox.md) | fixpoint 스키마, 에이전트 핸드오프 |
| [05-exception-handling.md](./05-exception-handling.md) | 예외처리·폴백 전체 인벤토리 |
| [06-verification.md](./06-verification.md) | 1000개 사이트 안정성 검증 방법·결과 |
| [07-limitations-decisions.md](./07-limitations-decisions.md) | 구조적 한계, 설계 결정 로그 |

## 한 장 요약

```
┌─ React 앱 (호스트, :5173 dev / dist prod) ──────────────────────┐
│  Toolbar(URL·모드·스냅샷·세션·핀토글) · App(중계) · SidePanel    │
│        │ postMessage(source: 'vp-host' ↔ 'vp')                   │
│  ┌─────▼ <iframe class="page-frame" src="/proxy?url=...">─────┐  │
│  │  프록시된 외부 페이지 (same-origin 재서빙)                   │  │
│  │   + shim.js (head: 런타임 후킹)                             │  │
│  │   + inspector.js (body: 핀·locator·단서 수집)              │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────│───────────────────────────────────────┘
              ┌────────────▼ Express :3001 ──────────────┐
              │ /proxy   모든메서드 fetch→재작성→주입→서빙  │
              │ /api/*   config·snapshot·screenshot·       │
              │          fixpoints·session·edit            │
              │ /__vp/*  shim.js · inspector.js            │
              │ /snap    스냅샷 정적 서빙                   │
              └───────────────────────────────────────────┘
                  │ render.js(Playwright)  session.js
                  │ snapshot.js  inbox.js
                  ▼
            fixpoints/pending/fp-NNN.{json,md}  ← 에이전트 inbox

별도 경로: 브라우저 확장(MV3) — 실제 탭에서 직접 수집 → /api/fixpoints
```

## 수집 경로 선택 가이드

| 대상 | 권장 경로 |
|---|---|
| 빌드된/일반 사이트, 로컬 개발서버 | **프록시** (즉시, 인터랙션 유지) |
| SPA·봇차단·로그인 필요 (서버측 처리) | **렌더(Playwright)** + 🔐 세션 |
| Next/Vite dev, 하이드레이션 하드 사이트, 로그인된 화면 | **브라우저 확장** (실제 탭) |

자세한 기준은 [07-limitations-decisions.md](./07-limitations-decisions.md) 참고.
