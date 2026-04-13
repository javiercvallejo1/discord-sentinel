---
name: bots
description: List all registered bots and their current status
allowed_tools: ["Bash", "Read"]
---

# List Bots

Show all registered bots with their status, project, and personality.

## Gather info

Read the bot registry:
```bash
cat ~/.claude/discord-sentinel/bots.json
```

For each bot (excluding `_config`), determine status:
1. Check if lock file exists: `~/.claude/discord-sentinel/locks/<name>.lock`
2. If lock exists, check if PID is alive: `kill -0 <pid> 2>/dev/null`
3. Check if personality file exists: `~/.claude/discord-sentinel/personalities/<name>.md`

## Display

Show a table or list with:
- **Name** — bot identifier
- **Label** — display name
- **Status** — idle / active (PID) / offline
- **Project** — working directory (or "default")
- **Personality** — yes/no (with file path if yes)

Check if sentinel service is running:
```bash
launchctl list com.claude.discord-sentinel 2>/dev/null && echo "Sentinel: running" || echo "Sentinel: stopped"
```
