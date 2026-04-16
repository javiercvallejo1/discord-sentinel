#!/bin/bash
#
# install-daemon.sh — Install the sentinel daemon (macOS launchd or Linux systemd).
#
# Usage: install-daemon.sh <plugin-root>
#
# Copies sentinel files to ~/.claude/discord-sentinel/, installs dependencies,
# and sets up the appropriate service manager (launchd on macOS, systemd on Linux).

set -euo pipefail

PLUGIN_ROOT="${1:-.}"
SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
OS="$(uname -s)"

echo "Installing Discord Sentinel daemon..."
echo "Detected OS: ${OS}"

# ── Check prerequisites ─────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "Error: bun is required. Install it: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install it via your package manager (brew install jq / apt install jq / dnf install jq)"
  exit 1
fi

if ! command -v screen &>/dev/null; then
  echo "Error: screen is required. Install it via your package manager (brew install screen / apt install screen / dnf install screen)"
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

# Copy bot management scripts
cp "${PLUGIN_ROOT}/scripts/add-bot.sh" "${SENTINEL_DIR}/add-bot"
cp "${PLUGIN_ROOT}/scripts/remove-bot.sh" "${SENTINEL_DIR}/remove-bot"
cp "${PLUGIN_ROOT}/scripts/uninstall-daemon.sh" "${SENTINEL_DIR}/uninstall"
cp "${PLUGIN_ROOT}/scripts/session-start-hook.sh" "${SENTINEL_DIR}/session-start-hook.sh"
chmod +x "${SENTINEL_DIR}/add-bot" "${SENTINEL_DIR}/remove-bot" "${SENTINEL_DIR}/uninstall" "${SENTINEL_DIR}/session-start-hook.sh"

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

# ── Install service (OS-specific) ───────────────────────────────────────────
case "${OS}" in
  Darwin)
    # macOS — launchd
    PLIST_DIR="${HOME}/Library/LaunchAgents"
    PLIST_NAME="com.claude.discord-sentinel"
    PLIST_FILE="${PLIST_DIR}/${PLIST_NAME}.plist"

    # Unload existing service if present
    if launchctl list "${PLIST_NAME}" &>/dev/null; then
      echo "Stopping existing sentinel service..."
      launchctl unload "${PLIST_FILE}" 2>/dev/null || true
    fi

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
    launchctl load "${PLIST_FILE}"

    echo ""
    echo "Sentinel daemon installed and running (macOS/launchd)."
    echo "  Daemon: ${SENTINEL_DIR}/sentinel.ts"
    echo "  Service: ${PLIST_FILE}"
    echo "  Logs: ${SENTINEL_DIR}/logs/"
    ;;

  Linux)
    # Linux — systemd user service
    if ! command -v systemctl &>/dev/null; then
      echo "Error: systemctl not found. This plugin requires systemd on Linux."
      echo "Supported distros: Ubuntu, Debian, Fedora, Arch, etc. (anything with systemd)"
      exit 1
    fi

    SERVICE_DIR="${HOME}/.config/systemd/user"
    SERVICE_NAME="claude-discord-sentinel"
    SERVICE_FILE="${SERVICE_DIR}/${SERVICE_NAME}.service"

    # Stop existing service if present
    if systemctl --user is-active "${SERVICE_NAME}" &>/dev/null; then
      echo "Stopping existing sentinel service..."
      systemctl --user stop "${SERVICE_NAME}" 2>/dev/null || true
    fi

    mkdir -p "${SERVICE_DIR}"
    cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=Discord Sentinel - Bot pool manager for Claude Code
After=network.target

[Service]
Type=simple
ExecStart=${BUN_PATH} ${SENTINEL_DIR}/sentinel.ts
WorkingDirectory=${SENTINEL_DIR}
Restart=always
RestartSec=5
Environment="PATH=/usr/local/bin:/usr/bin:/bin:%h/.bun/bin:%h/.local/bin"
StandardOutput=append:${SENTINEL_DIR}/logs/sentinel-stdout.log
StandardError=append:${SENTINEL_DIR}/logs/sentinel-stderr.log

[Install]
WantedBy=default.target
SERVICE

    # Reload systemd, enable and start
    systemctl --user daemon-reload
    systemctl --user enable "${SERVICE_NAME}.service"
    systemctl --user start "${SERVICE_NAME}.service"

    # Enable linger so the service survives logout
    if command -v loginctl &>/dev/null; then
      loginctl enable-linger "${USER}" 2>/dev/null || echo "Note: couldn't enable linger (needs sudo). The daemon may stop on logout."
    fi

    echo ""
    echo "Sentinel daemon installed and running (Linux/systemd)."
    echo "  Daemon: ${SENTINEL_DIR}/sentinel.ts"
    echo "  Service: ${SERVICE_FILE}"
    echo "  Status: systemctl --user status ${SERVICE_NAME}"
    echo "  Logs: journalctl --user -u ${SERVICE_NAME} -f"
    echo "         or: ${SENTINEL_DIR}/logs/"
    ;;

  *)
    echo "Error: unsupported OS '${OS}'. This plugin supports macOS and Linux."
    exit 1
    ;;
esac

echo ""
echo "Next: add a bot with /add-bot"
