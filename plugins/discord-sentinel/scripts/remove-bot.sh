#!/bin/bash
#
# remove-bot — Remove a Discord bot from the sentinel pool.
#
# Usage:
#   remove-bot <name>
#
# Removes from bots.json. Sentinel hot-reloads and disconnects.
# Does NOT delete the channel config directory or Discord bot.

set -euo pipefail

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
BOTS_FILE="${SENTINEL_DIR}/bots.json"

if [ $# -lt 1 ]; then
  echo "Usage: remove-bot <name>"
  echo ""
  echo "Current bots:"
  jq -r 'to_entries[] | select(.key != "_config") | "  \(.key) — \(.value.label)"' "$BOTS_FILE" 2>/dev/null || echo "  (none)"
  exit 1
fi

NAME="$1"

if ! jq -e ".\"$NAME\"" "$BOTS_FILE" >/dev/null 2>&1; then
  echo "Bot '$NAME' not found in pool."
  exit 1
fi

# Kill active session if any
LOCK="${SENTINEL_DIR}/locks/${NAME}.lock"
if [ -f "$LOCK" ]; then
  PID=$(cat "$LOCK")
  kill "$PID" 2>/dev/null || true
  rm -f "$LOCK"
  screen -S "claude-${NAME}" -X quit 2>/dev/null || true
  echo "Killed active session for '$NAME'."
fi

jq --arg name "$NAME" 'del(.[$name])' "$BOTS_FILE" > "${BOTS_FILE}.tmp" \
  && mv "${BOTS_FILE}.tmp" "$BOTS_FILE"

echo "Removed '$NAME' from pool. Sentinel will disconnect within seconds."
echo "Channel config at ~/.claude/channels/discord-${NAME}/ was kept (delete manually if needed)."
