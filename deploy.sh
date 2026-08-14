#!/usr/bin/env bash
# ==============================================================================
# Job Ops - Universal End-to-End Deployment Script
#
# Usage:
#   1. Remote deploy over SSH:
#      ./deploy.sh <user@host | ip>
#      Example: ./deploy.sh 157.245.138.16
#      Example: ./deploy.sh root@157.245.138.16
#
#   2. Local deploy on server:
#      ./deploy.sh
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  echo -e "${BLUE}${BOLD}[DEPLOY]${NC} $1"
}

success() {
  echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"
}

error() {
  echo -e "${RED}${BOLD}[ERROR]${NC} $1" >&2
}

# --- Case 1: Local direct deployment on the server ---
if [ -z "$TARGET" ]; then
  if [ -f "${SCRIPT_DIR}/scripts/setup-server.sh" ]; then
    log "Running local server deployment..."
    exec bash "${SCRIPT_DIR}/scripts/setup-server.sh"
  else
    error "setup-server.sh not found in scripts directory."
    exit 1
  fi
fi

# --- Case 2: Remote deployment via SSH ---
# Parse user@host or default to root@
if [[ "$TARGET" =~ ^.*@.*$ ]]; then
  REMOTE_USER_HOST="$TARGET"
  HOST_ONLY="${TARGET#*@}"
else
  REMOTE_USER_HOST="root@$TARGET"
  HOST_ONLY="$TARGET"
fi

log "Initiating end-to-end deployment to ${REMOTE_USER_HOST}..."

# 1. Test SSH connectivity
log "Testing SSH connection to ${REMOTE_USER_HOST}..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new "${REMOTE_USER_HOST}" "echo 'SSH connected'" >/dev/null 2>&1; then
  error "Failed to connect to ${REMOTE_USER_HOST} via SSH. Please verify your SSH credentials and network connection."
  exit 1
fi
success "SSH connection verified."

# 2. Build production client bundle locally
log "Building production client bundle locally..."
npm --workspace orchestrator run build:client

# 3. Ensure remote directory exists
log "Ensuring /var/www/job-ops exists on remote host..."
ssh "${REMOTE_USER_HOST}" "mkdir -p /var/www/job-ops/data /var/www/job-ops/scripts"

# 4. Synchronize codebase using rsync
log "Syncing repository files to ${REMOTE_USER_HOST}:/var/www/job-ops..."
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  --exclude='.agents' \
  --exclude='.gemini' \
  --exclude='.claude' \
  --exclude='.codex' \
  --exclude='.opencode' \
  "${SCRIPT_DIR}/" "${REMOTE_USER_HOST}:/var/www/job-ops/"
success "Files synchronized to remote server."

# 5. Execute setup-server.sh on remote host
log "Executing server provisioning and deployment on remote host..."
ssh -t "${REMOTE_USER_HOST}" "bash /var/www/job-ops/scripts/setup-server.sh"

# 6. Verify live deployment from local machine
log "Verifying live public endpoint http://${HOST_ONLY}/health..."
LIVE_OK=false
for i in {1..20}; do
  if curl -sf "http://${HOST_ONLY}/health" >/dev/null 2>&1; then
    LIVE_OK=true
    break
  fi
  sleep 1
done

if [ "$LIVE_OK" = true ]; then
  echo ""
  success "======================================================="
  success " 🎉 Deployment to ${HOST_ONLY} completed successfully!  "
  success " 🌐 Live Web App URL: http://${HOST_ONLY}              "
  success " 💓 Health Check URL: http://${HOST_ONLY}/health       "
  success "======================================================="
else
  echo ""
  echo -e "${YELLOW}${BOLD}[NOTE]${NC} Remote service started. Access http://${HOST_ONLY} in your browser."
fi
