/**
 * Tests for the pure helpers in sentinel.ts.
 *
 * Run from the plugin root:   SENTINEL_DIR=$(mktemp -d) bun test
 * SENTINEL_DIR must point at scratch space because sentinel.ts creates its
 * locks/logs/personalities directories as soon as it is imported.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeLaunchLine, hasResumableSession, projectSessionsDir } from './sentinel.ts'

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
