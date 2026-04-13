#!/bin/bash
#
# session-start-hook.sh — Injects bot personality on session start.
#
# Reads the bot's personality file and outputs it to stdout so Claude
# receives it as session context. If the remember plugin is installed,
# copies the personality to remember's identity.md location instead.

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
PERSONALITIES_DIR="${SENTINEL_DIR}/personalities"

# Resolve bot name
BOT_NAME="${DISCORD_BOT_NAME:-}"

if [ -z "$BOT_NAME" ]; then
  # Try to resolve from token via bots.json
  BOTS_FILE="${SENTINEL_DIR}/bots.json"
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

# Check if remember plugin is installed
REMEMBER_IDENTITY=""
if [ -d "${HOME}/.claude/plugins" ]; then
  # Look for remember plugin in cache
  REMEMBER_DIR=$(find "${HOME}/.claude/plugins/cache" -maxdepth 3 -name "remember" -type d 2>/dev/null | head -1)
  if [ -n "$REMEMBER_DIR" ]; then
    # Remember plugin found — copy personality as identity.md
    REMEMBER_IDENTITY_DIR="${PWD}/.claude/remember"
    mkdir -p "$REMEMBER_IDENTITY_DIR"
    cp "$PERSONALITY_FILE" "${REMEMBER_IDENTITY_DIR}/identity.md"
    exit 0
  fi
fi

# No remember plugin — inject personality directly via stdout
echo "=== BOT IDENTITY ==="
echo ""
cat "$PERSONALITY_FILE"
echo ""
echo "=== END BOT IDENTITY ==="
