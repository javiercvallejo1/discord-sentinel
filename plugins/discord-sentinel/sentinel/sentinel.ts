#!/usr/bin/env bun
/**
 * Discord Sentinel — Bot pool manager with auto-spawn.
 *
 * Reads bot registry from bots.json, keeps idle bots online on Discord gateway.
 * When a user DMs an idle bot, spawns a Claude Code session in `screen` that
 * takes over the gateway. When the session ends, reclaims the gateway.
 *
 * Features:
 *   - Auto-provisions channel configs from bots.json
 *   - Spawns Claude sessions in detached `screen` on DM trigger
 *   - Lock-based session detection with PID liveness checks
 *   - Hot-reloads bots.json on file changes
 *   - Per-bot personality injection via DISCORD_BOT_NAME env var
 */

import {
  ActivityType,
  Client,
  GatewayIntentBits,
  GatewayDispatchEvents,
  Partials,
  ChannelType,
} from 'discord.js'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  watch,
} from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

// ── Paths ──────────────────────────────────────────────────────────────────────
const SENTINEL_DIR = process.env.SENTINEL_DIR ?? join(homedir(), '.claude', 'discord-sentinel')
const BOTS_FILE = join(SENTINEL_DIR, 'bots.json')
const LOCKS_DIR = join(SENTINEL_DIR, 'locks')
const LOGS_DIR = join(SENTINEL_DIR, 'logs')
const PERSONALITIES_DIR = join(SENTINEL_DIR, 'personalities')
const CHANNELS_DIR = join(homedir(), '.claude', 'channels')

mkdirSync(LOCKS_DIR, { recursive: true })
mkdirSync(LOGS_DIR, { recursive: true })
mkdirSync(PERSONALITIES_DIR, { recursive: true })

// ── Types ──────────────────────────────────────────────────────────────────────
interface BotConfig {
  token: string
  project?: string
  label: string
  approval_channel?: string
}

interface PoolConfig {
  owner_id: string
  default_project: string
}

interface BotState {
  config: BotConfig
  client: Client | null
  status: 'idle' | 'active' | 'errored' | 'disconnecting' | 'connecting' | 'spawning'
  retryCount: number
  retryTimer: ReturnType<typeof setTimeout> | null
  lockCheckTimer: ReturnType<typeof setInterval> | null
}

// ── State ──────────────────────────────────────────────────────────────────────
const bots = new Map<string, BotState>()
const spawnCooldown = new Map<string, number>()
let poolConfig: PoolConfig = {
  owner_id: '',
  default_project: join(homedir(), 'Documents'),
}

// ── Logging ────────────────────────────────────────────────────────────────────
function log(msg: string) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  process.stderr.write(line)
  try {
    const logFile = join(LOGS_DIR, `sentinel-${ts.slice(0, 10)}.log`)
    writeFileSync(logFile, line, { flag: 'a' })
  } catch {}
}

// ── Channel auto-provisioning ──────────────────────────────────────────────────
function provisionChannel(botName: string, config: BotConfig) {
  const channelDir = join(CHANNELS_DIR, `discord-${botName}`)
  mkdirSync(channelDir, { recursive: true, mode: 0o700 })

  const envFile = join(channelDir, '.env')
  writeFileSync(envFile, `DISCORD_BOT_TOKEN=${config.token}\n`, { mode: 0o600 })

  const accessFile = join(channelDir, 'access.json')
  if (!existsSync(accessFile) && poolConfig.owner_id) {
    writeFileSync(accessFile, JSON.stringify({
      dmPolicy: 'allowlist',
      allowFrom: [poolConfig.owner_id],
      groups: {},
      pending: {},
    }, null, 2))
  }

  mkdirSync(join(channelDir, 'approved'), { recursive: true })
  mkdirSync(join(channelDir, 'inbox'), { recursive: true })

  log(`[${botName}] Channel config provisioned at ${channelDir}`)
}

// ── Lock management ────────────────────────────────────────────────────────────
function getLockPath(botName: string): string {
  return join(LOCKS_DIR, `${botName}.lock`)
}

