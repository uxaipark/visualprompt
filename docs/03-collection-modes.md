# 03. 수집 경로 3종 + 로그인 세션

하나의 인스펙터 로직, 여러 "올라타는 방법". 수집된 fixpoint 는 모두 같은 서버 `/api/fixpoints` 로 모인다.

## 1. 프록시 모드 (기본)

서버가 fetch → 재작성 → 인스펙터 주입 → same-origin 재서빙. → [02-proxy-engine.md](./02-proxy-engine.md)

- **장점**: 빠름, 인터랙션 유지(앱이 실제로 실행됨), 로컬 개발서버에 즉시.
- **적합**: 빌드된 사이트, SSR/정적, 로컬 개발 프론트엔드.
- **부적합**: Next/Vite **dev 모드**(하이드레이션 안 됨), 봇차단(403), 로그인 필요.

`?render=1` 으로 렌더 모드, `?fresh=1` 로 스냅샷 무시 실시간.

## 2. 렌더 모드 (Playwright) — `render.js`

헤드리스 Chromium 으로 페이지를 **실제 렌더**한 뒤 완성 DOM 을 떠 와 재작성/서빙.

- 공유 브라우저 1개 + 요청마다 새 컨텍스트(쿠키 격리, 세션 주입 가능).
- `renderHtml(url)`: `networkidle` 우선 → 실패 시 `load` 폴백 → 600ms 하이드레이션 여유 → `page.content()`.
- `screenshot(url, {fullPage})`: 풀페이지 PNG.
- `withSession(url)`: 해당 origin 의 저장된 로그인 세션을 자동 주입.
- Playwright 미설치 시 `renderAvailable()=false`, 호출 시 `NO_RENDERER`(501).

**적합**: naver(봇차단)·SPA·Figma·로그인 후 화면을 *서버측에서* 렌더해 스냅샷/스크린샷.
**주의**: 렌더 결과는 "완성된 DOM 스냅샷"이라 SPA 를 다시 띄우면 재마운트로 **인터랙션이 깨질 수 있다**.
즉 "보고 핀 꽂기"엔 좋지만 "클릭하며 탐색"엔 프록시(일반)나 확장이 낫다.

실측: naver.com·mohazi.com/login·at-rpm.cloud 모두 렌더 성공(스크린샷/DOM 정상).

## 3. 브라우저 확장 (MV3) — `extension/` ★하드 사이트 정답

프록시 없이 **사용자의 실제 탭**에 content script 로 인스펙터 주입. 앱이 네이티브로 하이드레이션되므로
**프록시가 못 뚫는 모든 것**(Next dev·로그인된 화면·봇차단·CSP·Figma)을 그대로 수집.

```
content.js (탭) → chrome.runtime.sendMessage → background.js (SW)
              → fetch(`${server}/api/fixpoints`) → 서버 inbox
```

- `manifest.json`: `content_scripts` `<all_urls>`, `host_permissions` localhost/127.0.0.1,
  background service worker, popup.
- `content.js`: 우하단 📌 FAB 토글, hover 하이라이트, 클릭 팝오버, 핀, `cssPath`/`xPath`/`describe`,
  `sourceClues`(단서). API 단서는 shim 없이 `PerformanceObserver('resource')` 로 수집.
- `background.js`: MV3 에서 cross-origin fetch 를 담당(host_permissions). 서버로 POST.
- `popup`: 서버 URL 설정(`chrome.storage`), 현재 탭 수집 모드 토글.

**설치**: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 로드" → `extension/` 선택 → 서버 URL 확인.

**실측 (mohazi.com/m/studio, Next dev)**: content script 주입 ✅ / 네이티브 입장(하이드레이션) ✅ /
수집모드·팝오버 ✅ / 서버 inbox 적재 ✅ (`fp-001.json`+`.md`, clues 에 `hero-cta`·`elis-studio-root`
같은 실제 컴포넌트 클래스 캡처). 프록시가 못 하던 것을 확장이 100% 처리함을 확인.

## 4. 로그인 세션 수집 — `session.js`

봇차단·로그인 사이트의 **로그인 후 화면**을 렌더로 수집하기 위한 세션 캡처.

```
🔐 로그인 클릭 → 서버가 헤드드(보이는) Chromium 창 띄움
            → 사용자가 직접 로그인(캡차·2FA·소셜 전부 사람이 처리)
            → ✅ 세션 저장 클릭 → storageState 를 sessions/<host>.json 에 저장
            → 이후 🎭 렌더로 그 사이트 = 로그인된 화면 렌더
```

- 2단계 토큰 방식: `startLogin(url)` → 창 띄우고 token 반환 / `saveLogin(token)` → storageState 저장·창 닫음.
- `storageStateFor(url)` 로 render.js 가 해당 origin 렌더 시 자동 주입.
- `sessionStatus`/`clearSession`. 디스플레이 없는 서버에선 `NO_DISPLAY`(501) 안내.
- ⚠️ **세션 파일은 인증정보** → `sessions/` 는 `.gitignore`.

## 5. 경로 선택 요약

| 상황 | 경로 |
|---|---|
| 일반/빌드 사이트, 로컬 개발서버 | 프록시 |
| 봇차단·로그인·SPA 를 서버측 스냅샷/스크린샷 | 렌더 + 🔐 세션 |
| Next/Vite dev, 하이드레이션 하드, 로그인된 탭 | **확장** |
| 빠른 미리보기 캐싱 + AI 편집 | 스냅샷 + AI 적용 |
