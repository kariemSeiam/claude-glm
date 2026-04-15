#!/bin/bash
# claude-glm — Launch Claude Code with Z.AI GLM models
#
# Usage:
#   ./claude-glm.sh                    # defaults to glm-5.1
#   ./claude-glm.sh glm-5-turbo        # specify model
#   ./claude-glm.sh glm-4.7-flash      # free tier model
#
# Set your API key once:
#   export ZAI_API_KEY="your-key-here"
# Or pass it inline:
#   ZAI_API_KEY="your-key" ./claude-glm.sh

set -euo pipefail

# ── Config ──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_PORT=9147
MODEL="${1:-glm-5.1}"
API_KEY="${ZAI_API_KEY:-}"

# ── Validate ────────────────────────────────────────────
if [ -z "$API_KEY" ]; then
  echo "❌ ZAI_API_KEY not set."
  echo ""
  echo "  Get one: https://open.bigmodel.cn/usercenter/apikeys"
  echo "  Then:    export ZAI_API_KEY=\"your-key\""
  echo "  Or:      ZAI_API_KEY=\"your-key\" $0 $MODEL"
  exit 1
fi

# ── Kill stale proxy ────────────────────────────────────
if command -v fuser &>/dev/null; then
  fuser -k "${PROXY_PORT}/tcp" 2>/dev/null || true
fi
sleep 0.3

# ── Start proxy ─────────────────────────────────────────
echo "🚀 Starting GLM proxy on port ${PROXY_PORT}..."
NODE_TLS_REJECT_UNAUTHORIZED=0 node "${SCRIPT_DIR}/proxy.js" &
PROXY_PID=$!
sleep 1

# Make sure proxy started
if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "❌ Proxy failed to start. Is port ${PROXY_PORT} in use?"
  exit 1
fi

# ── Cleanup on exit ─────────────────────────────────────
cleanup() {
  echo ""
  echo "🛑 Stopping proxy (PID ${PROXY_PID})..."
  kill "$PROXY_PID" 2>/dev/null || true
  if command -v fuser &>/dev/null; then
    fuser -k "${PROXY_PORT}/tcp" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── Launch Claude Code ──────────────────────────────────
echo "🧠 Launching Claude Code with ${MODEL}..."
echo ""

exec claude \
  --model "$MODEL" \
  --dangerously-skip-permissions \
  env \
    ANTHROPIC_BASE_URL="http://localhost:${PROXY_PORT}" \
    ANTHROPIC_API_KEY="$API_KEY"
