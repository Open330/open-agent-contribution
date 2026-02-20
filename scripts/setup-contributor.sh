#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────
# OAC Auto-Contribute — Setup + Run
#
# Usage:
#   bash scripts/setup-contributor.sh [options]
#   curl -fsSL https://raw.githubusercontent.com/open330/open-agent-contribution/main/scripts/setup-contributor.sh | bash
#
# Options (via env vars):
#   REPO=owner/repo          Target repo (default: open330/burstpick)
#   TOKENS=50000             Token budget (default: 50000, or "unlimited")
#   PROVIDER=claude-code     Agent provider (default: claude-code)
#   CONCURRENCY=2            Parallel agents (default: 2)
#   DRY_RUN=1                Preview only, don't execute (default: 0)
#   SKIP_RUN=1               Setup only, don't run OAC (default: 0)
# ─────────────────────────────────────────────────────

REPO="${REPO:-open330/burstpick}"
TOKENS="${TOKENS:-50000}"
PROVIDER="${PROVIDER:-claude-code}"
CONCURRENCY="${CONCURRENCY:-2}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_RUN="${SKIP_RUN:-0}"
OAC_VERSION="latest"
NODE_MIN="20"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
fail() { echo -e "  ${RED}✘${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
step() { echo -e "\n${BOLD}$1${NC}"; }

TOTAL_STEPS=7
[ "$SKIP_RUN" = "1" ] && TOTAL_STEPS=6

# ── 1. Node.js ──────────────────────────────────────
step "1/${TOTAL_STEPS}  Checking Node.js (>= ${NODE_MIN})"
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if (( NODE_MAJOR >= NODE_MIN )); then
    ok "Node.js v${NODE_VER}"
  else
    fail "Node.js v${NODE_VER} — need >= ${NODE_MIN}"
    echo "    Install:  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22"
    exit 1
  fi
else
  fail "Node.js not found"
  echo "    Install:  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22"
  exit 1
fi

# ── 2. GitHub CLI ────────────────────────────────────
step "2/${TOTAL_STEPS}  Checking GitHub CLI (gh)"
GH_OK=false
if command -v gh &>/dev/null; then
  ok "gh $(gh --version | head -1 | awk '{print $3}')"
  if gh auth status &>/dev/null; then
    ok "gh authenticated"
    GH_OK=true
  else
    warn "gh not authenticated — run: gh auth login"
    echo "    OAC needs gh auth to create PRs"
  fi
else
  warn "gh not found — install from https://cli.github.com"
  echo "    macOS: brew install gh"
  echo "    Linux: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
fi

# ── 3. AI Agent CLI ─────────────────────────────────
step "3/${TOTAL_STEPS}  Checking agent CLI: ${PROVIDER}"
AGENT_CLI=""
case "$PROVIDER" in
  claude-code) AGENT_CLI="claude" ;;
  codex)       AGENT_CLI="codex" ;;
  opencode)    AGENT_CLI="opencode" ;;
  *)           AGENT_CLI="$PROVIDER" ;;
esac

if command -v "$AGENT_CLI" &>/dev/null; then
  ok "${AGENT_CLI} found"
else
  fail "${AGENT_CLI} not found — required for provider '${PROVIDER}'"
  echo "    Install the ${AGENT_CLI} CLI before running OAC"
  exit 1
fi

# ── 4. Install OAC ──────────────────────────────────
step "4/${TOTAL_STEPS}  Installing @open330/oac"
if command -v oac &>/dev/null; then
  CURRENT=$(oac --version 2>/dev/null || echo "unknown")
  ok "oac ${CURRENT}"
else
  npm install -g "@open330/oac@${OAC_VERSION}"
  ok "oac $(oac --version 2>/dev/null || echo 'installed')"
fi

# ── 5. Doctor check ─────────────────────────────────
step "5/${TOTAL_STEPS}  Running oac doctor"
oac doctor || warn "Some checks failed — review above"

# ── 6. Initialize workspace ─────────────────────────
REPO_SLUG=$(echo "$REPO" | tr '/' '-')
WORKSPACE="${HOME}/workspace-open330/oac-contrib-${REPO_SLUG}"

step "6/${TOTAL_STEPS}  Initializing workspace: ${WORKSPACE}"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

if [ -f "oac.config.ts" ]; then
  ok "oac.config.ts exists — skipping init"
else
  oac init --minimal --repo "${REPO}"
  ok "Initialized for ${REPO}"
fi

# ── 7. Run OAC ──────────────────────────────────────
if [ "$SKIP_RUN" = "1" ]; then
  echo ""
  echo -e "${BOLD}────────────────────────────────────────${NC}"
  echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
  echo -e "${BOLD}────────────────────────────────────────${NC}"
  echo ""
  echo "  Workspace: ${WORKSPACE}"
  echo "  To start:  cd ${WORKSPACE} && oac run --repo ${REPO} --tokens ${TOKENS}"
  echo ""
  exit 0
fi

step "7/${TOTAL_STEPS}  Running OAC against ${REPO}"
echo ""
echo -e "  Repo:        ${BOLD}${REPO}${NC}"
echo -e "  Provider:    ${BOLD}${PROVIDER}${NC}"
echo -e "  Tokens:      ${BOLD}${TOKENS}${NC}"
echo -e "  Concurrency: ${BOLD}${CONCURRENCY}${NC}"
[ "$DRY_RUN" = "1" ] && echo -e "  Mode:        ${YELLOW}DRY RUN${NC}"
echo ""

RUN_CMD="oac run --repo ${REPO} --tokens ${TOKENS} --provider ${PROVIDER} --concurrency ${CONCURRENCY}"
[ "$DRY_RUN" = "1" ] && RUN_CMD="${RUN_CMD} --dry-run"

echo -e "  ${BOLD}\$ ${RUN_CMD}${NC}"
echo ""

eval "$RUN_CMD"
EXIT_CODE=$?

echo ""
echo -e "${BOLD}────────────────────────────────────────${NC}"
case $EXIT_CODE in
  0) echo -e "${GREEN}${BOLD}  ✔ All tasks completed successfully${NC}" ;;
  3) echo -e "${RED}${BOLD}  ✘ All tasks failed${NC}" ;;
  4) echo -e "${YELLOW}${BOLD}  ⚠ Partial success — some tasks failed${NC}" ;;
  *) echo -e "${RED}${BOLD}  ✘ Exited with code ${EXIT_CODE}${NC}" ;;
esac
echo -e "${BOLD}────────────────────────────────────────${NC}"
echo ""
echo "  Workspace: ${WORKSPACE}"
echo "  Logs:      oac log --repo ${REPO}"
echo "  Retry:     oac run --repo ${REPO} --retry-failed"
echo ""

