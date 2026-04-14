#!/bin/bash
#
# session-start-hook.sh — Injects bot personality and ready instruction on session start.
#
# Reads the bot's personality file and outputs it to stdout so Claude
# receives it as session context. Also instructs Claude to send a ready
# message so the user knows the session is live.

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

# Inject personality if available
if [ -f "$PERSONALITY_FILE" ]; then
  echo "=== BOT IDENTITY ==="
  echo ""
  cat "$PERSONALITY_FILE"
  echo ""
  echo "=== END BOT IDENTITY ==="
  echo ""
fi

# Instruct Claude to send a ready message via Discord
echo "=== SESSION INSTRUCTIONS ==="
echo "You are running as a Discord bot named '${BOT_NAME}'. A user just DM'd you to start this session."
echo "Send a short ready message to let them know you're online and ready. Keep it brief — one or two sentences, in character with your identity above."
echo "=== END SESSION INSTRUCTIONS ==="
