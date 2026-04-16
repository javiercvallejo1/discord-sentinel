---
name: sentinel
description: Manage the sentinel daemon — start, stop, status, or view logs
allowed_tools: ["Bash", "Read"]
args: "<start|stop|status|logs>"
---

# Sentinel Daemon Management

Manage the Discord Sentinel daemon service. Detects OS (macOS/Linux) and uses the appropriate service manager (launchctl/systemctl).

## Parse the action

The user should provide one of: `start`, `stop`, `status`, `logs`

If no action provided, show usage and current status.

## Detect OS

Always check the OS first:
```bash
OS=$(uname -s)
```

## Actions

### start

**macOS:**
```bash
launchctl load ~/Library/LaunchAgents/com.claude.discord-sentinel.plist
```

**Linux:**
```bash
systemctl --user start claude-discord-sentinel
```

Confirm it started by checking status.

### stop

**macOS:**
```bash
launchctl unload ~/Library/LaunchAgents/com.claude.discord-sentinel.plist
```

**Linux:**
```bash
systemctl --user stop claude-discord-sentinel
```

### status

**macOS:**
```bash
launchctl list com.claude.discord-sentinel 2>/dev/null
```

**Linux:**
```bash
systemctl --user status claude-discord-sentinel --no-pager
```

Then, on both OSes, show bot statuses by reading lock files:
```bash
for lock in ~/.claude/discord-sentinel/locks/*.lock; do
  [ -f "$lock" ] || continue
  name=$(basename "$lock" .lock)
  pid=$(cat "$lock")
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name: active (PID $pid)"
  else
    echo "$name: stale lock (PID $pid dead)"
  fi
done
```

Also show bots with no lock (idle or offline):
```bash
jq -r 'to_entries[] | select(.key != "_config") | .key' ~/.claude/discord-sentinel/bots.json
```

### logs

**macOS:**
```bash
tail -50 ~/.claude/discord-sentinel/logs/sentinel-$(date +%Y-%m-%d).log 2>/dev/null || tail -50 ~/.claude/discord-sentinel/logs/sentinel-stderr.log
```

**Linux:**
```bash
journalctl --user -u claude-discord-sentinel -n 50 --no-pager
```

If journalctl returns nothing, fall back to the file log:
```bash
tail -50 ~/.claude/discord-sentinel/logs/sentinel-$(date +%Y-%m-%d).log 2>/dev/null || tail -50 ~/.claude/discord-sentinel/logs/sentinel-stderr.log
```
