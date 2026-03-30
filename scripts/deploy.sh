#!/usr/bin/env bash
# SignalBridge quick deploy helper
set -e

echo "🚀 SignalBridge Deploy"
echo "----------------------"

# Check node version
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found v$NODE_VER)"
  exit 1
fi

# Install deps
echo "📦 Installing dependencies..."
npm ci --only=production

# Check .env exists
if [ ! -f .env ]; then
  echo "⚠️  No .env found — copying .env.example"
  cp .env.example .env
  echo "✏️  Edit .env with your broker credentials, then re-run this script."
  exit 0
fi

# Run tests
echo "🧪 Running tests..."
npm test

echo ""
echo "✅ Ready! Start with:  npm start"
echo "   Dashboard:          http://localhost:${PORT:-3000}"
echo "   Webhook URL:        http://localhost:${PORT:-3000}/hook/YOUR_TOKEN/signal"
