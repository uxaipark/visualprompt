# VisualPrompt

웹 UI 위에 **수정 프롬프트를 핀으로 꽂아** "수정 포인트(fixpoint)"를 수집하고,
이를 **서버의 inbox 디렉토리에 구조화된 문서로 적재**해 서버에서 도는 에이전트(Claude Code 등)가
실제 소스코드를 고치게 하는 도구. SPA·로그인·봇차단 사이트는 **헤드리스 브라우저 렌더**로 대응한다.

## 빠른 시작
```bash
bash install.sh      # 의존성 + Chromium + .env
npm run dev          # 서버 :3001 + 클라이언트 :5173  → http://localhost:5173
# 또는 배포 단일 서빙
npm run preview      # 빌드 후 http://localhost:3001
```

## 3가지 사용 시나리오
1. **로컬 개발 서버 수정** — `fixpin.config.json` 의 `targets` 에 개발 프론트엔드 URL·`repoRoot` 를 등록.
   핀을 꽂으면 수정 포인트가 `fixpoints/pending/fp-NNN.{json,md}` 로 적재되고, 에이전트가 `fixpoints/AGENT.md`
   지침에 따라 레포 소스를 고친다.
2. **공개 사이트 수정 포인트 다운로드** — URL 을 불러와 핀을 꽂고, 사이드패널 `전체↓` 로
   **스크린샷(PNG) + MD + JSON** 을 다운로드.
3. **크롤 → 편집 미리보기** — `로컬 저장`(스냅샷)으로 페이지를 서버에 보존한 뒤,
   `AI 적용`(ANTHROPIC_API_KEY 필요)으로 크롤된 소스를 고쳐 변경된 모습을 미리 본다.

## 수집 경로
- **프록시 모드**(기본): 서버가 fetch→재작성→인스펙터 주입→재서빙. 로컬 개발서버·단순 사이트에 빠름.
- **렌더 모드**(🎭 토글): 헤드리스 Chromium 으로 완성 DOM 을 렌더. naver/로그인/SPA/Figma 대응.

## 디렉토리
```
server/   index.js(라우팅) proxy.js(재작성) render.js(Playwright) snapshot.js inbox.js
          public/{shim,inspector}.js
client/   React 앱 (Toolbar·SidePanel·App + lib/exporters)
fixpoints/ pending|applied|AGENT.md   ← 에이전트 inbox
snapshots/ 크롤 스냅샷
```

## API
- `GET  /proxy?url=&render=` — 페이지 래핑(+렌더)
- `GET  /api/config` — 타깃·렌더러 가용 여부
- `GET/POST/DELETE /api/snapshot` — 스냅샷(렌더 옵션)
- `GET  /api/screenshot?url=&full=` — 풀페이지 PNG
- `GET/POST /api/fixpoints` · `POST /api/fixpoints/:id/apply` · `DELETE /api/fixpoints/:id`
- `POST /api/edit` — 스냅샷 outerHTML AI 수정(미리보기)
