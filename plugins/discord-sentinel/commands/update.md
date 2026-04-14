---
name: update
description: Update the sentinel daemon to match the latest plugin version
allowed_tools: ["Bash", "Read"]
---

# Update Discord Sentinel Daemon

Updates the sentinel daemon at `~/.claude/discord-sentinel/` to match the currently installed plugin version.

## Step 1: Check current state

```bash
launchctl list com.claude.discord-sentinel 2>/dev/null && echo "Sentinel: running" || echo "Sentinel: stopped"
```

## Step 2: Stop the sentinel

```bash
launchctl unload ~/Library/LaunchAgents/com.claude.discord-sentinel.plist 2>/dev/null || true
```

## Step 3: Copy updated files

Run the install script which copies all files and preserves bots.json:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-daemon.sh" "${CLAUDE_PLUGIN_ROOT}"
```

This copies:
- `sentinel.ts` — the daemon
- `sentinel-lock.sh` — lock management
- `package.json` — dependencies
- `discord-approve.sh` — approval hook
- `add-bot` / `remove-bot` — bot management scripts
- `uninstall` — uninstall script
- `session-start-hook.sh` — personality injection

It preserves:
- `bots.json` — bot registry (only creates if missing)
- `personalities/` — bot personality files
- `locks/` — session state
- `logs/` — sentinel logs

## Step 4: Confirm

```bash
launchctl list com.claude.discord-sentinel 2>/dev/null && echo "Sentinel: running" || echo "Sentinel: stopped"
```

Show what version is now installed and confirm the daemon is running.

Tell the user: "Daemon updated and restarted. Your bots and personalities are preserved."
