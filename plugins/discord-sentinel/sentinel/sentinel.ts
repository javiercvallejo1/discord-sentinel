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
  timeout_hours?: number  // Auto-kill after N hours of inactivity (default: 4)
  auto_recover_rate_limit?: boolean  // Auto-recover when Claude rate-limit prompt blocks the session (default: true)
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
  sessionStartedAt?: number  // Timestamp when session was spawned
  rateLimitTickCount?: number  // Internal counter for throttled rate-limit detection
  rateLimitLastNotifyAt?: number  // Last time we notified owner about a rate-limit (cooldown)
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

// ── Health notifications ───────────────────────────────────────────────────────
/**
 * Sends a DM to the owner via Discord. By default uses the first registered
 * bot's token; pass a specific config to send via a particular bot (so the DM
 * shows up under that bot's chat — e.g., for per-bot rate-limit notifications).
 */
async function notifyOwner(message: string, viaBot?: BotConfig) {
  if (!poolConfig.owner_id) return

  let token: string | null = null
  if (viaBot) {
    token = viaBot.token
  } else {
    const { bots: registry } = loadBots()
    token = Object.values(registry)[0]?.token ?? null
  }
  if (!token) return

  try {
    const API = 'https://discord.com/api/v10'
    const AUTH = `Bot ${token}`

    // Open DM channel with owner
    const dmRes = await fetch(`${API}/users/@me/channels`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: poolConfig.owner_id }),
    })
    const dm = await dmRes.json() as any
    if (!dm.id) return

    // Send notification
    await fetch(`${API}/channels/${dm.id}/messages`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
  } catch (err: any) {
    log(`Health notification failed: ${err.message}`)
  }
}

// ── Rate-limit detection + recovery ────────────────────────────────────────────
// Claude Code's TUI prompts the user with a /rate-limit-options menu when the
// usage cap is hit. The screen session stays alive but the agent loop is
// blocked waiting for user input. `screen -X stuff` does not reach the TUI
// (raw /dev/tty mode), so we can't programmatically dismiss the prompt — but
// we CAN detect it from the screen's hardcopy output, notify the owner, and
// kill the stuck session. The lock monitor's existing stale-lock cleanup +
// gateway reclaim then brings the bot back to idle. The next DM respawns with
// `--continue`, which preserves the conversation state on disk.

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /You've hit your limit/i,
  /\/rate-limit-options/,
]
const RATE_LIMIT_TICK_INTERVAL = 5  // Check every N lock-monitor ticks (~15s at 3s tick)
const RATE_LIMIT_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000  // Don't notify same bot more than once per 30 min

/**
 * Strip common ANSI escape sequences from a terminal capture.
 * Conservative — handles CSI (`\x1b[…`) and OSC (`\x1b]…\x07`) sequences,
 * which is what claude-code emits.
 */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

/**
 * Capture the current screen of the bot's screen session and check for the
 * Claude rate-limit prompt. Uses `hardcopy` (without `-h`) so we only inspect
 * the visible screen, not the full scrollback. Returns false on any error
 * (screen not available, capture failed, regex no match).
 */
function detectRateLimit(botName: string): boolean {
  const screenName = `claude-${botName}`
  const captureFile = join('/tmp', `sentinel-rl-${botName}.txt`)
  try {
    execSync(`screen -S '${screenName}' -p 0 -X hardcopy '${captureFile}'`, { timeout: 5000 })
  } catch {
    return false
  }
  let text: string
  try {
    text = readFileSync(captureFile, 'utf8')
  } catch {
    return false
  } finally {
    try { unlinkSync(captureFile) } catch {}
  }
  const cleaned = stripAnsi(text)
  return RATE_LIMIT_PATTERNS.every(rx => rx.test(cleaned))
}

/**
 * Recover from a stuck rate-limit prompt: notify owner via the affected bot's
 * own DM, kill the claude PID, drop the lock, quit the screen session.
 * The lock-monitor's existing reclaim path then brings the bot back to idle
 * gateway mode. Honors a per-bot cooldown to avoid notification storms.
 */
