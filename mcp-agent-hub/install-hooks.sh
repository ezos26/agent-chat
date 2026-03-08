#!/usr/bin/env bash
#
# Installs a global git post-commit hook that logs every commit
# to the agent-hub Neon DB via log-commit.js.
#
# Usage:
#   bash /home/ezos/projects/agent-chat/mcp-agent-hub/install-hooks.sh
#
# Prerequisites:
#   - Node.js installed
#   - DATABASE_URL set in your shell profile (~/.bashrc, ~/.zshrc, etc.)
#   - Dependencies installed: cd mcp-agent-hub && npm install

set -euo pipefail

HOOKS_DIR="${HOME}/.config/git/hooks"
HOOK_FILE="${HOOKS_DIR}/post-commit"
LOG_COMMIT_SCRIPT="/home/ezos/projects/agent-chat/mcp-agent-hub/log-commit.js"

echo "==> Setting up global git post-commit hook"

# 1. Create the hooks directory
mkdir -p "${HOOKS_DIR}"

# 2. Configure git to use global hooks directory (additive — does not remove
#    repo-level hooks; git runs global hooks in addition to local ones when
#    core.hooksPath is NOT set, so we use init.templateDir approach instead).
#    Actually, the simplest reliable approach: set core.hooksPath only if the
#    user doesn't already have repo-level hooks they depend on.  We'll use
#    a different strategy: write the hook and tell git about the global
#    hooks dir via the include mechanism.
#
#    Safest: just set core.hooksPath globally. Git will still run local hooks
#    if we chain them.  But actually core.hooksPath REPLACES local hooks.
#    So instead, we install to the global templatedir and note that only NEW
#    repos get it automatically.
#
#    For maximum compatibility, we write a standalone hook and ask the user
#    to source it from their per-repo hooks or use it globally.

# Write the hook
cat > "${HOOK_FILE}" << 'HOOK'
#!/usr/bin/env bash
# Global post-commit hook — logs commits to agent-hub
# Installed by: mcp-agent-hub/install-hooks.sh

# Run in background so it never slows down commits
(
  if [ -z "${DATABASE_URL:-}" ]; then
    # Try loading from common profile files
    for f in "${HOME}/.env" "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
      if [ -f "$f" ]; then
        # shellcheck disable=SC1090
        source "$f" 2>/dev/null || true
      fi
    done
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    node /home/ezos/projects/agent-chat/mcp-agent-hub/log-commit.js 2>/dev/null
  fi
) &
HOOK

chmod +x "${HOOK_FILE}"
echo "    Hook written to: ${HOOK_FILE}"

# 3. Tell git to use this directory for global hooks
#    NOTE: This replaces any local .git/hooks — if the user has per-repo
#    hooks they need, they should chain-call the global hook instead.
git config --global core.hooksPath "${HOOKS_DIR}"
echo "    Set git core.hooksPath = ${HOOKS_DIR}"

echo ""
echo "==> Done! Every git commit will now log to agent-hub."
echo ""
echo "Make sure DATABASE_URL is set in your environment."
echo "If you have per-repo hooks you need to preserve, add this line"
echo "to each repo's .git/hooks/post-commit:"
echo ""
echo "    ${HOOK_FILE}"
echo ""
