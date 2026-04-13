#!/bin/bash
#
# install-daemon.sh — Install the sentinel daemon and launchd service.
#
# Usage: install-daemon.sh <plugin-root>
#
# Copies sentinel files to ~/.claude/discord-sentinel/,
# installs dependencies, and sets up the launchd agent.

set -euo pipefail

PLUGIN_ROOT="${1:-.}"
SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_NAME="com.claude.discord-sentinel"
PLIST_FILE="${PLIST_DIR}/${PLIST_NAME}.plist"

echo "Installing Discord Sentinel daemon..."

# ── Check prerequisites ─────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "Error: bun is required. Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

BUN_PATH=$(which bun)

# ── Create sentinel directory ───────────────────────────────────────────────
mkdir -p "${SENTINEL_DIR}"/{locks,logs,personalities}

# ── Copy sentinel files ─────────────────────────────────────────────────────
cp "${PLUGIN_ROOT}/sentinel/sentinel.ts" "${SENTINEL_DIR}/sentinel.ts"
cp "${PLUGIN_ROOT}/sentinel/sentinel-lock.sh" "${SENTINEL_DIR}/sentinel-lock.sh"
chmod +x "${SENTINEL_DIR}/sentinel-lock.sh"

# Copy package.json for dependencies
cp "${PLUGIN_ROOT}/package.json" "${SENTINEL_DIR}/package.json"

# Copy approval hook
cp "${PLUGIN_ROOT}/scripts/discord-approve.sh" "${SENTINEL_DIR}/discord-approve.sh"
chmod +x "${SENTINEL_DIR}/discord-approve.sh"

# ── Initialize bots.json if it doesn't exist ────────────────────────────────
if [ ! -f "${SENTINEL_DIR}/bots.json" ]; then
  cat > "${SENTINEL_DIR}/bots.json" <<'BOTS'
{
  "_config": {
    "owner_id": "",
    "default_project": ""
  }
}
BOTS
  echo "Created empty bots.json — configure owner_id after adding your first bot."
fi

# ── Install dependencies ────────────────────────────────────────────────────
echo "Installing dependencies..."
cd "${SENTINEL_DIR}" && bun install --silent

# ── Unload existing service if present ──────────────────────────────────────
if launchctl list "${PLIST_NAME}" &>/dev/null; then
  echo "Stopping existing sentinel service..."
  launchctl unload "${PLIST_FILE}" 2>/dev/null || true
fi

# ── Generate launchd plist ──────────────────────────────────────────────────
mkdir -p "${PLIST_DIR}"

cat > "${PLIST_FILE}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN_PATH}</string>
        <string>${SENTINEL_DIR}/sentinel.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SENTINEL_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SENTINEL_DIR}/logs/sentinel-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${SENTINEL_DIR}/logs/sentinel-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLIST

# ── Load the service ────────────────────────────────────────────────────────
launchctl load "${PLIST_FILE}"

echo ""
echo "Sentinel daemon installed and running."
echo "  Daemon: ${SENTINEL_DIR}/sentinel.ts"
echo "  Service: ${PLIST_FILE}"
echo "  Logs: ${SENTINEL_DIR}/logs/"
echo ""
echo "Next: add a bot with /add-bot"
