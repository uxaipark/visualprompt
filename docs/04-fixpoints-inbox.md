# 04. fixpoint inbox — 에이전트 핸드오프

수집의 최종 산출물. 핀 하나 = `fixpoints/pending/fp-NNN.{json,md}` 파일 하나.
서버에서 도는 에이전트(Claude Code 등)가 pending 을 읽어 실제 소스를 고치고 applied 로 옮긴다.

## 1. 디렉토리 구조

```
fixpoints/
├─ pending/   fp-001.json + fp-001.md   ← 미처리 수정 포인트
├─ applied/   (처리 완료해 이동된 것)
└─ AGENT.md   에이전트 작업 지침 (자동 생성)
```

`pending/`·`applied/` 의 fp 파일은 `.gitignore` 대상(실데이터). 구조·`AGENT.md`·`.gitkeep` 만 커밋.

## 2. fixpoint JSON 스키마 (`inbox.js: saveFixpoint`)

```jsonc
{
  "id": "fp-001",
  "createdAt": "2026-06-20T...Z",
  "status": "pending",
  "prompt": "구매 버튼을 더 크게, 초록색으로",   // 사용자 수정 지시
  "page": "http://localhost:3000/",
  "target": { "mode": "local|proxy|extension", "url": "...", "repoRoot": "./demo-app" },
  "view": { "title": "...", "heading": "...", "url": "..." },
  "element": {
    "tag": "button", "id": "buy",
    "selector": "#buy",
    "xpath": "/html/body/button[1]",
    "rect": { "x": 10, "y": 20, "w": 80, "h": 30 },
    "text": "구매", "classes": ["btn","primary"], "attributes": {...}
  },
  "clues": {
    "framework": "react",
    "testids": ["buy-btn"], "components": ["BuyButton"],
    "ids": [...], "labels": [...], "classes": [...],
    "bundles": ["..."], "api": [{ "method":"POST", "path":"/api/order" }]
  },
  "sourceHints": {
    "frontend": ["data-testid=\"buy-btn\"", "component:BuyButton", ".btn"],
    "backend":  ["POST /api/order"]
  },
  "fileHints": ["**/BuyButton*.{jsx,tsx,vue,svelte}", "grep: data-testid=\"buy-btn\""],
  "snapshot": null
}
```

### 단서(clues)는 어떻게 모으나 (`inspector.js: sourceClues`)
대상에서 부모 방향 6단계까지 올라가며 수집:
- `data-*` 중 의미있는 것(`testid`/`qa`/`component`/`name` 등)
- `id`, `name`, `aria-label`, `role`
- 의미있는 클래스(해시·숫자·`__vp` 접두 제외)
- framework 감지(next/nuxt/vue/angular/svelte/react)
- 번들 스크립트, 최근 API 호출(`__VP_NET__` / 확장은 PerformanceObserver)

### 검색어 도출 (`exporters.js` / `inbox.js` 동일 규칙)
- 프론트엔드: `data-testid="..."`, `component:...`, `#id`, label, `.class`
- 백엔드: `METHOD /path`

## 3. Markdown (`fp-NNN.md`) — 에이전트가 읽는 문서

```markdown
# Fixpoint fp-001
> 상태: pending · 생성: ...

## 수정 지시 (사용자 프롬프트)
구매 버튼을 더 크게, 초록색으로

## 대상 요소
- 태그: `button#buy`  / selector: `#buy` / xpath: ... / 위치: x= y= w= h= / 텍스트: 구매

## 페이지 / 뷰
- page / mode(local, repoRoot) / view / framework

## 소스코드에서 찾을 단서
- 프론트엔드 검색어: `data-testid="buy-btn"`, `component:BuyButton`, `.btn`
- 백엔드 API 경로: `POST /api/order`
- 추정 파일: `**/BuyButton*.{jsx,tsx,vue,svelte}`

---
> 에이전트: 위 검색어로 레포에서 소스를 찾아 "수정 지시"대로 고치고, 처리 후 applied/ 로 옮기세요.
```

## 4. API (`index.js`)

| 엔드포인트 | 동작 |
|---|---|
| `GET /api/fixpoints` | `{ pending: [...], applied: [...] }` |
| `POST /api/fixpoints` | fixpoint 저장 (prompt·element 필수) → `fp-NNN.{json,md}` 생성 |
| `POST /api/fixpoints/:id/apply` | pending → applied 이동(처리완료 표시) |
| `DELETE /api/fixpoints/:id` | 삭제 |

`/api` 는 CORS 허용(`*`) — 브라우저 확장이 임의 사이트 origin 에서 POST 할 수 있도록(OPTIONS preflight 처리).

## 5. 일련번호 (`nextSeq`)

`pending/`·`applied/` 양쪽의 `fp-NNN` 중 최대 +1. 처리 후 applied 로 옮겨도 번호가 겹치지 않는다.

## 6. 에이전트 작업 절차 (AGENT.md)

1. `pending/` 의 각 `fp-NNN.md` 를 읽는다.
2. "소스코드에서 찾을 단서"(검색어/추정 파일)로 레포에서 대상을 찾는다.
   `target.repoRoot` 가 있으면 그 레포 안에서(local 모드).
3. "수정 지시"대로 타깃만 정확히 고친다.
4. 처리한 fp 파일(`.json`/`.md`)을 `applied/` 로 옮긴다.

## 7. target.mode 의미

| mode | 수집 경로 | repoRoot |
|---|---|---|
| `local` | 프록시(로컬 개발서버 타깃) | `fixpin.config.json` 의 targets[].repoRoot |
| `proxy` | 프록시(외부 URL) | 보통 없음(다운로드 추출용) |
| `extension` | 브라우저 확장(실제 탭) | 없음(page URL 로 추정) |
