---
name: configure
description: Reconfigure Discord Sentinel settings — owner ID, default project, bot personalities, or approval hook
allowed_tools: ["Bash", "Read", "Write"]
---

# Configure Discord Sentinel

Help the user reconfigure their sentinel setup. Ask what they want to change:

1. **Owner ID** — update `_config.owner_id` in bots.json
2. **Default project** — update `_config.default_project` in bots.json
3. **Bot personality** — edit a bot's personality file at `~/.claude/discord-sentinel/personalities/<name>.md`
4. **Approval hook** — enable or disable it per bot by setting or removing `approval_channel` (the ID of the DM channel with the bot) on the bot's entry in bots.json; it applies from the bot's next session
5. **Bot project** — change which project directory a bot works in

For personality changes, read the current personality file, ask what to change, and rewrite it.

bots.json holds the bot tokens. Edit it with `jq` through a temp file beside it, written under `umask 077`, as `/add-bot` does; never through `/tmp`.

For bots.json changes, use `jq` to update the file (sentinel hot-reloads automatically).
