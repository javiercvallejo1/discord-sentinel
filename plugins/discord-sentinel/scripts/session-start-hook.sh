#!/bin/bash
#
# session-start-hook.sh — Injects bot personality on session start.
#
# Reads the bot's personality file and outputs it to stdout so Claude
# receives it as session context. Always uses stdout injection — this
# works reliably regardless of whether the remember plugin is installed.

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
PERSONALITIES_DIR="${SENTINEL_DIR}/personalities"
BOTS_FILE="${SENTINEL_DIR}/bots.json"

# Resolve bot name
BOT_NAME="${DISCORD_BOT_NAME:-}"

if [ -z "$BOT_NAME" ]; then
  # Try to resolve from token via bots.json
  TOKEN="${DISCORD_BOT_TOKEN:-}"

  if [ -n "$TOKEN" ] && [ -f "$BOTS_FILE" ]; then
    BOT_NAME=$(jq -r --arg tok "$TOKEN" 'to_entries[] | select(.key != "_config") | select(.value.token == $tok) | .key' "$BOTS_FILE" 2>/dev/null | head -1)
  fi
fi

# No bot name = not a sentinel-managed session, skip
if [ -z "$BOT_NAME" ]; then
  exit 0
fi

PERSONALITY_FILE="${PERSONALITIES_DIR}/${BOT_NAME}.md"

# No personality file = nothing to inject
if [ ! -f "$PERSONALITY_FILE" ]; then
  exit 0
fi

# Inject personality directly via stdout into session context
echo "=== BOT IDENTITY ==="
echo ""
cat "$PERSONALITY_FILE"
echo ""
echo "=== END BOT IDENTITY ==="
