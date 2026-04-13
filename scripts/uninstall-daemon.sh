#!/bin/bash
#
# uninstall-daemon.sh — Remove the sentinel daemon and launchd service.

set -euo pipefail

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
PLIST_NAME="com.claude.discord-sentinel"
PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Uninstalling Discord Sentinel daemon..."

# Stop the service
if launchctl list "${PLIST_NAME}" &>/dev/null; then
  echo "Stopping sentinel service..."
  launchctl unload "${PLIST_FILE}" 2>/dev/null || true
fi

# Remove plist
rm -f "${PLIST_FILE}"
echo "Removed launchd service."

# Kill any running screen sessions
for lock in "${SENTINEL_DIR}"/locks/*.lock; do
  [ -f "$lock" ] || continue
  pid=$(cat "$lock" 2>/dev/null)
  kill "$pid" 2>/dev/null || true
  botname=$(basename "$lock" .lock)
  screen -S "claude-${botname}" -X quit 2>/dev/null || true
done

echo ""
echo "Sentinel service removed."
echo "Bot data preserved at: ${SENTINEL_DIR}/"
echo "  To fully remove: rm -rf ${SENTINEL_DIR}/"
echo "  Channel configs: ~/.claude/channels/discord-*/"
