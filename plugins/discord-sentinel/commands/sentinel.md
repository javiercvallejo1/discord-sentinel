---
name: sentinel
description: Manage the sentinel daemon — start, stop, status, or view logs
allowed_tools: ["Bash", "Read"]
args: "<start|stop|status|logs>"
---

# Sentinel Daemon Management

Manage the Discord Sentinel daemon service.

## Parse the action

The user should provide one of: `start`, `stop`, `status`, `logs`

If no action provided, show usage and current status.

## Actions

### start
```bash
launchctl load ~/Library/LaunchAgents/com.claude.discord-sentinel.plist
```
Confirm it started by checking status.

### stop
```bash
launchctl unload ~/Library/LaunchAgents/com.claude.discord-sentinel.plist
```

### status
Check if the service is running:
```bash
launchctl list com.claude.discord-sentinel 2>/dev/null
```

Show bot statuses by reading lock files:
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
Show recent sentinel logs:
```bash
tail -50 ~/.claude/discord-sentinel/logs/sentinel-$(date +%Y-%m-%d).log 2>/dev/null || tail -50 ~/.claude/discord-sentinel/logs/sentinel-stderr.log
```
