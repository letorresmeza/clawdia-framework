#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# rollback-to-trading.sh — Roll back to Clawdia v3 trading mode
#
# What this does:
#   1. Stops the clawdia-broker PM2 process
#   2. Restarts the old agent-stack PM2 process
#   3. Restores the crontab from backup
#   4. Sends Telegram notification
#
# This does NOT delete /var/lib/clawdia state or logs.
# Run from /root/clawdia-framework
# ─────────────────────────────────────────────────────────

set -euo pipefail

V3_DIR="/root/clawdia-v3"
BACKUP_DIR="${V3_DIR}/backup"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()     { echo -e "${RED}[FATAL]${NC} $*"; exit 1; }

command -v pm2 &>/dev/null || die "pm2 not found"

info "=== Clawdia Rollback: Framework Broker → v3 Trading Mode ==="
echo ""

# ─────────────────────────────────────────────────────────
# Step 1: Stop clawdia-broker
# ─────────────────────────────────────────────────────────
info "Step 1: Stopping clawdia-broker..."
if pm2 list --no-color 2>/dev/null | grep -q "clawdia-broker"; then
  pm2 stop clawdia-broker --no-color 2>/dev/null || true
  success "clawdia-broker stopped"
else
  info "clawdia-broker not running — skipping"
fi

# ─────────────────────────────────────────────────────────
# Step 2: Restart agent-stack
# ─────────────────────────────────────────────────────────
info "Step 2: Restarting agent-stack..."
if pm2 list --no-color 2>/dev/null | grep -q "agent-stack"; then
  pm2 restart agent-stack --no-color || pm2 start agent-stack --no-color
  success "agent-stack restarted"
else
  warn "agent-stack PM2 process not found. You may need to restart it manually:"
  warn "  cd ${V3_DIR} && pm2 start <your-config>"
fi

# ─────────────────────────────────────────────────────────
# Step 3: Restore crontab
# ─────────────────────────────────────────────────────────
info "Step 3: Restoring crontab from backup..."
if [[ -f "${BACKUP_DIR}/crontab.bak" ]]; then
  crontab "${BACKUP_DIR}/crontab.bak"
  success "Crontab restored from ${BACKUP_DIR}/crontab.bak"
else
  warn "No crontab backup found at ${BACKUP_DIR}/crontab.bak — crontab not restored"
fi

# Save PM2 state
pm2 save --no-color 2>/dev/null || true

# ─────────────────────────────────────────────────────────
# Step 4: Telegram notification
# ─────────────────────────────────────────────────────────
info "Step 4: Sending Telegram notification..."
for ENV_PATH in "${V3_DIR}/config/.env" "${V3_DIR}/.env" "/root/.env"; do
  if [[ -f "$ENV_PATH" ]]; then
    TELEGRAM_BOT_TOKEN=$(grep -E "^TELEGRAM_BOT_TOKEN=" "$ENV_PATH" | cut -d= -f2- | tr -d '"' | tr -d "'" 2>/dev/null || echo "")
    TELEGRAM_CHAT_ID=$(grep -E "^TELEGRAM_CHAT_ID=" "$ENV_PATH" | cut -d= -f2- | tr -d '"' | tr -d "'" 2>/dev/null || echo "")
    if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] && [[ -n "${TELEGRAM_CHAT_ID:-}" ]]; then
      MSG="⚠️ Rolled back to Clawdia v3 trading mode.

agent-stack restarted. clawdia-broker stopped.
Crontab restored from backup."
      curl -s -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${MSG}\"}" \
        > /dev/null 2>&1 && success "Telegram notification sent" || warn "Telegram notification failed"
      break
    fi
  fi
done

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║           ROLLBACK COMPLETE — v3 TRADING MODE ACTIVE     ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  PM2 logs: pm2 logs agent-stack"
echo "  Crontab:  crontab -l"
echo ""
echo "  Framework state preserved at /var/lib/clawdia/"
echo "  Re-migrate: bash /root/clawdia-framework/scripts/migrate-to-broker.sh"
echo ""
