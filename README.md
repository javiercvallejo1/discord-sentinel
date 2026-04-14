# Discord Sentinel

A [Claude Code](https://claude.ai/code) plugin that turns Discord bots into gateways for Claude Code sessions. DM a bot to start a session — when you're done, it goes back to idle and waits for the next conversation.

## What it does

- **Always-on Discord presence** — a background daemon keeps your bots online 24/7
- **DM to start** — message any idle bot to spawn a Claude Code session
- **Per-bot personality** — each bot has its own identity, tone, and domain knowledge
- **Session persistence** — sessions resume where they left off
- **Memory** — integrates with the [remember](https://github.com/Digital-Process-Tools/claude-remember) plugin for cross-session memory
- **Remote safety** — optional approval hook sends dangerous commands to Discord for your thumbs up/down before executing
- **Health alerts** — get a DM when the daemon starts or recovers from a crash

## Quick start

```bash
# 1. Add the marketplace
claude plugin marketplace add javiercvallejo1/discord-sentinel

# 2. Install the plugin
claude plugin install discord-sentinel

# 3. Run the setup wizard (inside a Claude Code session)
/install
```

You'll need a Discord bot token first — see the [full setup guide](plugins/discord-sentinel/README.md#create-a-discord-bot).

## How it works

```
You (Discord DM) → Bot (idle) → Sentinel spawns Claude session
                                 Claude takes over the bot's connection
                                 You chat with Claude through Discord

Session ends → Sentinel reclaims the bot → Back to idle
```

The sentinel daemon runs as a macOS LaunchAgent. It manages a pool of Discord bots from a registry (`bots.json`). Each bot can be tied to a different project directory and have its own personality. When a session ends — naturally, via timeout, or killed — the sentinel detects it within 3 seconds and puts the bot back online.

## Documentation

Full documentation including Discord bot setup, permissions, troubleshooting, and all available commands is in the [plugin README](plugins/discord-sentinel/README.md).

## Repository structure

```
discord-sentinel/
├── .claude-plugin/
│   ├── marketplace.json        # Claude Code marketplace manifest
│   └── plugin.json             # Plugin metadata
└── plugins/discord-sentinel/
    ├── README.md               # Full documentation
    ├── sentinel/
    │   └── sentinel.ts         # Daemon: bot pool, gateway, session spawn
    ├── scripts/
    │   ├── session-start-hook.sh    # Personality + ready message injection
    │   ├── discord-approve.sh       # Approval hook for dangerous commands
    │   ├── install-daemon.sh        # Installs daemon + launchd service
    │   ├── add-bot.sh / remove-bot.sh
    │   └── uninstall-daemon.sh
    ├── commands/                # Plugin commands (/install, /add-bot, etc.)
    ├── hooks/hooks.json         # SessionStart + PreToolUse hooks
    ├── skills/configure.md      # Interactive reconfiguration
    └── templates/               # LaunchAgent plist template
```

## Contributing

This repo uses branch protection. All changes go through pull requests:

```bash
git checkout -b feature/my-change
# make changes
git push -u origin feature/my-change
gh pr create
```

Requires 1 approving review before merge.

## License

MIT
