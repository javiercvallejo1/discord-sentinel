#!/bin/bash
#
# uninstall-daemon.sh — Remove the sentinel daemon (macOS launchd or Linux systemd).

set -euo pipefail

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
OS="$(uname -s)"

# `screen -S <name>` matches by prefix, so quitting "claude-agent-1" can hit
# "claude-agent-10". Quit only the sessions whose name matches exactly.
quit_screen() {
  { screen -ls 2>/dev/null || true; } \
    | awk -v want=".$1" 'index($1, ".") && substr($1, index($1, ".")) == want { print $1 }' \
    | while read -r id; do screen -S "$id" -X quit 2>/dev/null || true; done
}

echo "Uninstalling Discord Sentinel daemon..."

case "${OS}" in
  Darwin)
    PLIST_NAME="com.claude.discord-sentinel"
    PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"

    # Stop the service
    if launchctl list "${PLIST_NAME}" &>/dev/null; then
      echo "Stopping sentinel service..."
      launchctl unload "${PLIST_FILE}" 2>/dev/null || true
    fi

    rm -f "${PLIST_FILE}"
    echo "Removed launchd service."
    ;;

  Linux)
    SERVICE_NAME="claude-discord-sentinel"
    SERVICE_FILE="${HOME}/.config/systemd/user/${SERVICE_NAME}.service"

    if command -v systemctl &>/dev/null; then
      echo "Stopping sentinel service..."
      systemctl --user stop "${SERVICE_NAME}" 2>/dev/null || true
      systemctl --user disable "${SERVICE_NAME}" 2>/dev/null || true
      systemctl --user daemon-reload 2>/dev/null || true
    fi

    rm -f "${SERVICE_FILE}"
    echo "Removed systemd user service."
    ;;

  *)
    echo "Warning: unsupported OS '${OS}'. Skipping service removal."
    ;;
esac

# Kill any running screen sessions
for lock in "${SENTINEL_DIR}"/locks/*.lock; do
  [ -f "$lock" ] || continue
  pid=$(cat "$lock" 2>/dev/null)
  kill "$pid" 2>/dev/null || true
  botname=$(basename "$lock" .lock)
  quit_screen "claude-${botname}"
done

echo ""
echo "Sentinel service removed."
echo "Bot data preserved at: ${SENTINEL_DIR}/"
echo "  To fully remove: rm -rf ${SENTINEL_DIR}/"
echo "  Channel configs: ~/.claude/channels/discord-*/"