function isSessionActive(botName: string): boolean {
  const lockPath = getLockPath(botName)

  try {
    if (!existsSync(lockPath)) return false

    const content = readFileSync(lockPath, 'utf8').trim()
    const pid = parseInt(content, 10)
    if (isNaN(pid)) {
      unlinkSync(lockPath)
      return false
    }

    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        log(`[${botName}] Stale lock (PID ${pid} dead) — cleaning up`)
        unlinkSync(lockPath)
        try { execSync(`screen -S claude-${botName} -X quit 2>/dev/null`) } catch {}
        return false
      }
      if (err.code === 'EPERM') return true
      return false
    }
  } catch {
    return false
  }
}

function createLock(botName: string, pid: number) {
  writeFileSync(getLockPath(botName), `${pid}\n`)
  log(`[${botName}] Lock created (PID ${pid})`)
}

function removeLock(botName: string) {
  try {
    unlinkSync(getLockPath(botName))
    log(`[${botName}] Lock removed`)
  } catch {}
}

// ── Session spawning ───────────────────────────────────────────────────────────
async function spawnSession(botName: string, config: BotConfig): Promise<number | null> {
  const project = config.project || poolConfig.default_project
  const channelDir = join(CHANNELS_DIR, `discord-${botName}`)
  const screenName = `claude-${botName}`

  // Kill any orphaned screen with the same name
  try { execSync(`screen -S ${screenName} -X quit 2>/dev/null`) } catch {}

  // Resolve claude binary — check common locations
  const claudePaths = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]
  let claudeBin = 'claude'
  for (const p of claudePaths) {
    if (existsSync(p)) { claudeBin = p; break }
  }

  // Escape single quotes for safe shell interpolation
  const sq = (s: string) => s.replace(/'/g, "'\\''")

  // Generate spawn wrapper with env vars for personality + approval
  const wrapperScript = join(LOCKS_DIR, `spawn-${botName}.sh`)
  const wrapperLines = [
    '#!/bin/bash',
    '# Source shell profile for PATH (screen uses minimal login shell)',
    '[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null || [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true',
    'export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    `export DISCORD_BOT_TOKEN='${sq(config.token)}'`,
    `export DISCORD_BOT_NAME='${sq(botName)}'`,
    `export DISCORD_STATE_DIR='${sq(channelDir)}'`,
  ]

  // Set approval hook env vars if approval_channel is configured
  if (config.approval_channel) {
    wrapperLines.push(
      `export DISCORD_APPROVE_BOT_TOKEN='${sq(config.token)}'`,
      `export DISCORD_APPROVE_CHANNEL_ID='${sq(config.approval_channel)}'`,
      `export DISCORD_APPROVE_USER_ID='${sq(poolConfig.owner_id)}'`,
    )
  }

  wrapperLines.push(
    `cd '${sq(project)}'`,
    `exec '${sq(claudeBin)}' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions`,
  )
  writeFileSync(wrapperScript, wrapperLines.join('\n'), { mode: 0o700 })

  try {
    execSync(`screen -dmS ${screenName} '${wrapperScript}'`, { timeout: 10000 })
    log(`[${botName}] Screen session '${screenName}' spawned`)

    // Find the claude PID
    let pid: number | null = null
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const screenPid = execSync(
          `screen -ls | grep "\\.${screenName}\\b" | awk -F. '{print $1}' | tr -d '\\t ' | head -1`,
          { encoding: 'utf8' }
        ).trim()
        if (!screenPid) continue

        const result = execSync(
          `pgrep -P $(pgrep -P ${screenPid} | head -1) -f claude 2>/dev/null || pgrep -P ${screenPid} -f claude 2>/dev/null || true`,
          { encoding: 'utf8' }
        ).trim()
        if (result) {
          pid = parseInt(result.split('\n')[0], 10)
          if (!isNaN(pid)) break
        }
      } catch {}
    }

    if (pid) {
      log(`[${botName}] Claude process detected (PID ${pid})`)
      return pid
    } else {
      log(`[${botName}] Could not detect Claude PID — checking screen session`)
      try {
        const screenPid = execSync(
          `screen -ls | grep "\\.${screenName}\\b" | awk -F. '{print $1}' | tr -d '\\t ' | head -1`,
          { encoding: 'utf8' }
        ).trim()
        if (screenPid) {
          const childPid = execSync(`pgrep -P ${screenPid} | head -1`, { encoding: 'utf8' }).trim()
          if (childPid) {
            pid = parseInt(childPid, 10)
            log(`[${botName}] Using screen child PID ${pid} as lock`)
            return pid
          }
        }
      } catch {}
      log(`[${botName}] Screen session not found — spawn may have failed`)
      return null
    }
  } catch (err: any) {
    log(`[${botName}] Spawn failed: ${err.message}`)
    return null
  }
}

