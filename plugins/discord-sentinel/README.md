# Discord Sentinel

A Claude Code plugin that manages a pool of Discord bots as gateways to Claude Code sessions. DM any bot to start a session — when you're done, the bot goes back to idle and is ready for the next conversation.

## Features

- **Bot pool management** — register multiple Discord bots, each tied to a project
- **Auto-spawn sessions** — DM an idle bot to start a Claude Code session
- **Auto-reconnect** — when a session ends, the bot returns to idle within seconds
- **Per-bot personality** — each bot gets its own identity and communication style
- **Session persistence** — sessions resume where they left off via `--continue`
- **Memory integration** — works with the [remember](https://github.com/Digital-Process-Tools/claude-remember) plugin for persistent cross-session memory
- **Approval hook** — dangerous commands (git push, rm -rf) sent to Discord for approval
- **Health notifications** — get a DM when sentinel starts or recovers from a crash
- **Always-on** — launchd (macOS) or systemd (Linux) keeps bots online even when no session is active

## Prerequisites

### macOS
- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [Claude Code](https://claude.ai/code) CLI
- `jq` and `screen` (`brew install jq screen`)

### Linux (systemd-based distros: Ubuntu, Debian, Fedora, Arch, etc.)
- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [Claude Code](https://claude.ai/code) CLI
- `jq` and `screen`:
  - Ubuntu/Debian: `sudo apt install jq screen`
  - Fedora/RHEL: `sudo dnf install jq screen`
  - Arch: `sudo pacman -S jq screen`
- systemd with user service support (default on all major distros)

### Windows
Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with any supported Linux distribution and follow the Linux instructions inside WSL.

## Create a Discord Bot

Before installing, you need a Discord bot. You can create as many as you want — each becomes a separate Claude Code gateway.

### Step 1: Create the application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Give it a name — this becomes the bot's display name in Discord (e.g., "My Assistant", "Data Bot")
4. Click **Create**

### Step 2: Configure the bot

1. Go to the **Bot** tab in the left sidebar
2. Click **Reset Token** and **copy the token** — you'll need it during setup. Store it somewhere safe; you can't see it again.
3. Under **Authorization Flow**:
   - **Public Bot** — turn OFF if you don't want others to add your bot to their servers
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** — **required**. Without this, the bot connects but can't read DM messages. The bot will appear online but never respond.

### Step 3: Set up OAuth2 and invite the bot

1. Go to the **OAuth2** tab in the left sidebar
2. Under **OAuth2 URL Generator**:
   - **Scopes**: select `bot`
   - **Bot Permissions**: select the following:
     - `Send Messages`
     - `Read Message History`
     - `Add Reactions` (needed for the approval hook)
     - `Use External Emojis` (optional, for richer responses)
3. Copy the **Generated URL** at the bottom
4. Open the URL in your browser
5. Select the server where you want to add the bot and click **Authorize**

### Step 4: Enable DMs

For the bot to receive your DMs, you and the bot must **share at least one server**. That's it — once the bot is in a server you're in, you can DM it directly.

If DMs don't work, check your Discord settings:
- **User Settings** > **Privacy & Safety** > **Server Privacy Defaults** > make sure "Allow direct messages from server members" is enabled for the shared server.

### Repeat for additional bots

Each bot needs its own application in the Developer Portal. You can create as many as you need — one per project, one per role, etc. Each gets its own token, personality, and project directory.

## Install

**Step 1 — Add the marketplace:**

```bash
claude plugin marketplace add javiercvallejo1/discord-sentinel
```

**Step 2 — Install the plugin:**

```bash
claude plugin install discord-sentinel
```

**Step 3 — Run the setup wizard** (inside a Claude Code session):

```
/install
```

The wizard will:
1. Check prerequisites (bun, claude, jq, screen)
2. Optionally install the [remember](https://github.com/Digital-Process-Tools/claude-remember) plugin for persistent bot memory
3. Install the sentinel daemon to `~/.claude/discord-sentinel/`
4. Set up the macOS launchd service (auto-starts on login)
5. Configure your Discord user ID and default project
6. Guide you through adding your first bot with personality

**Step 4 — DM the bot** on Discord to start your first session

### Getting your Discord User ID

The setup wizard will ask for your Discord user ID. To find it:
1. Open Discord
2. Go to **User Settings** (gear icon) > **Advanced** > enable **Developer Mode**
3. Close settings, right-click your own name in any chat
4. Click **Copy User ID**

## Usage

### Add a bot

```
/add-bot my-bot MTIzNDU2Nzg5...
```

The wizard asks for:
- **Project directory** — where the bot works (the bot `cd`s here on session start)
- **Personality description** — you describe the bot's role and tone, Claude refines it into an identity file
- **Approval hook** — optional, sends dangerous commands to Discord for your approval before executing

### Manage bots

```
/bots              # List all bots and their status
/remove-bot name   # Unregister a bot
/configure         # Change settings, personalities, etc.
```

### Manage the daemon

```
/sentinel status   # Check if sentinel is running + bot statuses
/sentinel start    # Start the daemon
/sentinel stop     # Stop the daemon
/sentinel logs     # View recent logs
```

### Update after plugin changes

```
/update            # Copies latest plugin files to daemon, restarts
```

## How It Works

```
You (Discord DM) → Bot (idle) → Sentinel disconnects from gateway
                                 Spawns Claude session in screen
                                 Claude's discord plugin connects
                                 Bot shows "online"
                                 You chat with Claude through the bot

Session ends → Sentinel detects dead PID → Reconnects → Bot shows "idle"
```

The sentinel daemon runs as a service — launchd on macOS, systemd user service on Linux — keeping bots online 24/7. When you DM a bot:

1. Sentinel receives the DM via the Discord gateway
2. Replies "Starting session..." and disconnects from the gateway
3. Spawns a Claude Code session in a detached `screen`
4. Claude's discord plugin connects to the gateway with the same token
5. The bot switches from "idle" to "online"
6. You chat with Claude through Discord DMs

When the session ends (naturally, via timeout, or killed):
1. Sentinel's lock monitor detects the dead process within 3 seconds
2. Reconnects to the gateway
3. Bot switches back to "idle", ready for the next DM

Sessions resume where they left off (`--continue` flag). If the [remember](https://github.com/Digital-Process-Tools/claude-remember) plugin is installed, bots also accumulate compressed memory across sessions.

## File Locations

| What | Where |
|------|-------|
| Bot registry | `~/.claude/discord-sentinel/bots.json` |
| Personalities | `~/.claude/discord-sentinel/personalities/` |
| Session locks | `~/.claude/discord-sentinel/locks/` |
| Logs | `~/.claude/discord-sentinel/logs/` |
| Channel configs | `~/.claude/channels/discord-<botname>/` |
| Service (macOS) | `~/Library/LaunchAgents/com.claude.discord-sentinel.plist` |
| Service (Linux) | `~/.config/systemd/user/claude-discord-sentinel.service` |

## Troubleshooting

**Bot is online but doesn't respond to DMs:**
- Check that **Message Content Intent** is enabled in the Discord Developer Portal (Bot tab > Privileged Gateway Intents)
- Make sure you and the bot share at least one server
- Check sentinel logs: `/sentinel logs`

**Bot stays "idle" during active sessions:**
- The discord plugin needs time to connect after spawn. Wait a few seconds.
- Check that the Claude session started: `screen -ls | grep claude`

**Session doesn't start:**
- Check prerequisites: `which bun && which screen && which jq`
- Check sentinel logs for spawn errors: `/sentinel logs`
- Make sure the project directory exists and is accessible

**Approval hook doesn't prompt:**
- Verify `approval_channel` is set in `bots.json` for the bot
- The approval env vars are set in the spawn wrapper — check `~/.claude/discord-sentinel/locks/spawn-<botname>.sh`

## Uninstall

```
/sentinel stop
```

```bash
# Remove launchd service and daemon files
~/.claude/discord-sentinel/uninstall

# Remove the plugin and marketplace
claude plugin uninstall discord-sentinel
claude plugin marketplace remove discord-sentinel
```

To also remove all bot data:
```bash
rm -rf ~/.claude/discord-sentinel
rm -rf ~/.claude/channels/discord-*
```
