# VisualPrompt Collector (브라우저 확장)

프록시 없이 **현재 탭의 실제 페이지**에서 UI 요소에 수정 프롬프트를 핀으로 꽂아
VisualPrompt 서버 inbox(`fixpoints/pending`)로 바로 전송한다.
로그인된 화면·SPA·봇차단·Figma 사이트도 그대로 수집된다(그냥 내 브라우저니까).

## 설치 (개발자 모드 / load unpacked)
1. Chrome → `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드** → 이 `extension/` 폴더 선택
3. 확장 아이콘 클릭 → **VP 서버 주소** 확인(기본 `http://localhost:3001`) → 저장

## 사용
- 우하단 **📌 FAB** 버튼(또는 팝업의 "수집 모드 켜기")으로 수집 모드 ON
- 요소 클릭 → 말풍선에 프롬프트 작성 → 저장 → 토스트로 `✅ 적재됨: fp-NNN`
- 서버의 `fixpoints/pending/` 에 `.json`/`.md` 로 쌓이고, 에이전트가 `fixpoints/AGENT.md` 대로 처리

## 동작 원리
- `content.js` 가 페이지에 인스펙터(하이라이트/핀/locator/소스단서)를 주입
- 저장 시 `background.js`(service worker)가 `${server}/api/fixpoints` 로 POST (MV3 cross-origin)
- 서버 `/api` 는 CORS 허용

## 주의
- `chrome://`, 확장 스토어 등 **브라우저 내부 페이지**에는 주입 불가(브라우저 정책)
- 서버 주소를 localhost 가 아닌 곳으로 바꾸면 `manifest.json` 의 `host_permissions` 에 그 origin 을 추가해야 함
