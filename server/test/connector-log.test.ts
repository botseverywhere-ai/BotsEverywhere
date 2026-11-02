import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseLogMarkdown, serializeLogMarkdown } from '../src/org-markdown.ts'
import type { FileActivity } from '../src/org-files.ts'
import { MAX_DAY_RUNS, checkConnectorStopped, recordConnectorRun, withRun } from '../src/connector-log.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles } from '../src/template-server.ts'
import { isGrokEvent, logLabel, parseStats, runRows } from '../../src/components/sync-copy.ts'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-connector-log-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  return { orgs, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function org(orgs: string, name: string): string {
  const made = createOrgFiles(orgs, name, 'Ada')
  if (!made.ok) throw new Error('no org')
  return made.slug
}

function bot(orgs: string, slug: string, seat: string, title: string) {
  writeFileSync(join(orgs, slug, 'seats', `${seat}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\n---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

/** One Connector run: each org's snapshot, then connector.json, at a given file time. */
function run(orgs: string, at: Date, perOrg: Record<string, { name: string; runs30d?: number; routines?: { name: string }[] }[]>, unassigned = 0) {
  for (const [slug, bots] of Object.entries(perOrg)) {
    mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
    const path = join(orgs, slug, 'grok', 'snapshot.json')
    writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), bots, processes: [] }))
    utimesSync(path, at, at)
  }
  const path = join(orgs, CONNECTOR_FILE)
  writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), unassigned: Array.from({ length: unassigned }, (_, i) => ({ name: `Loose ${i}` })) }))
  utimesSync(path, at, at)
}

function events(orgs: string, slug: string): FileActivity[] {
  const dir = join(orgs, slug, 'log')
  return readdirSync(dir).flatMap((name) => {
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return []
    const parsed = parseLogMarkdown(readFileSync(join(dir, name), 'utf8'), name)
    return parsed.ok ? [parsed.event] : []
  })
}

const byKind = (list: FileActivity[], kind: string) => list.filter((event) => event.kind === kind)

test('a log event keeps its kind and stats, and older events still read', () => {
  const event: FileActivity = { id: 'e1', orgId: '', type: 'edit', actorSeatId: 'connector', actorType: 'bot', timestamp: '2026-10-18T15:35:00.000Z', summary: 'Connector runs today', kind: 'connector-run', stats: 'Runs today=2|In Grok Bot=4' }
  const text = serializeLogMarkdown(event)
  const parsed = parseLogMarkdown(text)
  assert.equal(parsed.ok && parsed.event.kind, 'connector-run')
  assert.equal(parsed.ok && parsed.event.stats, 'Runs today=2|In Grok Bot=4')
  const old = parseLogMarkdown(serializeLogMarkdown({ ...event, kind: undefined, stats: undefined }))
  assert.equal(old.ok && old.event.kind, undefined)
  assert.deepEqual(parseStats('Runs today=2|In Grok Bot=4|Last=15:35|broken'), [['Runs today', '2'], ['In Grok Bot', '4'], ['Last', '15:35']])
  assert.deepEqual(parseStats(undefined), [])
})

test('each log entry gets a plain label, and older entries without a kind still get one', () => {
  const base: FileActivity = { id: 'x', orgId: '', type: 'edit', actorSeatId: 'you', actorType: 'human', timestamp: '2026-10-18T15:35:00.000Z', summary: 's' }
  assert.equal(logLabel({ ...base, kind: 'connected' }), 'Connected')
  assert.equal(logLabel({ ...base, kind: 'bot-connected' }), 'Bot connected')
  assert.equal(logLabel({ ...base, kind: 'bot-disconnected' }), 'Bot left')
  assert.equal(logLabel({ ...base, kind: 'connector-run' }), 'Connector')
  assert.equal(logLabel({ ...base, kind: 'stopped' }), 'Stopped')
  assert.equal(logLabel({ ...base, kind: 'sync' }), 'Sync')
  assert.equal(logLabel({ ...base, id: 'sync-2026-10-18T15:36:42.138Z' }), 'Sync', 'an older sync line')
  assert.equal(logLabel({ ...base, id: 'grok-request-payment-bot-2026' }), 'Request', 'an older request line')
  assert.equal(logLabel({ ...base, type: 'hire' }), 'Hire')
  assert.equal(logLabel({ ...base, type: 'fire' }), 'Retired')
  assert.equal(isGrokEvent({ ...base, kind: 'connector-run' }), true)
  assert.equal(isGrokEvent({ ...base, grok: 'out' }), true)
  assert.equal(isGrokEvent({ ...base, type: 'hire' }), false)
})

test('the first Connector run logs Connected, each bot that connected with its numbers, and the day so far, per organization', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    const desk = org(p.orgs, 'Desk')
    bot(p.orgs, ledger, 'invoice-bot', 'Invoice Bot')
    bot(p.orgs, ledger, 'payment-bot', 'Payment Bot')
    run(p.orgs, new Date('2026-10-18T15:24:00.000Z'), {
      [ledger]: [{ name: 'Invoice Bot', runs30d: 12, routines: [{ name: 'Match invoices' }] }, { name: 'Payment Bot' }],
      [desk]: [],
    }, 28)
    recordConnectorRun(p.orgs, 'Connector - BotsEverywhere (k3f9)')
    const ledgerLog = events(p.orgs, ledger)
    assert.equal(byKind(ledgerLog, 'connected').length, 1)
    assert.equal(byKind(ledgerLog, 'connected')[0]!.summary, 'Connected to Grok Bot')
    const connected = byKind(ledgerLog, 'bot-connected')
    assert.deepEqual(connected.map((event) => [event.summary, event.subjectSeatId]).sort(), [['Invoice Bot connected to Grok Bot', 'invoice-bot'], ['Payment Bot connected to Grok Bot', 'payment-bot']])
    const invoice = connected.find((event) => event.subjectSeatId === 'invoice-bot')!
    assert.deepEqual(parseStats(invoice.stats), [['Routines', '1'], ['Runs (30d)', '12']])
    const day = byKind(ledgerLog, 'connector-run')
    assert.equal(day.length, 1)
    const stats = Object.fromEntries(parseStats(day[0]!.stats))
    assert.equal(stats['Runs today'], '1')
    assert.equal(stats['In Grok Bot'], '2')
    assert.equal(stats['Waiting'], '0')
    assert.equal(stats['No organization'], '28')
    const deskLog = events(p.orgs, desk)
    assert.equal(byKind(deskLog, 'connected').length, 1, 'every organization gets its own line')
    assert.equal(byKind(deskLog, 'bot-connected').length, 0)
    assert.equal(byKind(deskLog, 'connector-run').length, 1)
  } finally {
    p.done()
  }
})

test('later runs: the same run is never logged twice, the day line updates in place, and changes get their own lines', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    run(p.orgs, new Date('2026-10-18T15:24:00.000Z'), { [ledger]: [{ name: 'Invoice Bot' }, { name: 'Old Bot' }] })
    recordConnectorRun(p.orgs, 'Connector')
    recordConnectorRun(p.orgs, 'Connector')
    assert.equal(byKind(events(p.orgs, ledger), 'bot-connected').length, 2, 'the same run twice logs once')
    run(p.orgs, new Date('2026-10-18T15:39:00.000Z'), { [ledger]: [{ name: 'Invoice Bot' }, { name: 'Payment Bot' }] })
    recordConnectorRun(p.orgs, 'Connector')
    const log = events(p.orgs, ledger)
    assert.equal(byKind(log, 'connected').length, 1, 'still connected is not a new connection')
    assert.deepEqual(byKind(log, 'bot-connected').map((event) => event.summary).sort(), ['Invoice Bot connected to Grok Bot', 'Old Bot connected to Grok Bot', 'Payment Bot connected to Grok Bot'])
    assert.deepEqual(byKind(log, 'bot-disconnected').map((event) => event.summary), ['Old Bot is no longer in Grok Bot'])
    const day = byKind(log, 'connector-run')
    assert.equal(day.length, 1, 'one line per day, updated in place')
    assert.equal(Object.fromEntries(parseStats(day[0]!.stats))['Runs today'], '2')
  } finally {
    p.done()
  }
})

test('a missed run logs Connector stopped once, and the next run logs Connected again', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    run(p.orgs, new Date('2026-10-18T15:24:00.000Z'), { [ledger]: [] })
    recordConnectorRun(p.orgs, 'Connector')
    checkConnectorStopped(p.orgs, new Date('2026-10-18T15:40:00.000Z'))
    assert.equal(byKind(events(p.orgs, ledger), 'stopped').length, 0, 'not yet two missed runs')
    checkConnectorStopped(p.orgs, new Date('2026-10-18T16:00:00.000Z'))
    checkConnectorStopped(p.orgs, new Date('2026-10-18T16:30:00.000Z'))
    const stopped = byKind(events(p.orgs, ledger), 'stopped')
    assert.equal(stopped.length, 1, 'logged once')
    assert.equal(stopped[0]!.summary, 'Connector stopped')
    run(p.orgs, new Date('2026-10-18T17:00:00.000Z'), { [ledger]: [] })
    recordConnectorRun(p.orgs, 'Connector')
    assert.deepEqual(byKind(events(p.orgs, ledger), 'connected').map((event) => event.summary), ['Connected to Grok Bot', 'Connected to Grok Bot again'])
  } finally {
    p.done()
  }
})

test('a snapshot the app cannot read is logged with the reason, and nothing crashes', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    run(p.orgs, new Date('2026-10-18T15:24:00.000Z'), { [ledger]: [] })
    writeFileSync(join(p.orgs, ledger, 'grok', 'snapshot.json'), '{ broken')
    recordConnectorRun(p.orgs, 'Connector')
    const errors = byKind(events(p.orgs, ledger), 'connector-error')
    assert.equal(errors.length, 1)
    assert.equal(errors[0]!.summary, "Connector ran, but this organization's snapshot could not be read")
  } finally {
    p.done()
  }
})

/** HH:MM on this computer, the way the day line writes a run. */
const clock = (at: Date) => `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`

test('a log event keeps its list of runs, and an event without one still reads', () => {
  const event: FileActivity = { id: 'connector-day-2026-10-18', orgId: '', type: 'edit', actorSeatId: 'connector', actorType: 'bot', timestamp: '2026-10-18T15:39:00.000Z', summary: 'Connector runs today', kind: 'connector-run', grok: 'in', stats: 'Runs today=2', runs: ['Run=17:24|In Grok Bot=2|Waiting=0', 'Run=17:39|In Grok Bot=3|Waiting=1'] }
  const parsed = parseLogMarkdown(serializeLogMarkdown(event))
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.ok && parsed.event.runs, event.runs)
  const old = parseLogMarkdown(serializeLogMarkdown({ ...event, runs: undefined }))
  assert.ok(old.ok)
  assert.equal(old.ok && old.event.runs, undefined, 'a day line from before runs were listed reads the same')
})

test('every Connector run gets its own row on the day line, and the day stays one file', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    const first = new Date('2026-10-18T12:00:00.000Z')
    const second = new Date('2026-10-18T12:15:00.000Z')
    run(p.orgs, first, { [ledger]: [{ name: 'Invoice Bot' }] }, 3)
    recordConnectorRun(p.orgs, 'Connector')
    recordConnectorRun(p.orgs, 'Connector')
    run(p.orgs, second, { [ledger]: [{ name: 'Invoice Bot' }, { name: 'Payment Bot' }] }, 3)
    recordConnectorRun(p.orgs, 'Connector')
    const day = byKind(events(p.orgs, ledger), 'connector-run')
    assert.equal(day.length, 1, 'one file per day, never one per run')
    const rows = (day[0]!.runs ?? []).map((row) => Object.fromEntries(parseStats(row)))
    assert.deepEqual(rows.map((row) => row['Run']), [clock(first), clock(second)], 'the same run read twice adds one row')
    assert.deepEqual(rows.map((row) => row['In Grok Bot']), ['1', '2'])
    assert.deepEqual(rows.map((row) => row['No organization']), ['3', '3'])
    assert.equal(Object.fromEntries(parseStats(day[0]!.stats))['Runs today'], '2', 'the day figures stay as they were')
  } finally {
    p.done()
  }
})

test('the list of runs starts over on a new day, and the day before keeps its own', () => {
  const p = project()
  try {
    const ledger = org(p.orgs, 'Ledger')
    run(p.orgs, new Date('2026-10-18T12:00:00.000Z'), { [ledger]: [{ name: 'Invoice Bot' }] })
    recordConnectorRun(p.orgs, 'Connector')
    run(p.orgs, new Date('2026-10-19T12:00:00.000Z'), { [ledger]: [{ name: 'Invoice Bot' }] })
    recordConnectorRun(p.orgs, 'Connector')
    const days = byKind(events(p.orgs, ledger), 'connector-run')
    assert.equal(days.length, 2)
    assert.deepEqual(days.map((day) => day.runs?.length), [1, 1])
  } finally {
    p.done()
  }
})

test('a day keeps at most its latest runs, so the day line stays small', () => {
  const rows = Array.from({ length: MAX_DAY_RUNS }, (_, i) => `Run=${i}`)
  const next = withRun(rows, 'Run=last')
  assert.equal(next.length, MAX_DAY_RUNS)
  assert.equal(next[0], 'Run=1')
  assert.equal(next.at(-1), 'Run=last')
  assert.deepEqual(withRun([], 'Run=12:00'), ['Run=12:00'])
})

test('Logs lists each run under the day line, newest first, in plain words', () => {
  assert.deepEqual(runRows({ runs: ['Run=12:00|In Grok Bot=1|Waiting=0|No organization=3', 'Run=12:15|In Grok Bot=2|Performance updated=1|Waiting=0|No organization=3'] }), [
    '12:15 · In Grok Bot 2 · Performance updated 1 · Waiting 0 · No organization 3',
    '12:00 · In Grok Bot 1 · Waiting 0 · No organization 3',
  ])
  assert.deepEqual(runRows({}), [])
  const panel = readFileSync(new URL('../../src/components/LogPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /runRows\(event\)/)
  assert.match(panel, /Each run \(\{event\.runs\.length\}\)/)
})
