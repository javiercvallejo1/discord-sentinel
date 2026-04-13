#!/bin/bash
#
# Discord Approval Hook for Claude Code
#
# PreToolUse hook that sends dangerous commands to Discord for approval.
# The user reacts with thumbs up to approve or thumbs down to reject.
#
# Environment variables (set in spawn wrapper when approval is enabled):
#   DISCORD_APPROVE_BOT_TOKEN  — Bot token for sending messages
#   DISCORD_APPROVE_CHANNEL_ID — DM channel ID to send approval requests to
#   DISCORD_APPROVE_USER_ID    — Your Discord user ID (for checking reactions)
#   DISCORD_APPROVE_TIMEOUT    — Timeout in seconds (default: 120)
#
# Exit codes:
#   0 = approved (tool runs)
#   2 = rejected or timed out (tool blocked, feedback sent to Claude)

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
BOT_TOKEN="${DISCORD_APPROVE_BOT_TOKEN:-}"
CHANNEL_ID="${DISCORD_APPROVE_CHANNEL_ID:-}"
USER_ID="${DISCORD_APPROVE_USER_ID:-}"
TIMEOUT="${DISCORD_APPROVE_TIMEOUT:-120}"
POLL_INTERVAL=3

if [ -z "$BOT_TOKEN" ] || [ -z "$CHANNEL_ID" ] || [ -z "$USER_ID" ]; then
  exit 0
fi

# ── Read hook input from stdin ──────────────────────────────────────────────
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // "{}"')

# ── Define which tools need approval ────────────────────────────────────────
NEEDS_APPROVAL=false

case "$TOOL_NAME" in
  Bash)
    CMD=$(echo "$TOOL_INPUT" | jq -r '.command // ""')
    if echo "$CMD" | grep -qiE '(git push|git reset --hard|rm -rf|drop table|delete from|force|--no-verify|shutdown|reboot)'; then
      NEEDS_APPROVAL=true
    fi
    ;;
  Write)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path // ""')
    if echo "$FILE" | grep -qiE '(\.env|credentials|settings\.json|\.ssh|\.gitignore)'; then
      NEEDS_APPROVAL=true
    fi
    ;;
esac

if [ "$NEEDS_APPROVAL" != "true" ]; then
  exit 0
fi

# ── Format the approval message ─────────────────────────────────────────────
case "$TOOL_NAME" in
  Bash)
    CMD=$(echo "$TOOL_INPUT" | jq -r '.command // ""')
    if [ ${#CMD} -gt 500 ]; then
      CMD="${CMD:0:500}..."
    fi
    DISPLAY="**Tool:** \`Bash\`\n**Command:**\n\`\`\`\n${CMD}\n\`\`\`"
    ;;
  Write)
    FILE=$(echo "$TOOL_INPUT" | jq -r '.file_path // ""')
    DISPLAY="**Tool:** \`Write\`\n**File:** \`${FILE}\`"
    ;;
  *)
    DISPLAY="**Tool:** \`${TOOL_NAME}\`"
    ;;
esac

MESSAGE_BODY=$(cat <<EOF
{
  "content": "**Approval Required**\n\n${DISPLAY}\n\nReact thumbs up to **approve** or thumbs down to **reject**\nAuto-rejects in ${TIMEOUT}s"
}
EOF
)

# ── Send the approval request ───────────────────────────────────────────────
API="https://discord.com/api/v10"
AUTH="Authorization: Bot ${BOT_TOKEN}"

RESPONSE=$(curl -s -X POST "${API}/channels/${CHANNEL_ID}/messages" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d "$MESSAGE_BODY")

MESSAGE_ID=$(echo "$RESPONSE" | jq -r '.id // ""')

if [ -z "$MESSAGE_ID" ] || [ "$MESSAGE_ID" = "null" ]; then
  echo "Discord approval hook: failed to send message, auto-approving"
  exit 0
fi

# ── Add reaction options ────────────────────────────────────────────────────
curl -s -X PUT "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/%F0%9F%91%8D/@me" \
  -H "$AUTH" -H "Content-Length: 0" > /dev/null 2>&1

curl -s -X PUT "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/%F0%9F%91%8E/@me" \
  -H "$AUTH" -H "Content-Length: 0" > /dev/null 2>&1

# ── Poll for user reaction ──────────────────────────────────────────────────
ELAPSED=0

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  THUMBS_UP=$(curl -s "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/%F0%9F%91%8D" \
    -H "$AUTH" 2>/dev/null)

  if echo "$THUMBS_UP" | jq -e ".[] | select(.id == \"${USER_ID}\")" > /dev/null 2>&1; then
    curl -s -X PATCH "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d "{\"content\": \"**Approved**\n\n${DISPLAY}\"}" > /dev/null 2>&1
    exit 0
  fi

  THUMBS_DOWN=$(curl -s "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/%F0%9F%91%8E" \
    -H "$AUTH" 2>/dev/null)

  if echo "$THUMBS_DOWN" | jq -e ".[] | select(.id == \"${USER_ID}\")" > /dev/null 2>&1; then
    curl -s -X PATCH "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d "{\"content\": \"**Rejected**\n\n${DISPLAY}\"}" > /dev/null 2>&1
    echo "Command rejected by user via Discord"
    exit 2
  fi
done

curl -s -X PATCH "${API}/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"content\": \"**Timed out** (${TIMEOUT}s)\n\n${DISPLAY}\"}" > /dev/null 2>&1

echo "Approval timed out after ${TIMEOUT}s"
exit 2
