#!/bin/bash
# Install claude-glm — sets up symlink and shell alias
#
# Usage:
#   ./install.sh              # installs to ~/.local/bin
#   ./install.sh --global     # installs to /usr/local/bin (needs sudo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--global" ]; then
  BIN_DIR="/usr/local/bin"
  SUDO="sudo"
else
  BIN_DIR="${HOME}/.local/bin"
  SUDO=""
fi

# Create bin dir if needed
mkdir -p "$BIN_DIR"

# Symlink the script
${SUDO} ln -sf "${SCRIPT_DIR}/claude-glm.sh" "${BIN_DIR}/claude-glm"
${SUDO} chmod +x "${BIN_DIR}/claude-glm"

echo "✅ Installed claude-glm → ${BIN_DIR}/claude-glm"
echo ""

# Check if bin dir is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "⚠️  ${BIN_DIR} is not in your PATH."
  echo ""
  echo "   Add this to your ~/.zshrc or ~/.bashrc:"
  echo ""
  echo '     export PATH="$HOME/.local/bin:$PATH"'
  echo ""
  echo "   Then restart your shell."
else
  echo "✅ ${BIN_DIR} is in your PATH."
fi

echo ""
echo "Next steps:"
echo ""
echo "  1. Set your API key (once):"
echo '     export ZAI_API_KEY="your-key-here"'
echo ""
echo "  2. Run Claude Code with GLM:"
echo "     claude-glm              # glm-5.1 (default)"
echo "     claude-glm glm-5-turbo  # faster coding model"
echo "     claude-glm glm-4.7-flash  # free tier"
echo ""
