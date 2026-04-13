---
name: install
description: Set up the Discord Sentinel daemon, launchd service, and optionally install the remember plugin for bot memory
allowed_tools: ["Bash", "Read", "Write"]
---

# Discord Sentinel — Setup Wizard

Guide the user through setting up the Discord Sentinel system. Follow these steps in order:

## Step 1: Check prerequisites

Run these checks:
- `which bun` — bun runtime is required
- `which claude` — Claude CLI must be installed
- `which jq` — jq is needed for bot management
- `which screen` — screen is needed for session spawning

If any are missing, tell the user how to install them and stop.

## Step 2: Check for remember plugin

Check if the remember plugin is installed:
```bash
ls ~/.claude/plugins/cache/*/remember 2>/dev/null
```

If NOT installed, ask the user:
> "The **remember** plugin gives your bots persistent memory across sessions — they'll accumulate context and remember past conversations. Want me to install it? (Recommended)"

If yes: `claude plugins add remember@claude-plugins-official` (or guide them)
If no: proceed without it. Bots will still get personality but won't accumulate memory.

## Step 3: Install the daemon

Run the install script:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-daemon.sh" "${CLAUDE_PLUGIN_ROOT}"
```

This copies sentinel files to `~/.claude/discord-sentinel/`, installs dependencies, generates a launchd plist, and starts the service.

## Step 4: Configure owner

Ask the user for their Discord user ID:
> "What's your Discord user ID? (Enable Developer Mode in Discord → right-click your name → Copy User ID)"

Then update bots.json:
```bash
jq --arg id "<USER_ID>" '._config.owner_id = $id' ~/.claude/discord-sentinel/bots.json > /tmp/bots.tmp && mv /tmp/bots.tmp ~/.claude/discord-sentinel/bots.json
```

Also set the default project directory (suggest the current working directory).

## Step 5: Add first bot

Ask: "Do you want to add your first bot now?"

If yes, guide them to run `/add-bot` with their bot name and token.

## Done

Tell the user:
- Sentinel is running and will auto-start on login
- Use `/add-bot` to register Discord bots
- Use `/sentinel status` to check the daemon
- Use `/bots` to see registered bots