async function recoverFromRateLimit(botName: string, state: BotState) {
  const now = Date.now()
  const last = state.rateLimitLastNotifyAt ?? 0
  if (now - last < RATE_LIMIT_NOTIFY_COOLDOWN_MS) return

  state.rateLimitLastNotifyAt = now
  log(`[${botName}] Rate-limit prompt detected — notifying owner and recovering`)

  const message =
    `⚠️ **${state.config.label}** topó con el rate-limit de Claude y la sesión quedó plantada en el menú de opciones.\n\n` +
    `Liberé el gateway: maté el proceso atascado, el bot vuelve a idle. Cuando el límite se libere y me mandes un DM, ` +
    `\`--continue\` retoma el contexto previo desde el JSONL.`

  try {
    await notifyOwner(message, state.config)
  } catch (err: any) {
    log(`[${botName}] Rate-limit notify failed: ${err.message}`)
  }

  // Kill the claude PID
  try {
    const content = readFileSync(getLockPath(botName), 'utf8').trim()
    const pid = parseInt(content, 10)
    if (!isNaN(pid)) {
      process.kill(pid, 'SIGTERM')
      log(`[${botName}] Sent SIGTERM to PID ${pid}`)
    }
  } catch {}

  // Drop lock + quit screen — lock monitor's stale-lock path will reclaim gateway on next tick
  try { unlinkSync(getLockPath(botName)) } catch {}
  try { execSync(`screen -S 'claude-${botName}' -X quit 2>/dev/null`) } catch {}
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
    'export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    `export DISCORD_BOT_TOKEN='${sq(config.token)}'`,
    `export DISCORD_BOT_NAME='${sq(botName)}'`,
    `export DISCORD_STATE_DIR='${sq(channelDir)}'`,
    `export CLAUDE_PROJECT_DIR='${sq(project)}'`,
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
    `exec '${sq(claudeBin)}' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions --continue`,
  )
  writeFileSync(wrapperScript, wrapperLines.join('\n'), { mode: 0o700 })

  try {
    execSync(`screen -dmS '${screenName}' '${wrapperScript}'`, { timeout: 10000 })
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
  const project = config.project || poolConfig.default_project
  const projectName = project.split('/').pop() || project
  const idleActivity = `Idle — ${projectName} — DM to start`

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
    presence: {
      status: 'idle',
      activities: [{ name: idleActivity, type: ActivityType.Watching }],
    },
  })

  client.once('ready', c => {
    log(`[${botName}] Connected as ${c.user.tag} — idle mode`)
    c.user.setPresence({
      status: 'idle',
      activities: [{ name: idleActivity, type: ActivityType.Watching }],
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
        `Starting session for **${config.label}**... send your request in a moment.\n\nSend **/sleep** to end the session.`
      )
      log(`[${botName}] DM from ${data.author.username} — spawning session`)

      // MUST disconnect BEFORE spawning. With async sleep (non-blocking),
      // discord.js processes "kicked off" events and auto-reconnects, creating
      // a reconnection war with Claude's discord plugin. Disconnecting first
      // (client.destroy()) prevents auto-reconnect entirely.
      // The working hand-built version avoided this because Bun.sleepSync
      // blocked the event loop, preventing discord.js from reconnecting.
      await disconnectBot(botName, state)
      state.status = 'spawning' // Re-set after disconnectBot resets to 'idle'

      const pid = await spawnSession(botName, config)

      if (pid) {
        createLock(botName, pid)
        state.status = 'active'
        state.sessionStartedAt = Date.now()
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
  if (state.status === 'connecting' || state.status === 'disconnecting' || state.status === 'spawning' || state.status === 'active' || state.status === 'errored') return

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

    state.retryTimer = setTimeout(() => {
      state.status = 'idle' // Reset so connectBot's guard doesn't block
      connectBot(botName, state)
    }, delay)
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
  state.status = 'idle'
}

// ── Lock monitoring ────────────────────────────────────────────────────────────
function startLockMonitor(botName: string, state: BotState) {
  state.lockCheckTimer = setInterval(async () => {
    const active = isSessionActive(botName)

    if (active && state.status === 'idle') {
      log(`[${botName}] Session started — handing off gateway`)
      await disconnectBot(botName, state)
      state.status = 'active'
      state.sessionStartedAt = Date.now()
    } else if (!active && state.status === 'active') {
      log(`[${botName}] Session ended — reclaiming gateway (idle mode)`)
      state.sessionStartedAt = undefined
      state.status = 'idle'
      await connectBot(botName, state)
    } else if (active && state.status === 'active' && state.sessionStartedAt) {
      // Check session timeout (opt-in: set timeout_hours in bots.json, 0 = disabled)
      const timeoutHours = state.config.timeout_hours ?? 0
      if (timeoutHours > 0) {
        const elapsed = (Date.now() - state.sessionStartedAt) / (1000 * 60 * 60)
        if (elapsed >= timeoutHours) {
          log(`[${botName}] Session timed out after ${timeoutHours}h — killing`)
          try {
            const content = readFileSync(getLockPath(botName), 'utf8').trim()
            const pid = parseInt(content, 10)
            if (!isNaN(pid)) process.kill(pid, 'SIGTERM')
          } catch {}
          try { unlinkSync(getLockPath(botName)) } catch {}
          try { execSync(`screen -S claude-${botName} -X quit 2>/dev/null`) } catch {}
        }
      }

      // Rate-limit detection (default enabled; opt-out per bot via auto_recover_rate_limit=false)
      const autoRecover = state.config.auto_recover_rate_limit !== false
      if (autoRecover) {
        state.rateLimitTickCount = (state.rateLimitTickCount ?? 0) + 1
        if (state.rateLimitTickCount >= RATE_LIMIT_TICK_INTERVAL) {
          state.rateLimitTickCount = 0
          if (detectRateLimit(botName)) {
            await recoverFromRateLimit(botName, state)
          }
        }
      }
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

// Notify owner on startup (useful for crash recovery detection via launchd KeepAlive)
notifyOwner(`Sentinel started — managing ${bots.size} bot(s)`).catch(() => {})
