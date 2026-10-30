import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recordConnectorRun } from '../src/connector-log.ts'
import { performanceOnly, type SyncRow } from '../src/grok-sync.ts'
import { parseLogMarkdown } from '../src/org-markdown.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, syncStatus } from '../src/template-server.ts'
import { parseStats } from '../../src/components/sync-copy.ts'

const updated = (patch: SyncRow extends { kind: 'updated'; patch: infer P } ? P : never): SyncRow => ({ kind: 'updated', name: 'Bot', slug: 'bot', renamed: false, changes: ['x'], patch })

test("a row that changes nothing but Grok Bot's numbers applies on its own; anything else waits for Sync", () => {
  const stamp = { grokSync: 'synced' as const, grokSyncedAt: '2026-10-20T18:00:00Z' }
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5 })), true)
  assert.equal(performanceOnly(updated({ ...stamp, lastActive: '2026-10-20T17:00:00Z', tasksDone30d: 2, createdAt: '2026-10-01', routines: [{ name: 'Daily', schedule: '0 9 * * *' }] })), true)
  assert.equal(performanceOnly(updated({ ...stamp })), false, 'only a stamp (first seen): nothing to apply by itself')
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5, grokBotUrl: 'grokbot://x' })), false, 'a link')
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5, title: 'New Name', role: 'New Name' })), false, 'a name')
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5, owns: ['Rows'] })), false, 'a card fill')
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5, botStatus: 'paused' })), false, 'a run status')
  assert.equal(performanceOnly(updated({ ...stamp, runs30d: 5, grokMissingSince: null })), false, 'a bot that came back after Not in Grok Bot')
  assert.equal(performanceOnly(updated({ ...stamp, grokBotUrl: 'grokbot://x', grokMissingSince: null }), true), true, 'a bot the app asked to create, marked missing by a Sync that ran before it existed')
  assert.equal(performanceOnly(updated({ ...stamp, grokBotUrl: 'grokbot://x', grokMissingSince: null })), false, 'the same row for a bot nobody asked for still waits for Sync')
  assert.equal(performanceOnly({ kind: 'unchanged', name: 'Bot', slug: 'bot' }), false)
  assert.equal(performanceOnly({ kind: 'missing', name: 'Bot', slug: 'bot', write: true, patch: { grokSync: 'missing' } }), false)
})

function seat(root: string, slug: string, title: string, extra: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

test("on each Connector run, Grok Bot's numbers land in the seat files; new bots, links, names, and returns still wait for Sync", () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-auto-perf-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    if (!made.ok) throw new Error('no org')
    const root = join(orgs, made.slug)
    seat(root, 'invoice-bot', 'Invoice Bot', 'grokBotUrl: "grokbot://invoice"\nruns30d: 3\ngrokSync: synced\ngrokSyncedAt: "2026-10-20T10:00:00.000Z"\n')
    seat(root, 'old-bot', 'Old Bot', 'grokBotUrl: "grokbot://old"\ngrokSync: missing\ngrokMissingSince: "2026-10-19T10:00:00.000Z"\n')
    seat(root, 'renamed-bot', 'Renamed Bot', 'grokBotUrl: "grokbot://renamed"\ngrokSync: synced\n')
    const at = new Date()
    const syncedAt = at.toISOString()
    mkdirSync(join(root, 'grok'), { recursive: true })
    const snapshot = join(root, 'grok', 'snapshot.json')
    writeFileSync(snapshot, JSON.stringify({
      syncedAt,
      bots: [
        { name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice', runs30d: 5, tasksDone30d: 2, lastActive: '2026-10-20T17:30:00+02:00', routines: [{ name: 'Invoice arrives', schedule: 'email', lastRun: '2026-10-20T17:30:00+02:00' }] },
        { name: 'Old Bot', grokBotUrl: 'grokbot://old', runs30d: 1 },
        { name: 'Renamed Bot New', grokBotUrl: 'grokbot://renamed', runs30d: 9 },
        { name: 'Fresh Bot', grokBotUrl: 'grokbot://fresh', runs30d: 4 },
      ],
      processes: [],
    }))
    utimesSync(snapshot, at, at)
    const connector = join(orgs, CONNECTOR_FILE)
    writeFileSync(connector, JSON.stringify({ syncedAt, unassigned: [] }))
    utimesSync(connector, at, at)

    recordConnectorRun(orgs, 'Connector')

    const invoice = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
    assert.match(invoice, /runs30d: 5/)
    assert.match(invoice, /tasksDone30d: 2/)
    assert.match(invoice, /lastActive: "2026-10-20T15:30:00\.000Z"/, 'the parser keeps times as UTC')
    assert.match(invoice, /routines: /)
    assert.match(invoice, new RegExp(`grokSyncedAt: "${syncedAt}"`), 'the report time is stamped, so Performance knows the counts are as of this report')
    assert.match(readFileSync(join(root, 'seats', 'old-bot.md'), 'utf8'), /grokSync: missing/, 'a bot that came back is for Sync to confirm')
    assert.match(readFileSync(join(root, 'seats', 'renamed-bot.md'), 'utf8'), /title: Renamed Bot\n/, 'a name change is for Sync')
    assert.doesNotMatch(readFileSync(join(root, 'seats', 'renamed-bot.md'), 'utf8'), /runs30d/, 'its numbers wait with it')
    assert.equal(readdirSync(join(root, 'seats')).includes('fresh-bot.md'), false, 'a new bot is for Sync')

    const status = syncStatus(root, made.slug, orgs)
    assert.equal(status.ok, true)
    if (!status.ok) return
    assert.deepEqual(status.status.plan!.rows.filter((row) => row.kind !== 'unchanged').map((row) => [row.kind, row.name]).sort(), [['new', 'Fresh Bot'], ['updated', 'Old Bot'], ['updated', 'Renamed Bot']])
    assert.equal(status.status.plan!.writes, 3, 'the Sync button counts only what still needs you')

    const day = readdirSync(join(root, 'log')).filter((name) => name.startsWith('connector-day-'))[0]!
    const parsed = parseLogMarkdown(readFileSync(join(root, 'log', day), 'utf8'), day)
    assert.equal(parsed.ok && Object.fromEntries(parseStats(parsed.event.stats))['Performance updated'], '1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Sync drawer and Docs say the numbers apply on their own', () => {
  const drawer = readFileSync(new URL('../../src/components/SyncDrawer.tsx', import.meta.url), 'utf8')
  const docs = readFileSync(new URL('../../src/pages/DocsPage.tsx', import.meta.url), 'utf8')
  assert.match(drawer, /Grok Bot&apos;s numbers \(last active, runs, tasks, routines\) apply on their own on every Connector run\./)
  assert.match(docs, /apply on their own on every Connector run/)
})
