#!/bin/bash
#
# session-start-hook.sh — Injects bot personality and session instructions on start.
#
# If a personality file exists, injects it. If not, instructs Claude to ask
# the user for one and save it (first-run personality setup via DM).
#
# Always emits a one-line marker to ${SENTINEL_DIR}/logs/hook.log on every
# invocation, regardless of whether the bot is identifiable or the manifest is
# loaded. Without that, silent failures (no DISCORD_BOT_NAME, no manifest, no
# anything) leave zero post-mortem signal — see github issue tracker for the
# real-world incident that prompted this.

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
PERSONALITIES_DIR="${SENTINEL_DIR}/personalities"
BOTS_FILE="${SENTINEL_DIR}/bots.json"
LOG_FILE="${SENTINEL_DIR}/logs/hook.log"

mkdir -p "${SENTINEL_DIR}/logs" 2>/dev/null

# Marker logger — one line per invocation. Format keeps it greppable:
#   2026-05-01T01:30:00Z hook=session-start bot=<name|unset> personality=<path|none> action=<inject|first-run|skip-no-bot|skip-resume>
hooklog() {
  printf '%sZ hook=session-start bot=%s personality=%s action=%s\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%S')" \
    "${1:-unset}" "${2:-none}" "${3:-unknown}" \
    >> "$LOG_FILE" 2>/dev/null || true
}

# Resolve bot name
BOT_NAME="${DISCORD_BOT_NAME:-}"

if [ -z "$BOT_NAME" ]; then
  TOKEN="${DISCORD_BOT_TOKEN:-}"
  if [ -n "$TOKEN" ] && [ -f "$BOTS_FILE" ]; then
    BOT_NAME=$(jq -r --arg tok "$TOKEN" 'to_entries[] | select(.key != "_config") | select(.value.token == $tok) | .key' "$BOTS_FILE" 2>/dev/null | head -1)
  fi
fi

# No bot name = not a sentinel-managed session, skip (but still log)
if [ -z "$BOT_NAME" ]; then
  hooklog "" "" "skip-no-bot"
  exit 0
fi

PERSONALITY_FILE="${PERSONALITIES_DIR}/${BOT_NAME}.md"

if [ -f "$PERSONALITY_FILE" ]; then
  hooklog "$BOT_NAME" "$PERSONALITY_FILE" "inject"
  # Personality exists — inject it
  echo "=== BOT IDENTITY ==="
  echo ""
  cat "$PERSONALITY_FILE"
  echo ""
  echo "=== END BOT IDENTITY ==="
  echo ""
  echo "=== SESSION INSTRUCTIONS ==="
  echo "You are running as a Discord bot named '${BOT_NAME}'. A user just DM'd you to start this session."
  echo "Send a short ready message to let them know you're online and ready. Keep it brief — one or two sentences, in character with your identity above."
  echo ""
  echo "IMPORTANT: If the user sends '/sleep', immediately reply with a short goodbye message in character, then exit the session by running: kill \$PPID"
  echo "This gracefully ends the session so the sentinel can reclaim the bot."
  echo "=== END SESSION INSTRUCTIONS ==="
else
  hooklog "$BOT_NAME" "$PERSONALITY_FILE" "first-run"
  # No personality — first-run setup
  echo "=== SESSION INSTRUCTIONS ==="
  echo "You are running as a Discord bot named '${BOT_NAME}'. This is your FIRST session — you don't have a personality configured yet."
  echo ""
  echo "Your first task: ask the user to describe who you should be. Ask something like:"
  echo "\"Hey! I'm brand new and don't have a personality yet. Can you describe who I should be? Tell me about my role, expertise, tone, and any preferences.\""
  echo ""
  echo "Once the user describes you, create a well-structured identity document and save it to:"
  echo "${PERSONALITY_FILE}"
  echo ""
  echo "The identity file should include:"
  echo "- Who you are (role, name, expertise)"
  echo "- Communication style (tone, verbosity, formality)"
  echo "- Domain knowledge (technologies, projects, context)"
  echo "- Behavioral guidelines (what to do and not do)"
  echo ""
  echo "After saving, confirm to the user and then continue the session in character."
  echo ""
  echo "IMPORTANT: If the user sends '/sleep', immediately reply with a short goodbye message, then exit the session by running: kill \$PPID"
  echo "This gracefully ends the session so the sentinel can reclaim the bot."
  echo "=== END SESSION INSTRUCTIONS ==="
fi
