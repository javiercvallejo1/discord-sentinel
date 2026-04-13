---
name: remove-bot
description: Unregister a Discord bot from the sentinel pool
allowed_tools: ["Bash", "Read"]
args: "<name>"
---

# Remove Bot from Sentinel Pool

## Step 1: Validate

If no name provided, list current bots and ask which to remove:
```bash
jq -r 'to_entries[] | select(.key != "_config") | "\(.key) — \(.value.label)"' ~/.claude/discord-sentinel/bots.json
```

Check the bot exists in `~/.claude/discord-sentinel/bots.json`.

## Step 2: Confirm

Show the bot's details and ask for confirmation:
> "Remove bot **<name>** (<label>)? This will disconnect it and kill any active session. Personality file and channel config will be preserved."

## Step 3: Remove

```bash
~/.claude/discord-sentinel/remove-bot "<name>"
```

## Step 4: Optional cleanup

Ask if they want to also remove:
- Personality file: `~/.claude/discord-sentinel/personalities/<name>.md`
- Channel config: `~/.claude/channels/discord-<name>/`
