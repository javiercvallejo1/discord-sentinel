---
name: update
description: Update the sentinel daemon to match the latest plugin version
allowed_tools: ["Bash", "Read"]
---

# Update Discord Sentinel Daemon

Updates the sentinel daemon at `~/.claude/discord-sentinel/` to match the currently installed plugin version. Works on macOS (launchd) and Linux (systemd).

## Step 1: Reinstall from the plugin

The install script stops the running service, copies the files and starts it again:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-daemon.sh" "${CLAUDE_PLUGIN_ROOT}"
```

This copies:
- `sentinel.ts` — the daemon
- `sentinel-lock.sh` — lock management
- `package.json` and `bun.lock` — dependencies
- `discord-approve.sh` — approval hook
- `add-bot` / `remove-bot` — bot management scripts
- `uninstall` — uninstall script
- `session-start-hook.sh` — personality injection

It preserves:
- `bots.json` — bot registry (only creates if missing)
- `personalities/` — bot personality files
- `locks/` — session state
- `logs/` — sentinel logs

## Step 2: Confirm

**macOS:**
```bash
launchctl list com.claude.discord-sentinel 2>/dev/null && echo "Sentinel: running" || echo "Sentinel: stopped"
```

**Linux:**
```bash
systemctl --user is-active claude-discord-sentinel
```

Show what version is now installed and confirm the daemon is running.

Tell the user: "Daemon updated and restarted. Your bots and personalities are preserved."
