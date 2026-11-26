/**
 * Tests for the pure helpers in sentinel.ts.
 *
 * Run from the plugin root:   SENTINEL_DIR=$(mktemp -d) bun test
 * SENTINEL_DIR must point at scratch space because sentinel.ts creates its
 * locks/logs/personalities directories as soon as it is imported.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildSpawnWrapper,
  claudeLaunchLine,
  hasResumableSession,
  isOwnerDm,
  launchInScreen,
  matchScreenSessions,
  parseRegistry,
  projectSessionsDir,
  quitScreen,
} from './sentinel.ts'

const CLAUDE = '/usr/local/bin/claude'
const PROJECT = '/Users/someone/Documents/verinext/lsa'
const ENCODED = '-Users-someone-Documents-verinext-lsa'

describe('projectSessionsDir', () => {
  test('mirrors Claude Code: every non-alphanumeric character becomes "-"', () => {
    expect(projectSessionsDir('/srv/gpt_compliance.logs/v2 beta', '/home/u/.claude'))
      .toBe('/home/u/.claude/projects/-srv-gpt-compliance-logs-v2-beta')
  })

  test('ignores a trailing slash, since Claude resolves cwd without one', () => {
    expect(projectSessionsDir(PROJECT + '/', '/home/u/.claude'))
      .toBe(projectSessionsDir(PROJECT, '/home/u/.claude'))
  })
})

describe('hasResumableSession', () => {
  let claudeDir: string
  beforeEach(() => { claudeDir = mkdtempSync(join(tmpdir(), 'claude-home-')) })
  afterEach(() => { rmSync(claudeDir, { recursive: true, force: true }) })

  test('is false when the project has never had a session', () => {
    expect(hasResumableSession(PROJECT, claudeDir)).toBe(false)
  })

  test('is false when the project dir survives but every .jsonl was swept', () => {
    // What Claude Code's 30-day session cleanup leaves behind: only memory/ remains.
    mkdirSync(join(claudeDir, 'projects', ENCODED, 'memory'), { recursive: true })
    writeFileSync(join(claudeDir, 'projects', ENCODED, 'memory', 'MEMORY.md'), '')
    expect(hasResumableSession(PROJECT, claudeDir)).toBe(false)
  })

  test('is true when a session .jsonl exists under the encoded project dir', () => {
    mkdirSync(join(claudeDir, 'projects', ENCODED), { recursive: true })
    writeFileSync(join(claudeDir, 'projects', ENCODED, '19255c65-9cf3-4773-88a1-305e76667808.jsonl'), '{}\n')
    expect(hasResumableSession(PROJECT, claudeDir)).toBe(true)
  })
})

describe('claudeLaunchLine', () => {
  test('always launches with the discord channel and skip-permissions flags', () => {
    expect(claudeLaunchLine(CLAUDE, false)).toBe(
      "exec '/usr/local/bin/claude' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions"
    )
  })

  test('appends --continue only when there is a conversation to continue', () => {
    expect(claudeLaunchLine(CLAUDE, false)).not.toContain('--continue')
    expect(claudeLaunchLine(CLAUDE, true)).toBe(
      "exec '/usr/local/bin/claude' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions --continue"
    )
  })

  test('shell-escapes a single quote in the claude binary path', () => {
    expect(claudeLaunchLine("/Users/o'brien/bin/claude", false)).toBe(
      "exec '/Users/o'\\''brien/bin/claude' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions"
    )
  })
})

describe('claudeLaunchLine model pinning', () => {
  test('omits --model when the bot has no model configured', () => {
    expect(claudeLaunchLine(CLAUDE, false)).not.toContain('--model')
    expect(claudeLaunchLine(CLAUDE, false, '')).not.toContain('--model')
  })

  test('pins the session to the configured model, shell-quoted, ahead of the channel flags', () => {
    // The [1m] context-window suffix is a shell glob pattern — it must be quoted.
    expect(claudeLaunchLine(CLAUDE, false, 'claude-fable-5-1[1m]')).toBe(
      "exec '/usr/local/bin/claude' --model 'claude-fable-5-1[1m]' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions"
    )
  })

  test('keeps --model and --continue together when both apply', () => {
    expect(claudeLaunchLine(CLAUDE, true, 'opus')).toBe(
      "exec '/usr/local/bin/claude' --model 'opus' --channels plugin:discord@claude-plugins-official --dangerously-skip-permissions --continue"
    )
  })
})

// ── Registry parsing ──────────────────────────────────────────────────────────
const DEFAULTS = { owner_id: '', default_project: '/home/u/Documents' }

describe('parseRegistry', () => {
  test('returns null for text that is not a JSON object, so the caller keeps its bots', () => {
    expect(parseRegistry('{ "agent-1": { "token": "t", ', DEFAULTS)).toBeNull()
    expect(parseRegistry('[]', DEFAULTS)).toBeNull()
    expect(parseRegistry('', DEFAULTS)).toBeNull()
  })

  test('splits _config from the bot entries', () => {
    const parsed = parseRegistry(JSON.stringify({
      _config: { owner_id: '42', default_project: '/srv/app' },
      'agent-1': { token: 't1', label: 'agent-1' },
    }), DEFAULTS)
    expect(parsed).toEqual({
      config: { owner_id: '42', default_project: '/srv/app' },
      bots: { 'agent-1': { token: 't1', label: 'agent-1' } },
    })
  })

  test('falls back to the defaults when _config is missing or its project is empty', () => {
    expect(parseRegistry('{}', DEFAULTS)!.config).toEqual(DEFAULTS)
    expect(parseRegistry('{"_config":{"owner_id":"","default_project":""}}', DEFAULTS)!.config).toEqual(DEFAULTS)
  })

  test('an owner cleared in the file is cleared, not replaced by the previous one', () => {
    const previous = { owner_id: '42', default_project: '/srv/app' }
    expect(parseRegistry('{"_config":{"owner_id":""}}', previous)!.config.owner_id).toBe('')
  })
})

// ── Who may start a session ───────────────────────────────────────────────────
describe('isOwnerDm', () => {
  const dm = (id: string, extra = {}) => ({ author: { id }, channel_type: 1, ...extra })

  test('accepts a DM from the owner', () => {
    expect(isOwnerDm(dm('42'), '42')).toBe(true)
    expect(isOwnerDm({ author: { id: '42' } }, '42')).toBe(true)
  })

  test('rejects everyone while no owner is configured', () => {
    expect(isOwnerDm(dm('42'), '')).toBe(false)
  })

  test('rejects other users, bots and non-DM channels', () => {
    expect(isOwnerDm(dm('7'), '42')).toBe(false)
    expect(isOwnerDm(dm('42', { author: { id: '42', bot: true } }), '42')).toBe(false)
    expect(isOwnerDm(dm('42', { channel_type: 0 }), '42')).toBe(false)
  })
})

// ── Screen sessions ───────────────────────────────────────────────────────────
describe('matchScreenSessions', () => {
  const MAC = 'There are screens on:\n\t71706.claude-agent-10\t(Detached)\n\t71703.claude-agent-1\t(Detached)\n2 Sockets in /var/folders/x.\n'
  const LINUX = 'There is a screen on:\n\t2211.claude-agent-1\t(11/26/2026 01:02:03 PM)\t(Detached)\n1 Socket in /run/screen/S-u.\n'

  test('returns only the session whose name matches exactly, never a longer name with the same prefix', () => {
    expect(matchScreenSessions(MAC, 'claude-agent-1')).toEqual(['71703.claude-agent-1'])
    expect(matchScreenSessions(MAC, 'claude-agent-10')).toEqual(['71706.claude-agent-10'])
    expect(matchScreenSessions(MAC, 'claude-agent')).toEqual([])
  })

  test('reads the Linux listing, which carries a date column', () => {
    expect(matchScreenSessions(LINUX, 'claude-agent-1')).toEqual(['2211.claude-agent-1'])
  })

  test('returns nothing when no session is listed', () => {
    expect(matchScreenSessions('No Sockets found in /var/folders/x.\n', 'claude-agent-1')).toEqual([])
  })
})

// ── Spawn wrapper ─────────────────────────────────────────────────────────────
const wrapperOptions = (overrides = {}) => ({
  botName: 'agent-1',
  config: { token: 'tok', label: 'agent-1' },
  project: '/srv/app',
  channelDir: '/home/u/.claude/channels/discord-agent-1',
  claudeBin: CLAUDE,
  ownerId: '42',
  lockPath: '/home/u/.claude/discord-sentinel/locks/agent-1.lock',
  resume: false,
  ...overrides,
})

describe('buildSpawnWrapper', () => {
  test('records its own PID as the lock, atomically, after entering the project and before exec', () => {
    const lines = buildSpawnWrapper(wrapperOptions()).split('\n')
    const cd = lines.findIndex(l => l.startsWith("cd '/srv/app' ||"))
    const lock = lines.indexOf(
      "echo $$ > '/home/u/.claude/discord-sentinel/locks/agent-1.lock.tmp' && " +
      "mv '/home/u/.claude/discord-sentinel/locks/agent-1.lock.tmp' '/home/u/.claude/discord-sentinel/locks/agent-1.lock'"
    )
    const exec = lines.findIndex(l => l.startsWith('exec '))
    expect(cd).toBeGreaterThan(0)
    expect(lock).toBeGreaterThan(cd)
    expect(exec).toBeGreaterThan(lock)
  })

  test('exports the approval variables only when the bot has an approval channel', () => {
    expect(buildSpawnWrapper(wrapperOptions())).not.toContain('DISCORD_APPROVE_')
    const withApproval = buildSpawnWrapper(wrapperOptions({ config: { token: 'tok', label: 'agent-1', approval_channel: '99' } }))
    expect(withApproval).toContain("export DISCORD_APPROVE_CHANNEL_ID='99'")
    expect(withApproval).toContain("export DISCORD_APPROVE_USER_ID='42'")
  })
})

// ── Launching in screen (needs the real `screen` binary) ─────────────────────
const hasScreen = spawnSync('screen', ['-v']).error === undefined
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const listed = (screenName: string) =>
  matchScreenSessions(spawnSync('screen', ['-ls']).stdout.toString(), screenName)

describe.skipIf(!hasScreen)('launchInScreen', () => {
  let dir: string
  let fakeClaude: string
  let pids: number[]
  const name = `claude-zztest${process.pid}`
  const sibling = `${name}0`  // shares the prefix, like agent-1 and agent-10

  const launch = async (screenName: string, bin = fakeClaude) => {
    const lockPath = join(dir, `${screenName}.lock`)
    const wrapper = join(dir, `spawn-${screenName}.sh`)
    writeFileSync(wrapper, buildSpawnWrapper(wrapperOptions({ project: dir, claudeBin: bin, lockPath })), { mode: 0o700 })
    const pid = await launchInScreen(screenName, wrapper, lockPath, 6)
    if (pid) pids.push(pid)
    return pid
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sentinel-screen-'))
    fakeClaude = join(dir, 'fake-claude')
    // Stands in for claude: stays alive, as one process, until the test ends it.
    writeFileSync(fakeClaude, '#!/bin/bash\nread -t 30\n', { mode: 0o755 })
    pids = []
  })
  afterEach(() => {
    quitScreen(name)
    quitScreen(sibling)
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch {} }
    rmSync(dir, { recursive: true, force: true })
  })

  test('returns the PID of the launched process and leaves it in the lock file', async () => {
    const pid = await launch(name)
    expect(pid).not.toBeNull()
    expect(alive(pid!)).toBe(true)
    expect(readFileSync(join(dir, `${name}.lock`), 'utf8').trim()).toBe(String(pid))
    // The wrapper's own PID became the launched program through exec.
    expect(spawnSync('ps', ['-o', 'command=', '-p', String(pid)]).stdout.toString())
      .toContain(`${fakeClaude} --channels`)
  })

  test('returns null and leaves no lock or session when the process dies at once', async () => {
    const dying = join(dir, 'dying-claude')
    writeFileSync(dying, '#!/bin/bash\nexit 1\n', { mode: 0o755 })
    expect(await launch(name, dying)).toBeNull()
    expect(existsSync(join(dir, `${name}.lock`))).toBe(false)
    expect(listed(name)).toEqual([])
  })

  test('quitting a session ends it and leaves a session with a longer, same-prefix name running', async () => {
    const pid = await launch(name)
    const siblingPid = await launch(sibling)
    expect(pid).not.toBeNull()
    expect(siblingPid).not.toBeNull()
    quitScreen(name)
    expect(listed(name)).toEqual([])
    expect(listed(sibling)).toHaveLength(1)
    expect(alive(siblingPid!)).toBe(true)
  })

  test('quitting a session that is not running leaves the same-prefix session alone', async () => {
    const siblingPid = await launch(sibling)
    expect(siblingPid).not.toBeNull()
    quitScreen(name)
    expect(listed(sibling)).toHaveLength(1)
    expect(alive(siblingPid!)).toBe(true)
  })
})