// ── Bot management ─────────────────────────────────────────────────────────────
function createClient(botName: string, config: BotConfig): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
    presence: {
      status: 'idle',
      activities: [{ name: 'Idle — DM to start session', type: ActivityType.Watching }],
    },
  })

  client.once('ready', c => {
    log(`[${botName}] Connected as ${c.user.tag} — idle mode`)
    c.user.setPresence({
      status: 'idle',
      activities: [{ name: 'Idle — DM to start session', type: ActivityType.Watching }],
    })
  })

  // discord.js v14 silently drops DM messageCreate events due to a partial
  // channel resolution bug. Use the raw websocket handler instead, then fetch
  // the full Message object from the API.
  client.ws.on(GatewayDispatchEvents.MessageCreate, async (data: any) => {
    if (data.author?.bot) return
    if (data.channel_type !== undefined && data.channel_type !== 1) return // 1 = DM
    if (poolConfig.owner_id && data.author?.id !== poolConfig.owner_id) return

    const state = bots.get(botName)
    if (!state || state.status !== 'idle') return

    const now = Date.now()
    const last = spawnCooldown.get(botName) ?? 0
    if (now - last < 15000) return
    spawnCooldown.set(botName, now)

    state.status = 'spawning'

    try {
      // Fetch full channel and message so we can reply
      const channel = await client.channels.fetch(data.channel_id)
      if (!channel || !('messages' in channel)) { state.status = 'idle'; return }
      const msg = await (channel as any).messages.fetch(data.id)

      await msg.reply(
        `Starting session for **${config.label}**... send your request in a moment.`
      )
      log(`[${botName}] DM from ${data.author.username} — spawning session`)

      // Set presence to "online" before disconnecting. Discord preserves
      // the last presence until a new gateway connection overrides it, so
      // the bot stays visibly online while Claude's session is active.
      if (state.client?.user) {
        state.client.user.setPresence({
          status: 'online',
          activities: [{ name: `Active session`, type: ActivityType.Playing }],
        })
      }

      // IMPORTANT: Disconnect from gateway BEFORE spawning Claude.
      // Discord only allows one gateway connection per token. If the sentinel
      // holds the gateway while Claude's discord plugin tries to connect,
      // the plugin either gets rejected or kicks the sentinel — both break.
      await disconnectBot(botName, state)

      const pid = await spawnSession(botName, config)

      if (pid) {
        createLock(botName, pid)
        state.status = 'active'
      } else {
        // Spawn failed — reclaim the gateway
        log(`[${botName}] Spawn failed — reclaiming gateway`)
        await connectBot(botName, state)
      }
    } catch (err: any) {
      log(`[${botName}] Spawn error: ${err.message}`)
      state.status = 'idle'
    }
  })

  client.on('error', err => {
    log(`[${botName}] Client error: ${err.message}`)
  })

  return client
}

async function connectBot(botName: string, state: BotState): Promise<void> {
  if (state.status === 'connecting' || state.status === 'disconnecting' || state.status === 'spawning' || state.status === 'errored') return

  if (isSessionActive(botName)) {
    log(`[${botName}] Active session detected — staying disconnected`)
    state.status = 'active'
    return
  }

  state.status = 'connecting'
  const client = createClient(botName, state.config)
  state.client = client

  try {
    await client.login(state.config.token)
    state.status = 'idle'
    state.retryCount = 0
    log(`[${botName}] Logged in — idle mode`)
  } catch (err: any) {
    state.status = 'errored'
    state.client = null
    state.retryCount++

    const delays = [5000, 10000, 30000, 60000, 300000]
    const delay = delays[Math.min(state.retryCount - 1, delays.length - 1)]
    log(`[${botName}] Login failed (attempt ${state.retryCount}): ${err.message} — retry in ${delay / 1000}s`)

    state.retryTimer = setTimeout(() => connectBot(botName, state), delay)
  }
}

