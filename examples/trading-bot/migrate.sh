#!/usr/bin/env bash
# =============================================================================
# migrate.sh — Migrate Clawdia v3 OpenClaw crons to Framework Scheduler
# =============================================================================
# Usage:
#   ./migrate.sh backup      — Back up current crontab only
#   ./migrate.sh show        — Show cron → framework mapping
#   ./migrate.sh disable     — Comment out the 7 trading crons in crontab
#   ./migrate.sh enable      — Start the bridge scheduler
#   ./migrate.sh status      — Show what is currently running
#
# SAFE: no destructive actions unless you run 'disable'.
# The original Python scripts are NOT modified.
# =============================================================================

set -euo pipefail

BACKUP_DIR="${HOME}/.openclaw/workspace/cron-backups"
BACKUP_FILE="${BACKUP_DIR}/crontab-$(date +%Y%m%d-%H%M%S).bak"
BRIDGE_SCRIPT="$(cd "$(dirname "$0")" && pwd)/bridge.ts"
FRAMEWORK_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_FILE="/tmp/clawdia-bridge.pid"

# OpenClaw cron IDs from config/crons.txt
CRON_IDS=(
  "35ee96c5"   # Weather Trading       — every 30min
  "46aee3c2"   # High Conviction Scanner — every 2h
  "773853e2"   # Crypto News Scraper   — 8AM & 8PM UTC
  "c2819863"   # Portfolio Health Check — 10AM/4PM/10PM
  "36c26183"   # System Health Check   — every 4h
  "fc705151"   # Morning Briefing      — 2PM UTC
  "nightly"    # Nightly Meta-Learning — 5AM UTC
  "5cb63996"   # Digital Citadel Backup — Sunday 2AM UTC (keep running; not migrated)
)

cmd="${1:-show}"

# ─── backup ─────────────────────────────────────────────────────────────────
backup() {
  mkdir -p "$BACKUP_DIR"
  if crontab -l &>/dev/null; then
    crontab -l > "$BACKUP_FILE"
    echo "[migrate] Crontab backed up to: $BACKUP_FILE"
  else
    echo "[migrate] No crontab found for user $(whoami). Nothing to back up."
  fi
}

# ─── show ────────────────────────────────────────────────────────────────────
show_mapping() {
  cat <<'EOF'

Clawdia v3 Cron → Framework Task Contract Mapping
====================================================

OpenClaw Cron ID    Name                    Cron Schedule           → Framework Capability
─────────────────────────────────────────────────────────────────────────────────────────
35ee96c5            Weather Trading         */30 * * * *            → analysis.market.weather
                    (every 30 minutes)

46aee3c2            High Conviction Scanner 0 */2 * * *             → trading.polymarket.scan
                    (every 2 hours)

773853e2            Crypto News Scraper     0 8,20 * * *            → analysis.market.sentiment
                    (8AM & 8PM UTC / 2AM & 2PM CST)

c2819863            Portfolio Health Check  0 10,16,22 * * *        → trading.monitoring.portfolio
                    (10AM, 4PM, 10PM UTC)

36c26183            System Health Check     0 */4 * * *             → trading.monitoring.positions
                    (every 4 hours)

fc705151            Morning Briefing        0 14 * * *              → trading.monitoring.portfolio
                    (2PM UTC = 8AM CST)

nightly             Nightly Meta-Learning   0 5 * * *               → trading.monitoring.portfolio
                    (5AM UTC = 11PM CST)

5cb63996            Digital Citadel Backup  0 2 * * 0               → NOT MIGRATED (keep in crontab)
                    (Sunday 2AM UTC — maintenance task, not a trading job)

The bridge's SimpleScheduler replicates the timing of the 7 trading/intelligence
crons as framework TaskContracts flowing through ContractEngine. Each fires on
an equivalent interval and respects the circuit breaker state.

The Digital Citadel Backup cron (5cb63996) should remain in the system crontab
as it is a maintenance task unrelated to trading.

EOF
}

# ─── disable ─────────────────────────────────────────────────────────────────
disable_crons() {
  if ! crontab -l &>/dev/null; then
    echo "[migrate] No crontab found. Nothing to disable."
    return
  fi

  # Back up first
  backup

  echo "[migrate] Commenting out the 7 trading crons from crontab..."

  # Extract current crontab
  TEMP_CRON=$(mktemp)
  crontab -l > "$TEMP_CRON"

  # Comment out any lines containing the OpenClaw cron IDs (except backup)
  for id in "${CRON_IDS[@]:0:7}"; do
    if grep -q "$id" "$TEMP_CRON"; then
      sed -i "s|^\\(.*${id}.*\\)$|# [framework-migrated] \\1|" "$TEMP_CRON"
      echo "  Disabled: $id"
    fi
  done

  # Install modified crontab
  crontab "$TEMP_CRON"
  rm -f "$TEMP_CRON"

  echo "[migrate] Done. The 7 trading crons are now commented out."
  echo "[migrate] Digital Citadel Backup (5cb63996) was left intact."
  echo ""
  echo "[migrate] To restore: crontab $BACKUP_FILE"
}

