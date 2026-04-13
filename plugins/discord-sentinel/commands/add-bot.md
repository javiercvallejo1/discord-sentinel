---
name: add-bot
description: Register a new Discord bot with the sentinel — sets up personality and optional approval hook
allowed_tools: ["Bash", "Read", "Write"]
args: "[name] [token]"
---

# Add Bot to Sentinel Pool

Register a new Discord bot with personality and optional approval hook.

## Step 1: Get bot details

If name and token weren't provided as arguments, ask for them:
- **Bot name**: short identifier (e.g., "data-bot", "assistant"). Used for screen sessions, files, and commands.
- **Bot token**: from the Discord Developer Portal (Applications → Bot → Token)

Validate:
- Name must not start with underscore
- Name must not already exist in `~/.claude/discord-sentinel/bots.json`

## Step 2: Project directory

Ask: "What project directory should this bot work in?"

Suggest the current working directory as default. The bot will `cd` to this directory when a session starts.

## Step 3: Personality

Ask the user:
> "Describe this bot's personality and role in a few sentences. For example: 'A data engineering assistant that helps with BigQuery, Dataform, and Python. Direct and technical, prefers showing code over explaining.'"

Take the user's description and **refine it** into a well-structured identity document. The identity.md should include:
- Who the bot is (role, expertise)
- Communication style (tone, verbosity, preferences)
- Domain knowledge (technologies, projects, context)
- Any behavioral guidelines

Save to `~/.claude/discord-sentinel/personalities/<name>.md`

Show the user the generated personality and ask if they want to adjust it.

## Step 4: Approval hook (optional)

Ask: "Want to enable the approval hook? It sends dangerous commands (git push, rm -rf, etc.) to Discord for your approval before executing. Recommended for remote control."

If yes, note that the approval env vars will be set in the spawn wrapper. The user will need to provide their DM channel ID (they can get it by right-clicking the DM channel with the bot in Discord with Developer Mode enabled).

## Step 5: Register

Register the bot using the CLI script:
```bash
~/.claude/discord-sentinel/add-bot "<name>" "<token>" "<project-dir>"
```

**If the add-bot script is missing**, write the entry directly to bots.json using jq. The schema for each bot entry is:

```json
{
  "<bot-name>": {
    "token": "<discord-bot-token>",
    "project": "<absolute-path-to-project-dir>",
    "label": "<display-name>"
  }
}
```

Required fields:
- `token` (string) — Discord bot token
- `label` (string) — display name for the bot (usually same as the bot name)

Optional fields:
- `project` (string) — absolute path to project directory. If omitted, uses `_config.default_project`

Example jq command to add directly:
```bash
jq --arg name "<name>" --arg token "<token>" --arg project "<dir>" --arg label "<name>" \
  '.[$name] = {token: $token, project: $project, label: $label}' \
  ~/.claude/discord-sentinel/bots.json > /tmp/bots.tmp \
  && mv /tmp/bots.tmp ~/.claude/discord-sentinel/bots.json
```

The sentinel watches bots.json and will automatically:
1. Provision channel config
2. Connect the bot to Discord
3. Set the bot to idle mode

## Done

Tell the user:
- Bot is online and in idle mode
- DM the bot on Discord to start a session
- Personality file at `~/.claude/discord-sentinel/personalities/<name>.md` — editable anytime
- Run `/bots` to see all registered bots
