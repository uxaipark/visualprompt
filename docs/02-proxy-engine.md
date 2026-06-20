# 02. 프록시 엔진

`server/proxy.js`(재작성) + `server/index.js`(라우팅/전송/폴백) + `server/public/shim.js`(런타임 후킹).
실제 사이트들로 단련하며 만든 핵심 로직 모음. 각 항목은 **왜 필요한지**와 **어떻게 동작하는지**.

## 1. URL 재작성 — 정적 (proxy.js)

모든 리소스 URL 을 `/proxy?url=<encoded>` 로 바꾼다. `rwAbs(u, baseUrl)`:
- `data:`/`blob:`/`javascript:`/`mailto:`/`#` 등 특수 스킴은 그대로.
- 이미 `/proxy?url=` 면 그대로(이중 래핑 방지).
- `new URL(u, baseUrl)` 로 절대화 후 http/https 만 프록시 경유.

| 대상 | 처리 |
|---|---|
| HTML | cheerio 로 `script[src]`, `img[src/srcset]`, `link[href]`, `source`, `video`, `audio`, `iframe`, `track`, `embed`, `input[src]` 재작성 |
| HTML 인라인 | `[style]` 속성, `<style>` 블록(`rewriteCss`), 인라인 `<script type="module">`(specifier만) |
| CSS | `url(...)`, `@import` (`rewriteCss`) |
| JS 모듈 | specifier 재작성 + 동적 import 우회 + 프렐류드 (`rewriteJsModule`) |

추가로 **CSP `<meta>` 제거**, **`integrity` 속성 제거**(재작성된 리소스가 SRI 로 차단되지 않도록).

## 2. ES 모듈 재작성과 bare specifier 보존 ⚠️

`rewriteModuleSpecifiers` 는 `import/export ... from '...'`, side-effect `import '...'`,
동적 `import('...')` 의 **경로**를 재작성한다. 단:

> **bare specifier(`three`, `react`, `@scope/pkg`, `three/addons/...`)는 절대 재작성하지 않는다.**
> 이들은 **import map** 또는 로더가 해석해야 하므로(`isResolvableSpecifier`: `/`·`./`·`../`·`http(s)://` 로 시작하는 것만 재작성).

이걸 안 지키면 `import * as THREE from 'three'` 가 `/proxy?url=.../three`(404)로 바뀌어
**three.js 앱이 통째로 죽는다**(실제 발생·수정). 런타임 프렐류드 `R()` 에도 같은 가드가 있다.

### 동적 import 우회
`import(` → `__vpImport(` 로 치환하고, 각 JS 모듈 앞에 1회-가드 프렐류드를 prepend.
`__vpImport(u)` 는 `import(R(u))` 로 런타임에 URL 을 프록시 경유시킨다(변수 인자 대응).

## 3. 런타임 후킹 (shim.js)

정적 재작성으로 못 잡는 **런타임 생성 URL** 을 후킹. `<head>` 최상단에 주입.

| 후킹 | 이유 |
|---|---|
| `fetch` / `XMLHttpRequest.open` / `navigator.sendBeacon` | API·동적 요청을 프록시 경유 + 네트워크 로그(`__VP_NET__`, 백엔드 단서용) |
| element `src`/`href` 프로퍼티 (script/img/link/iframe/media/source) | setter→rw, getter→unrw (코드가 원본 URL 을 되읽어도 일관) |
| `Element.setAttribute` | `src`/`srcset`/(앵커 아닌)`href` 재작성 |
| `history.pushState`/`replaceState` | 교차 출처 `SecurityError` 흡수 + 초기 경로 스푸핑(SPA 라우터 404 플래시 방지) |
| **Service Worker 무력화** | 프록시에선 SW 스코프/오리진이 깨지고 불필요. `register` no-op + 기존 등록 해제 (깨진 SW 가 캐싱으로 페이지 방해 방지) |

## 4. 모든 HTTP 메서드 + 바디 전달

`app.all('/proxy')`. 초기엔 GET 만 처리해 **로그인 POST·분석 비콘이 전부 404** 였던 버그를 수정.
- `express.json()` 은 `/proxy` 를 **건너뛴다**(원본 바디 보존). 비-GET 은 `readRawBody(req)` 로 raw Buffer 수집해 업스트림에 전달.
- 요청 헤더는 `host`·`connection`·`content-length`·`accept-encoding`·`sec-fetch-*` 만 제외하고 전달
  (content-type·authorization·cookie·accept 보존 → 로그인/API 동작).
