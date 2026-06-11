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

## Step 2: Check for plugins

### Discord channel plugin (required)

Check if the discord channel plugin is installed:
```bash
claude plugins list 2>/dev/null | grep -q 'discord@claude-plugins-official' && echo "installed" || echo "missing"
```

If NOT installed, install it — **this plugin is required** for bots to send and receive Discord messages:
```bash
claude plugins install discord@claude-plugins-official
```

The install script (Step 3) will also do this automatically, but surfacing it here makes the dependency explicit.

### Remember plugin (optional)

Check if the remember plugin is installed:
```bash
ls ~/.claude/plugins/cache/*/remember 2>/dev/null
```

If NOT installed, ask the user:
> "The **remember** plugin gives your bots persistent memory across sessions — they'll accumulate context and remember past conversations. Want me to install it? (Recommended)"

If yes: `claude plugins install remember@claude-plugins-official`
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

Also ask for their default project directory (suggest the current working directory).

Then update bots.json with both values:
```bash
jq --arg id "<USER_ID>" --arg project "<PROJECT_DIR>" '._config.owner_id = $id | ._config.default_project = $project' ~/.claude/discord-sentinel/bots.json > /tmp/bots.tmp && mv /tmp/bots.tmp ~/.claude/discord-sentinel/bots.json
```

## Step 5: Add first bot

Ask: "Do you want to add your first bot now?"

If yes, guide them to run `/add-bot` with their bot name and token.

## Done

Tell the user:
- Sentinel is running and will auto-start on login
- Use `/add-bot` to register Discord bots
- Use `/sentinel status` to check the daemon
- Use `/bots` to see registered bots
