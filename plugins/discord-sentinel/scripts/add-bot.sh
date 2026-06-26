#!/bin/bash
#
# add-bot — Register a new Discord bot in the sentinel pool.
#
# Usage:
#   add-bot <name> <token> [project-dir] [model]
#
# Adds the bot to bots.json (sentinel hot-reloads via file watcher).
# Channel config is auto-provisioned by the sentinel.

set -euo pipefail

SENTINEL_DIR="${HOME}/.claude/discord-sentinel"
BOTS_FILE="${SENTINEL_DIR}/bots.json"

if [ $# -lt 2 ]; then
  echo "Usage: add-bot <name> <token> [project-dir] [model]"
  echo ""
  echo "  name        Bot identifier (e.g., agent-3). Used for screen sessions and locks."
  echo "  token       Discord bot token from Developer Portal."
  echo "  project-dir Optional project directory. Falls back to _config.default_project."
  echo "  model       Optional Claude model (e.g. sonnet, opus, claude-fable-5)."
  echo "              Omit to inherit from ~/.claude/settings.json."
  echo ""
  echo "Current bots:"
  jq -r 'to_entries[] | select(.key != "_config") | "  \(.key) — \(.value.label)"' "$BOTS_FILE" 2>/dev/null || echo "  (none)"
  exit 1
fi

NAME="$1"
TOKEN="$2"
PROJECT="${3:-}"
MODEL="${4:-}"
LABEL="${NAME}"

# Validate name — alphanumeric, hyphens, and underscores only (no shell metacharacters)
if [[ ! "$NAME" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
  echo "Error: bot name must start with a letter and contain only letters, numbers, hyphens, or underscores"
  exit 1
fi
if [[ "$NAME" == _* ]]; then
  echo "Error: bot name cannot start with underscore (reserved for config)"
  exit 1
fi

# Check if bot already exists
if jq -e ".\"$NAME\"" "$BOTS_FILE" >/dev/null 2>&1; then
  echo "Bot '$NAME' already exists. Remove it first or choose a different name."
  exit 1
fi

# Create project directory if specified and missing
if [ -n "$PROJECT" ] && [ ! -d "$PROJECT" ]; then
  echo "Project directory $PROJECT does not exist — creating it."
  mkdir -p "$PROJECT" || { echo "Error: could not create $PROJECT" >&2; exit 1; }
fi

# Build the new bot entry
ENTRY=$(jq -n \
  --arg token "$TOKEN" \
  --arg label "$LABEL" \
  --arg project "$PROJECT" \
  --arg model "$MODEL" \
  '{token: $token, label: $label}
   + (if $project != "" then {project: $project} else {} end)
   + (if $model   != "" then {model: $model}     else {} end)')

# Add to bots.json (sentinel watches this file and hot-reloads)
jq --arg name "$NAME" --argjson entry "$ENTRY" '.[$name] = $entry' "$BOTS_FILE" > "${BOTS_FILE}.tmp" \
  && mv "${BOTS_FILE}.tmp" "$BOTS_FILE"

echo "Added bot '$NAME' to pool."
echo "Sentinel will auto-provision channel config and connect within seconds."