async function disconnectBot(botName: string, state: BotState): Promise<void> {
  if (!state.client) return

  state.status = 'disconnecting'
  if (state.retryTimer) {
    clearTimeout(state.retryTimer)
    state.retryTimer = null
  }

  try {
    state.client.destroy()
    log(`[${botName}] Disconnected`)
  } catch (err: any) {
    log(`[${botName}] Error during disconnect: ${err.message}`)
  }

  state.client = null
}

// ── Lock monitoring ────────────────────────────────────────────────────────────
function startLockMonitor(botName: string, state: BotState) {
  state.lockCheckTimer = setInterval(async () => {
    const active = isSessionActive(botName)

    if (active && state.status === 'idle') {
      log(`[${botName}] Session started — handing off gateway`)
      await disconnectBot(botName, state)
      state.status = 'active'
    } else if (!active && state.status === 'active') {
      log(`[${botName}] Session ended — reclaiming gateway (idle mode)`)
      await connectBot(botName, state)
    }
  }, 3000)
}

function stopLockMonitor(state: BotState) {
  if (state.lockCheckTimer) {
    clearInterval(state.lockCheckTimer)
    state.lockCheckTimer = null
  }
}

// ── Registry management ────────────────────────────────────────────────────────
function loadBots(): { config: PoolConfig; bots: Record<string, BotConfig> } {
  try {
    const raw = JSON.parse(readFileSync(BOTS_FILE, 'utf8'))
    const { _config, ...botEntries } = raw
    const config: PoolConfig = {
      owner_id: _config?.owner_id ?? poolConfig.owner_id,
      default_project: _config?.default_project ?? poolConfig.default_project,
    }
    return { config, bots: botEntries }
  } catch {
    log('No bots.json found or invalid — empty registry')
    return { config: poolConfig, bots: {} }
  }
}

async function syncBots() {
  const { config, bots: registry } = loadBots()
  poolConfig = config
  const registryNames = new Set(Object.keys(registry))

  for (const [name, state] of bots) {
    if (!registryNames.has(name)) {
      log(`[${name}] Removed from registry — disconnecting`)
      stopLockMonitor(state)
      await disconnectBot(name, state)
      bots.delete(name)
    }
  }

  for (const [name, config] of Object.entries(registry)) {
    provisionChannel(name, config)

    const existing = bots.get(name)

    if (existing) {
      if (existing.config.token !== config.token) {
        log(`[${name}] Token changed — reconnecting`)
        stopLockMonitor(existing)
        await disconnectBot(name, existing)
        existing.config = config
        provisionChannel(name, config)
        await connectBot(name, existing)
        startLockMonitor(name, existing)
      } else {
        existing.config = config
      }
    } else {
      const state: BotState = {
        config,
        client: null,
        status: 'idle',
        retryCount: 0,
        retryTimer: null,
        lockCheckTimer: null,
      }
      bots.set(name, state)
      await connectBot(name, state)
      startLockMonitor(name, state)
    }
  }
}

// ── Watch bots.json for changes ────────────────────────────────────────────────
// Watch the DIRECTORY instead of the file. On macOS, fs.watch watches the inode,
// not the path. When jq/mv atomically replaces bots.json, the old inode is deleted
// and the file watcher goes deaf. Watching the directory catches all changes
// including atomic replacements.
let reloadDebounce: ReturnType<typeof setTimeout> | null = null

function watchRegistry() {
  watch(SENTINEL_DIR, (_, filename) => {
    if (filename === 'bots.json') {
      if (reloadDebounce) clearTimeout(reloadDebounce)
      reloadDebounce = setTimeout(() => {
        log('bots.json changed — reloading')
        syncBots().catch(err => log(`Reload error: ${err.message}`))
      }, 500)
    }
  })
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown() {
  log('Shutting down...')
  for (const [name, state] of bots) {
    stopLockMonitor(state)
    await disconnectBot(name, state)
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ── Main ───────────────────────────────────────────────────────────────────────
log('Discord Sentinel starting...')
await syncBots()
watchRegistry()
log(`Sentinel running — managing ${bots.size} bot(s), owner: ${poolConfig.owner_id || 'any'}`)
