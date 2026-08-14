#!/usr/bin/env bash
# ==============================================================================
# Job Ops - Server Initialization & Deployment Script
# Configures a fresh Ubuntu/Debian server from scratch and launches Job Ops.
# ==============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/job-ops}"
APP_PORT="${APP_PORT:-3001}"
DATA_DIR="${DATA_DIR:-${APP_DIR}/data}"

# Color output helpers
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
  echo -e "${BLUE}${BOLD}[JOB-OPS]${NC} $1"
}

success() {
  echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"
}

warn() {
  echo -e "${YELLOW}${BOLD}[WARNING]${NC} $1"
}

error() {
  echo -e "${RED}${BOLD}[ERROR]${NC} $1" >&2
}

# 1. Root check
if [ "$(id -u)" -ne 0 ]; then
  error "This setup script must be run as root (or with sudo)."
  exit 1
fi

log "Starting Job Ops end-to-end server deployment..."

# 2. Swap configuration (essential for 512MB-1GB droplets)
TOTAL_SWAP_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
if [ "$TOTAL_SWAP_KB" -lt 1048576 ]; then
  log "Configuring 2GB swap space..."
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q "/swapfile" /etc/fstab; then
      echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    success "2GB swapfile active and persisted in /etc/fstab."
  fi
else
  log "Swap space already configured ($(awk "BEGIN {print int($TOTAL_SWAP_KB/1024)}")MB)."
fi

# 3. Base OS packages
log "Updating package index and installing base dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl \
  git \
  rsync \
  build-essential \
  python3 \
  python3-pip \
  python3-venv \
  sqlite3 \
  nginx \
  ca-certificates \
  gnupg \
  ufw

# 4. LaTeX compiler for tailored resume generation
log "Ensuring LaTeX / XeTeX tools are installed for resume PDF compilation..."
apt-get install -y --no-install-recommends \
  texlive-latex-base \
  texlive-latex-recommended \
  texlive-xetex \
  texlive-fonts-recommended \
  lmodern || true

# 5. Node.js 22 LTS
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1)" != "v22" ]; then
  log "Installing Node.js 22 LTS from NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
success "Node.js $(node -v) and npm $(npm -v) ready."

# 6. Global PM2 Process Manager
if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2 globally..."
  npm install -g pm2
fi
success "PM2 $(pm2 -v) ready."

# 7. Create application directories
mkdir -p "${APP_DIR}"
mkdir -p "${DATA_DIR}"

# 8. Install NPM dependencies inside application workspace
log "Installing Node.js workspace dependencies..."
cd "${APP_DIR}"
npm install --no-audit

# 9. Build frontend client bundle if needed
if [ ! -d "${APP_DIR}/orchestrator/dist/client" ]; then
  log "Building production client bundle..."
  npm --workspace orchestrator run build:client
fi

# 10. Generate cryptographically secure environment secrets
if [ ! -f "${APP_DIR}/.env" ]; then
  log "Generating initial production .env file..."
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat <<EOF > "${APP_DIR}/.env"
PORT=${APP_PORT}
NODE_ENV=production
SESSION_SECRET=${SESSION_SECRET}
ALLOW_NO_AUTH=true
DATA_DIR=${DATA_DIR}
EOF
  cp "${APP_DIR}/.env" "${APP_DIR}/orchestrator/.env"
  success "Generated production .env with secure SESSION_SECRET."
else
  # Ensure valid SESSION_SECRET exists (not empty)
  CURRENT_SECRET=$(grep -E "^SESSION_SECRET=" "${APP_DIR}/.env" | cut -d'=' -f2- | tr -d ' ' || true)
  if [ -z "$CURRENT_SECRET" ]; then
    log "Generating missing SESSION_SECRET..."
    NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    if grep -q "^SESSION_SECRET=" "${APP_DIR}/.env"; then
      sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${NEW_SECRET}/" "${APP_DIR}/.env"
    else
      echo "SESSION_SECRET=${NEW_SECRET}" >> "${APP_DIR}/.env"
    fi
  fi

  # Ensure ALLOW_NO_AUTH and DATA_DIR exist in .env
  if ! grep -q "ALLOW_NO_AUTH" "${APP_DIR}/.env"; then
    echo "ALLOW_NO_AUTH=true" >> "${APP_DIR}/.env"
  fi
  if ! grep -q "DATA_DIR" "${APP_DIR}/.env"; then
    echo "DATA_DIR=${DATA_DIR}" >> "${APP_DIR}/.env"
  fi
  cp "${APP_DIR}/.env" "${APP_DIR}/orchestrator/.env"
fi

# 11. Write PM2 Ecosystem file
log "Configuring PM2 ecosystem..."
SESSION_SECRET_VAL=$(grep -E "^SESSION_SECRET=" "${APP_DIR}/.env" | cut -d'=' -f2- | tr -d ' ')
if [ -z "$SESSION_SECRET_VAL" ]; then
  SESSION_SECRET_VAL=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fi

cat <<EOF > "${APP_DIR}/ecosystem.config.cjs"
module.exports = {
  apps: [
    {
      name: "job-ops",
      cwd: "${APP_DIR}/orchestrator",
      script: "${APP_DIR}/node_modules/.bin/tsx",
      args: "src/server/index.ts",
      env: {
        NODE_ENV: "production",
        PORT: ${APP_PORT},
        DATA_DIR: "${DATA_DIR}",
        SESSION_SECRET: "${SESSION_SECRET_VAL}",
        ALLOW_NO_AUTH: "true",
      },
    },
  ],
};
EOF

# 12. Configure Nginx Reverse Proxy with SSE streaming support
log "Configuring Nginx reverse proxy..."
cat <<EOF > /etc/nginx/sites-available/job-ops
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # SSE (Server-Sent Events) streaming support
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/job-ops /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
systemctl enable nginx

# 13. Configure Firewall (UFW)
if command -v ufw >/dev/null 2>&1; then
  log "Configuring firewall rules..."
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow "${APP_PORT}/tcp" >/dev/null 2>&1 || true
fi

# 14. Start/Restart Application Daemon with PM2
log "Starting Job Ops service with PM2..."
pm2 startOrRestart "${APP_DIR}/ecosystem.config.cjs" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# 15. Verify Health Check
log "Verifying health check on http://127.0.0.1:${APP_PORT}/health..."
HEALTHY=false
for i in {1..15}; do
  if curl -sf "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$HEALTHY" = true ]; then
  success "======================================================="
  success " Job Ops deployed and running successfully!           "
  success " Port: ${APP_PORT} (Proxied through Nginx on Port 80) "
  success " Health check: http://127.0.0.1:${APP_PORT}/health    "
  success "======================================================="
else
  warn "Application started, but health check is taking longer than expected."
  warn "Check logs via: pm2 logs job-ops"
fi
