#!/usr/bin/env bash
# VisualPrompt install script — copy to the dev server and run with one line.
#   bash install.sh            # install dependencies + Chromium + prepare .env
#   PORT=3001 npm start        # production run (use npm run preview to include the build)
set -e
cd "$(dirname "$0")"

echo "▶ Installing Node dependencies…"
npm install

echo "▶ Installing Playwright Chromium (render mode — handles SPA/login/bot-block)…"
npx playwright install chromium || echo "  (Chromium install failed — works without render mode too)"

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
  echo "▶ .env created — fill in ANTHROPIC_API_KEY to use the AI preview."
fi

echo ""
echo "✅ Install complete."
echo "   Dev:    npm run dev      (server :3001 + client :5173)"
echo "   Deploy: npm run preview  (build then single-server serving on :3001)"
echo ""
echo "   To target a local dev frontend, fill in targets[].url and repoRoot in fixpin.config.json."
echo "   Collected fixpoints pile up in fixpoints/pending/, and the agent follows fixpoints/AGENT.md."
