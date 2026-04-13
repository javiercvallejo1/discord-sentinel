# Discord Sentinel

A Claude Code plugin that manages a pool of Discord bots as gateways to Claude Code sessions. DM any bot to start a session — when you're done, the bot goes back to idle and is ready for the next conversation.

## Features

- **Bot pool management** — register multiple Discord bots, each tied to a project
- **Auto-spawn sessions** — DM an idle bot to start a Claude Code session
- **Auto-reconnect** — when a session ends, the bot returns to idle within seconds
- **Per-bot personality** — each bot gets its own identity and communication style
- **Memory integration** — works with the [remember](https://github.com/claude-plugins-official/remember) plugin for persistent cross-session memory
- **Approval hook** — dangerous commands (git push, rm -rf) sent to Discord for approval
- **Always-on** — launchd service keeps bots online even when no session is active

## Prerequisites

- macOS
- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) CLI
- Discord bot token(s) from the [Discord Developer Portal](https://discord.com/developers/applications)

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
5. Guide you through adding your first bot

## Usage

### Add a bot

```
/add-bot my-bot MTIzNDU2Nzg5...
```

The wizard asks for:
- Project directory (where the bot works)
- Personality description (refined into an identity file)
- Whether to enable the approval hook

### Manage bots

```
/bots              # List all bots and their status
/remove-bot name   # Unregister a bot
/configure         # Change settings, personalities, etc.
```

### Manage the daemon

```
/sentinel status   # Check if sentinel is running
/sentinel start    # Start the daemon
/sentinel stop     # Stop the daemon
/sentinel logs     # View recent logs
```

## How It Works

```
You (Discord DM) → Bot (idle) → Sentinel spawns Claude session
                                 Bot disconnects from gateway
                                 Claude takes over bot's Discord connection
                                 You chat with Claude through the bot

Session ends → Sentinel detects dead PID → Bot reconnects → Back to idle
```

The sentinel daemon runs as a macOS LaunchAgent, keeping bots online 24/7. When you DM a bot, it spawns a Claude Code session in a detached `screen` that takes over the bot's Discord gateway connection. When the session ends (naturally or via timeout), the sentinel reclaims the gateway and the bot returns to idle mode.

## File Locations

| What | Where |
|------|-------|
| Bot registry | `~/.claude/discord-sentinel/bots.json` |
| Personalities | `~/.claude/discord-sentinel/personalities/` |
| Session locks | `~/.claude/discord-sentinel/locks/` |
| Logs | `~/.claude/discord-sentinel/logs/` |
| Channel configs | `~/.claude/channels/discord-<botname>/` |
| LaunchAgent | `~/Library/LaunchAgents/com.claude.discord-sentinel.plist` |

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