- 업스트림 **상태코드 보존**(로그인 실패 401, 비콘 204 등).

## 5. 리다이렉트 + 쿠키 (로그인 핵심)

- `redirect: 'manual'` — 3xx 를 직접 처리. `Location` 을 `/proxy?url=...` 로 재작성해 **브라우저가
  따라가게** 한다. fetch 의 `redirect:'follow'` 는 중간 홉의 `Set-Cookie` 를 유실하므로 로그인이 깨진다.
- **`Set-Cookie` 재작성**(`rewriteSetCookie`): 프록시(localhost)에서도 세션 쿠키가 저장·전송되도록
  - `Domain=` 제거 → 프록시 호스트로 기본화
  - `Path=` 제거 후 `Path=/` 강제 → 모든 `/proxy` 요청에 전송(경로 스코프 깨짐 방지)
  - `Secure` 제거(http localhost 에서 저장 가능)
  - `SameSite=None` → `Lax`(Secure 없이 동작)
- 저장된 쿠키는 이후 요청 헤더로 자동 첨부되어 업스트림에 전달된다.

## 6. 콘텐츠 타입 판별 (MIME)

서버가 content-type 을 틀리게 주는 경우가 많아 **브라우저의 `Sec-Fetch-Dest` 를 최우선**으로 쓴다.

| dest | 처리 |
|---|---|
| `script`/`worker`/`serviceworker` | **JS** (단, 응답이 `text/html` 이면 강제 안 함 — 아래) |
| `style` | **CSS** (응답이 html 이면 강제 안 함) |
| `document`/`iframe`/`frame` | **HTML**(재작성+주입) |
| 없음(curl 등) | content-type → 확장자 순 폴백 |

두 가지 함정을 피한다:
1. **`text/css` MIME 거부**: Vite 는 `.css` 를 JS 모듈로 서빙한다. 확장자로 판별하면 JS 모듈을
   `text/css` 로 내보내 거부된다 → `dest=script` 면 무조건 JS.
2. **`Unexpected token '<'`**: script 요청에 HTML(404/SPA 폴백)이 오면, JS 로 실행하려다 `<` 에서 깨진다
   → 응답이 HTML 이면 JS/CSS 로 강제하지 않고 원본 그대로 통과시켜 정직하게 실패.

## 7. 미디어 스트리밍 (Range)

`<audio>`/`<video>` 는 **Range 요청(부분 전송, 206)** 을 쓴다. 버퍼 통과 시 다음 헤더를 업스트림에서 전달:
`Content-Range`, `Accept-Ranges`, `Content-Disposition`, `Cache-Control`, `ETag`, `Last-Modified`,
`Expires`, `Vary`, `Content-Language`.

> `Content-Range` 없는 206 은 브라우저가 무효 처리 → **오디오·비디오 재생 실패**(실제 발생·수정).
> 이제 재생·seek·다운로드가 정상 동작.

## 8. 타임아웃 + 폴백 체인

- **타임아웃**: 업스트림 fetch 에 `AbortController` (기본 15s, `PROXY_FETCH_TIMEOUT`). 초과 → **504**.
  무한 대기 방지. (불통 호스트는 undici 연결 타임아웃 ~10s 로 더 빨리 실패)
- **폴백 체인** (GET 문서 한정, 에러 종류별):
  - `ENOTFOUND`/`EAI_AGAIN`/cert 오류 + apex(2~3 라벨) → **`www.` 재시도** (apex 미해석/인증서 불일치 구제)
  - cert/TLS 오류 + https → **`http://` 재시도**
  - **타임아웃(abort)이면 즉시 포기** → 헛된 재시도 없이 504
- 1000개 검증에서 `www.` 폴백이 26개 사이트 복구(china.com, suning.com, japanpost.jp 등).

## 9. 스냅샷 서빙 우선순위

`/proxy` 요청 시(GET 문서):
1. `?fresh=1` 아니고 로컬 스냅샷 있으면 → 스냅샷 서빙(`x-vp-source: local`)
2. `?render=1` 이면 → Playwright 렌더(`x-vp-source: render`)
3. 그 외 → 실시간 fetch(`x-vp-source: live`)

API 호출(POST 등)은 스냅샷/렌더를 건너뛰고 항상 실시간 전달.

## 10. 응답 헤더 위생

- `access-control-allow-origin: *`(확장/교차 출처 허용)
- `<meta name="referrer" content="no-referrer">` 주입
- 페이지에 아이콘 링크 없으면 빈 `data:` 아이콘 주입(기본 `/favicon.ico` 404 노이즈 억제)
