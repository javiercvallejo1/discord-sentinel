#!/bin/bash
#
# sentinel-lock.sh — Manages sentinel lock files for Claude Code sessions.
#
# Called by Claude Code hooks (SessionStart / Stop) to signal the sentinel
# that a live session owns a bot's gateway connection.

set -euo pipefail

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
LOCKS_DIR="${SENTINEL_DIR}/locks"
BOTS_FILE="${SENTINEL_DIR}/bots.json"

resolve_bot_name() {
  # Prefer DISCORD_BOT_NAME (set by sentinel spawn wrapper)
  if [ -n "${DISCORD_BOT_NAME:-}" ]; then
    echo "$DISCORD_BOT_NAME"
    return 0
  fi

  # Fallback: match token against bots.json
  local token=""

  if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
    token="$DISCORD_BOT_TOKEN"
  else
    local state_dir="${DISCORD_STATE_DIR:-${HOME}/.claude/channels/discord}"
    local env_file="${state_dir}/.env"
    [ -f "$env_file" ] || return 1
    token=$(grep '^DISCORD_BOT_TOKEN=' "$env_file" | cut -d= -f2-)
  fi

  [ -n "$token" ] || return 1
  [ -f "$BOTS_FILE" ] || return 1

  local bot_name
  bot_name=$(jq -r --arg tok "$token" 'to_entries[] | select(.key != "_config") | select(.value.token == $tok) | .key' "$BOTS_FILE" 2>/dev/null | head -1)
  [ -n "$bot_name" ] || return 1

  echo "$bot_name"
}

ACTION="${1:-}"
BOT_NAME=$(resolve_bot_name 2>/dev/null || true)

if [ -z "$BOT_NAME" ]; then
  exit 0
fi

case "$ACTION" in
  create)
    mkdir -p "$LOCKS_DIR"
    echo "$PPID" > "${LOCKS_DIR}/${BOT_NAME}.lock"
    ;;
  remove)
    rm -f "${LOCKS_DIR}/${BOT_NAME}.lock"
    ;;
  *)
    echo "Usage: sentinel-lock.sh create|remove" >&2
    exit 1
    ;;
esac
