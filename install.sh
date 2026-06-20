#!/usr/bin/env bash
# VisualPrompt 설치 스크립트 — 개발 서버에 복사 후 1줄 실행.
#   bash install.sh            # 의존성 설치 + Chromium + .env 준비
#   PORT=3001 npm start        # 프로덕션 실행 (빌드 포함은 npm run preview)
set -e
cd "$(dirname "$0")"

echo "▶ Node 의존성 설치…"
npm install

echo "▶ Playwright Chromium 설치(렌더 모드 — SPA/로그인/봇차단 대응)…"
npx playwright install chromium || echo "  (Chromium 설치 실패 — 렌더 모드 없이도 동작합니다)"

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
  echo "▶ .env 생성됨 — AI 미리보기를 쓰려면 ANTHROPIC_API_KEY 를 채우세요."
fi

echo ""
echo "✅ 설치 완료."
echo "   개발:   npm run dev      (서버 :3001 + 클라이언트 :5173)"
echo "   배포:   npm run preview  (빌드 후 :3001 단일 서빙)"
echo ""
echo "   로컬 개발 프론트엔드를 대상으로 하려면 fixpin.config.json 의 targets[].url 과 repoRoot 를 채우세요."
echo "   수집된 수정 포인트는 fixpoints/pending/ 에 쌓이고, 에이전트는 fixpoints/AGENT.md 를 따릅니다."