# ─── enable (start bridge) ───────────────────────────────────────────────────
enable_bridge() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[migrate] Bridge is already running (PID $(cat "$PID_FILE")). Skipping."
    return
  fi

  if ! command -v pnpm &>/dev/null && ! command -v npx &>/dev/null; then
    echo "[migrate] ERROR: neither pnpm nor npx found. Install Node.js >= 20."
    exit 1
  fi

  echo "[migrate] Starting framework bridge scheduler..."
  echo "[migrate] Bridge script: $BRIDGE_SCRIPT"

  # Run in background, redirect output to log
  LOG_FILE="${HOME}/.openclaw/workspace/logs/bridge.log"
  mkdir -p "$(dirname "$LOG_FILE")"

  cd "$FRAMEWORK_DIR"
  nohup npx tsx "$BRIDGE_SCRIPT" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  echo "[migrate] Bridge started (PID $(cat "$PID_FILE"))"
  echo "[migrate] Logs: $LOG_FILE"
  echo ""
  echo "[migrate] The framework scheduler now handles:"
  echo "  - Weather Trading (every 30min)"
  echo "  - High Conviction Scanner (every 2h)"
  echo "  - Crypto News Scraper (8AM & 8PM UTC)"
  echo "  - Portfolio Health Check (10AM/4PM/10PM UTC)"
  echo "  - System Health Check (every 4h)"
  echo "  - Morning Briefing (2PM UTC)"
  echo "  - Nightly Meta-Learning (5AM UTC)"
}

# ─── status ──────────────────────────────────────────────────────────────────
status() {
  echo ""
  echo "=== Clawdia Bridge Status ==="
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Bridge:    RUNNING (PID $(cat "$PID_FILE"))"
  else
    echo "Bridge:    STOPPED"
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
  fi

  echo ""
  echo "=== Active Crontab (trading crons) ==="
  if crontab -l &>/dev/null; then
    for id in "${CRON_IDS[@]:0:7}"; do
      line=$(crontab -l 2>/dev/null | grep "$id" || true)
      if [ -z "$line" ]; then
        echo "  $id: NOT in crontab"
      elif echo "$line" | grep -q "^#"; then
        echo "  $id: DISABLED (commented out)"
      else
        echo "  $id: ACTIVE — $line"
      fi
    done
  else
    echo "  (no crontab)"
  fi
  echo ""

  echo "=== Recent Bridge Logs ==="
  LOG_FILE="${HOME}/.openclaw/workspace/logs/bridge.log"
  if [ -f "$LOG_FILE" ]; then
    tail -20 "$LOG_FILE"
  else
    echo "  (no log file yet)"
  fi
}

# ─── stop bridge ─────────────────────────────────────────────────────────────
stop_bridge() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "[migrate] Bridge stopped."
  else
    echo "[migrate] Bridge is not running."
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
  fi
}

# ─── restore ─────────────────────────────────────────────────────────────────
restore_crons() {
  if [ -z "${2:-}" ]; then
    echo "[migrate] Usage: $0 restore <backup-file>"
    echo "[migrate] Backups are in: $BACKUP_DIR"
    ls -la "$BACKUP_DIR" 2>/dev/null || echo "  (no backups found)"
    exit 1
  fi
  crontab "$2"
  echo "[migrate] Crontab restored from: $2"
}

# ─── dispatch ────────────────────────────────────────────────────────────────
case "$cmd" in
  backup)   backup ;;
  show)     show_mapping ;;
  disable)  backup && disable_crons ;;
  enable)   enable_bridge ;;
  stop)     stop_bridge ;;
  status)   status ;;
  restore)  restore_crons "$@" ;;
  *)
    echo "Usage: $0 {backup|show|disable|enable|stop|status|restore}"
    echo ""
    echo "  backup   — back up current crontab"
    echo "  show     — show cron → framework mapping"
    echo "  disable  — comment out the 7 trading crons (backs up first)"
    echo "  enable   — start the bridge scheduler in background"
    echo "  stop     — stop the bridge scheduler"
    echo "  status   — show bridge running state and cron status"
    echo "  restore  — restore crontab from a backup file"
    exit 1
    ;;
esac
