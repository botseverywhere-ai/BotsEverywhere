import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseLogMarkdown, serializeLogMarkdown } from '../src/org-markdown.ts'
import { readOrgDir, createOrgFiles } from '../src/template-server.ts'
import { parseRunLog } from '../src/run-log.ts'
import { readRunLogDir } from '../src/run-log-files.ts'
import { reportWatchError } from '../src/live-hub.ts'

const windowsLog =
  '\uFEFF# Run log 2026-10-17\r\n\r\n- 21:28 | Connector | - | sync routine | skipped | no processes folder in orgs/your-company, nothing to sync\r\n'

test('a PowerShell BOM and CRLF run log parses the Connector line', () => {
  const parsed = parseRunLog(windowsLog, '2026-10-17')
  assert.equal(parsed.skipped, 0)
  assert.equal(parsed.lines.length, 1)
  assert.equal(parsed.lines[0]?.bot, 'Connector')
  assert.equal(parsed.lines[0]?.status, 'skipped')
  assert.equal(parsed.lines[0]?.process, '-')
  assert.equal(parsed.lines[0]?.step, 'sync routine')
  assert.equal(parsed.lines[0]?.note, 'no processes folder in orgs/your-company, nothing to sync')
  assert.doesNotThrow(() => parseLogMarkdown(windowsLog))
  assert.equal(parseLogMarkdown(windowsLog).ok, false)
})

test('a mixed log folder keeps the hire event and ignores the run log and garbage', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'be-crash-'))
  try {
    const created = createOrgFiles(root, 'Your organization', 'Ada')
    assert.equal(created.ok, true)
    if (!created.ok) return
    const orgRoot = path.join(root, created.slug)
    const logDir = path.join(orgRoot, 'log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(
      path.join(logDir, 'existing-grok-bot.md'),
      serializeLogMarkdown({
        id: 'existing-grok-bot',
        orgId: created.slug,
        type: 'hire',
        timestamp: '2026-10-17T21:00:00.000Z',
        actorSeatId: 'you',
        actorType: 'human',
        summary: 'Hired an existing Grok Bot.',
      }),
      'utf8',
    )
    writeFileSync(path.join(logDir, '2026-10-17.md'), windowsLog, 'utf8')
    writeFileSync(path.join(logDir, 'garbage.md'), 'this is not a log\r\n', 'utf8')

    const read = readOrgDir(orgRoot, created.slug)
    assert.equal(read.ok, true, read.ok ? '' : read.errors.join('\n'))
    if (!read.ok) return
    assert.ok(read.bundle.activity.some((entry) => entry.id === 'existing-grok-bot'))
    const run = readRunLogDir(orgRoot)
    assert.equal(run.skipped, 0)
    assert.equal(run.lines.length, 1)
    assert.equal(run.lines[0]?.bot, 'Connector')
    assert.doesNotThrow(() => readOrgDir(orgRoot, created.slug))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a garbage file alone does not fail the org read', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'be-crash-'))
  try {
    const created = createOrgFiles(root, 'Desk', 'Ada')
    assert.equal(created.ok, true)
    if (!created.ok) return
    const orgRoot = path.join(root, created.slug)
    mkdirSync(path.join(orgRoot, 'log'), { recursive: true })
    writeFileSync(path.join(orgRoot, 'log', 'garbage.md'), '@@@ not frontmatter @@@', 'utf8')
    const read = readOrgDir(orgRoot, created.slug)
    assert.equal(read.ok, true, read.ok ? '' : read.errors.join('\n'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the watcher reports one bad file once', () => {
  const seen = new Set<string>()
  const lines: string[] = []
  const log = (line: string) => {
    lines.push(line)
  }
  reportWatchError(seen, 'orgs/your-company/log/garbage.md', new Error('bad'), log)
  reportWatchError(seen, 'orgs/your-company/log/garbage.md', new Error('bad'), log)
  assert.equal(lines.length, 1)
  assert.match(lines[0] ?? '', /Skipped orgs\/your-company\/log\/garbage\.md: bad/)
})

test('the client skips run logs and a tab crash stays inside its boundary', () => {
  const load = readFileSync(new URL('../../src/org/load.ts', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const boundary = readFileSync(new URL('../../src/components/TabBoundary.tsx', import.meta.url), 'utf8')
  const logsFor = load.slice(load.indexOf('function logsFor'), load.indexOf('const markdownOrgs'))
  assert.match(logsFor, /isRunLogName/)
  assert.equal(logsFor.includes('throw'), false)
  assert.match(load, /catch \{/)
  assert.match(workspace, /<TabBoundary/)
  assert.match(boundary, /This view could not load:/)
})
