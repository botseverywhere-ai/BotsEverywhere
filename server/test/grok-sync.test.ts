import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSeatMarkdown, serializeSeat, serializeExistingSeat } from '../src/org-files.ts'

test('sync fields round-trip on an existing-source seat and a full seat', () => {
  const existing = serializeExistingSeat({
    name: 'Invoice Bot',
    grokBotUrl: 'grokbot://app/v1/agent?id=abc',
    reportsTo: 'you',
    owns: ['Match the invoice'],
    may: ['Read the bill'],
    mustAskBefore: ['Pay the vendor'],
    doneWhen: ['The match is recorded'],
    runs30d: 14,
    grokSync: 'synced',
    grokSyncedAt: '2026-10-17T20:10:00.000Z',
  })
  assert.match(existing, /^grokSync: synced$/m)
  assert.match(existing, /^grokSyncedAt: /m)
  const parsed = parseSeatMarkdown('invoice-bot', existing)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.seat.grokSync, 'synced')
  assert.equal(parsed.seat.grokSyncedAt, '2026-10-17T20:10:00.000Z')
  assert.equal(parsed.seat.runs30d, 14)
  const again = parseSeatMarkdown('invoice-bot', serializeSeat(parsed.seat))
  assert.equal(again.ok, true)
  if (!again.ok) return
  assert.equal(again.seat.runs30d, 14, 'serializeSeat must keep imported metrics on an existing-source seat')
  assert.equal(again.seat.grokSync, 'synced')

  const full = parseSeatMarkdown('research', [
    '---',
    'title: Research',
    'department: general',
    'reportsTo: you',
    'addToGrokBotUrl: ""',
    'status: active',
    'kind: bot',
    'role: Research',
    'personId: ""',
    'hiredAt: ""',
    'retiredAt: ""',
    'directoryId: research-bot',
    'grokBotUrl: "https://example.com/bot/research"',
    'grokSync: missing',
    'grokMissingSince: "2026-10-17T20:10:00.000Z"',
    '---',
    '',
    '## Owns',
    'Briefs',
    '',
    '## May',
    'Read',
    '',
    '## Needs approval',
    'Publish',
    '',
    '## Done when',
    'Sourced',
    '',
  ].join('\n'))
  assert.equal(full.ok, true)
  if (!full.ok) return
  assert.equal(full.seat.grokSync, 'missing')
  assert.equal(full.seat.grokMissingSince, '2026-10-17T20:10:00.000Z')
  const rewritten = serializeSeat(full.seat)
  assert.match(rewritten, /^grokBotUrl: /m, 'a full-format seat must keep its grokBotUrl')
  assert.match(rewritten, /^grokSync: missing$/m)
  const unknown = parseSeatMarkdown('x', existing.replace('grokSync: synced', 'grokSync: maybe'))
  assert.equal(unknown.ok, true)
  if (!unknown.ok) return
  assert.equal(unknown.seat.grokSync, undefined)
})

import { orgChange } from '../src/live-hub.ts'
import { connectorPrompt, SNAPSHOT_PATH } from '../src/connector-prompt.ts'

test('the watcher maps the snapshot file to a grok event', () => {
  assert.deepEqual(orgChange('C:/x/orgs', 'your-company/grok/snapshot.json'), { slug: 'your-company', kind: 'grok' })
  assert.deepEqual(orgChange('/x/orgs', '/x/orgs/your-company/grok/snapshot.json'), { slug: 'your-company', kind: 'grok' })
  assert.deepEqual(orgChange('/x/orgs', 'your-company/seats/you.md'), { slug: 'your-company', kind: 'org' })
  assert.deepEqual(orgChange('C:/x/orgs', 'C:\\x\\orgs\\your-company\\profiles\\x-com.md'), { slug: 'your-company', kind: 'grok' }, "a bot's own profile refreshes what Grok Bot shows")
})

test('the Connector prompt writes the snapshot, runs on a schedule, and never edits app files', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: 'orgs' })
  assert.equal(SNAPSHOT_PATH, 'grok/snapshot.json')
  assert.match(prompt, /Run this routine every 15 minutes\./)
  assert.match(prompt, /Write <org>\/grok\/snapshot\.json/)
  assert.match(prompt, /UTF-8 without a byte-order mark and with LF line endings/)
  assert.match(prompt, /Never edit org\.md, seats\/, processes\/, work-chart\.md, grok\/requests\.json, or project\.json/)
  assert.match(prompt, /tell that bot who its manager is/)
  assert.match(prompt, /- HH:MM \| bot \| process \| step \| done\|failed\|skipped\|waiting\|running \| note or -/)
  assert.match(prompt, /"syncedAt": "ISO datetime of now"/, 'the Connector prompt carries the snapshot format itself')
  assert.match(prompt, /"bots": \[/)
  assert.match(prompt, /"processes": \[/)
  assert.match(prompt, /Never estimate or invent numbers\./)
})

test('a bot created by a sync arrives without a flow for its routine; flows come from the Work Chart import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-sync-fresh-'))
  try {
    const created = createOrgFiles(dir, 'Desk', 'Ada')
    assert.equal(created.ok, true)
    if (!created.ok) return
    const root = join(dir, created.slug)
    writeSnapshot(root, {
      syncedAt: SNAP,
      bots: [{ name: 'Fresh Bot', owns: ['Fresh things'] }],
      processes: [{ name: 'Fresh routine', trigger: { type: 'manual' }, steps: [{ seat: 'Fresh Bot', action: 'Do it' }], doneWhen: 'Done' }],
    })
    const status = syncStatus(root, created.slug)
    assert.equal(status.ok, true)
    if (!status.ok || !status.status.plan) return
    const applied = applySync(root, created.slug, status.status.plan)
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.deepEqual(applied.errors, [])
    assert.equal(existsSync(join(root, 'seats', 'fresh-bot.md')), true)
    assert.equal(existsSync(join(root, 'processes', 'fresh-routine.md')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBotsFile, resolveManager } from '../src/bots-file.ts'
import { createOrgFiles, importBotsFile, readOrgDir } from '../src/template-server.ts'

test('importBotsFile stamps new seats as new from a sync', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-sync-stamp-'))
  try {
    const created = createOrgFiles(dir, 'Desk', 'Ada')
    assert.equal(created.ok, true)
    if (!created.ok) return
    const root = join(dir, created.slug)
    const parsed = parseBotsFile(JSON.stringify({ bots: [{ name: 'Invoice Bot', reportsTo: 'You' }] }))
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const result = importBotsFile(root, created.slug, parsed.rows, { grokSync: 'new', grokSyncedAt: '2026-10-17T20:10:00.000Z' })
    assert.deepEqual(result.errors, [])
    const file = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
    assert.match(file, /^grokSync: new$/m)
    assert.match(file, /^grokSyncedAt: "2026-10-17T20:10:00\.000Z"$/m)
    assert.equal(file.charCodeAt(0) !== 0xfeff && !file.includes('\r'), true)
    const read = readOrgDir(root, created.slug)
    assert.equal(read.ok, true)
    if (!read.ok) return
    assert.equal(read.bundle.seats.find((seat) => seat.slug === 'invoice-bot')?.grokSync, 'new')
    assert.equal(resolveManager('You', 'Invoice Bot', [{ slug: 'you', title: 'Ada' }], new Map()).ok, true)
    const self = resolveManager('Invoice Bot', 'Invoice Bot', [], new Map())
    assert.equal(self.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { parseSnapshot, planSync, patchSeatSource, summaryLine } from '../src/grok-sync.ts'
import { formatShortDate } from '../src/bot-metrics.ts'
import type { SeatDocument } from '../src/org-files.ts'
import type { ProcessFile } from '../src/processes.ts'

function seat(patch: Partial<SeatDocument> & { slug: string; title: string }): SeatDocument {
  const base: SeatDocument = {
    slug: patch.slug,
    title: patch.title,
    department: 'general',
    reportsTo: 'you',
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'bot',
    role: patch.title,
    personId: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    seatOrigin: 'existing',
    grokBotUrl: '',
    owns: ['Owns it'],
    may: ['May do it'],
    mustAskBefore: ['Ask first'],
    doneWhen: ['Done'],
    source: '',
  }
  const next = { ...base, ...patch }
  next.source = serializeSeat(next)
  return next
}

const you: SeatDocument = seat({ slug: 'you', title: 'You', kind: 'human', reportsTo: '', seatOrigin: '', role: 'Founder', owns: [], may: [], mustAskBefore: [], doneWhen: [] })

const SNAP = '2026-10-17T20:10:00.000Z'

function snapshotOf(bots: unknown[], processes: unknown[] = []): ReturnType<typeof parseSnapshot> {
  return parseSnapshot(JSON.stringify({ syncedAt: SNAP, bots, processes }), '2026-01-01T00:00:00.000Z')
}

test('a snapshot parses with a BOM and CRLF and fails softly when broken', () => {
  const text = '﻿{\r\n "syncedAt": "2026-10-17T20:10:00Z",\r\n "bots": [{ "name": "Invoice Bot" }],\r\n "processes": []\r\n}\r\n'
  const parsed = parseSnapshot(text, '2026-01-01T00:00:00.000Z')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.snapshot.syncedAt, '2026-10-17T20:10:00.000Z')
  assert.equal(parsed.snapshot.bots[0]?.name, 'Invoice Bot')
  assert.deepEqual(parsed.snapshot.processes, [])
  const noStamp = parseSnapshot('{"bots":[{"name":"Solo Bot"}]}', '2026-01-01T00:00:00.000Z')
  assert.equal(noStamp.ok, true)
  if (!noStamp.ok) return
  assert.equal(noStamp.snapshot.syncedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(noStamp.snapshot.bots[0]?.name, 'Solo Bot')
  // The project Connector does not list itself, so an org whose bots are not in Grok Bot yet gets an empty list.
  assert.deepEqual(parseSnapshot('{"syncedAt":"2026-10-18T17:24:21+02:00","bots":[],"processes":[]}', SNAP), { ok: true, snapshot: { syncedAt: '2026-10-18T15:24:21.000Z', bots: [], processes: [] } })
  assert.deepEqual(parseSnapshot('not json', SNAP), { ok: false, error: 'This file is not JSON.' })
  assert.deepEqual(parseSnapshot('{"routines":[]}', SNAP), { ok: false, error: 'The snapshot needs a bots list.' })
  assert.deepEqual(parseSnapshot('[]', SNAP), { ok: false, error: 'The snapshot must be a JSON object with a bots list.' })
})

test('planSync sorts bots into new, updated, unchanged, and missing under the authority rule', () => {
  const invoice = seat({ slug: 'invoice-bot', title: 'Invoice Bot', grokBotUrl: 'grokbot://app/v1/agent?id=inv', runs30d: 3, reportsTo: 'you' })
  const quiet = seat({ slug: 'quiet-bot', title: 'Quiet Bot' })
  const gone = seat({ slug: 'gone-bot', title: 'Gone Bot' })
  const flagged = seat({ slug: 'flagged-bot', title: 'Flagged Bot', grokSync: 'missing', grokMissingSince: '2026-10-10T00:00:00.000Z' })
  const retired = seat({ slug: 'old-bot', title: 'Old Bot', status: 'retired', retiredAt: '2026-10-01T00:00:00.000Z' })
  const empty = seat({ slug: 'empty-bot', title: 'Empty Bot', owns: [], doneWhen: [] })
  const parsed = snapshotOf([
    { name: 'Invoice Bot', grokBotUrl: 'grokbot://app/v1/agent?id=inv', reportsTo: 'Quiet Bot', runs30d: 5, tasksDone30d: 2, lastActive: '2026-10-17T19:00:00Z', routines: [{ name: 'Match', schedule: 'weekdays 08:30' }], owns: ['Something else'] },
    { name: 'Quiet Bot' },
    { name: 'Old Bot', runs30d: 1 },
    { name: 'Empty Bot', owns: ['From Grok'], doneWhen: 'All matched', may: ['Ignored, already filled'] },
    { name: 'Brand New Bot', reportsTo: 'Invoice Bot' },
    { name: 'Orphan Bot', reportsTo: 'Nobody Here' },
    { name: 'Flagged Bot' },
    { grokBotUrl: 'grokbot://app/v1/agent?id=noname' },
  ])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [you, invoice, quiet, gone, flagged, retired, empty], [])
  const byName = new Map(plan.rows.map((row) => [row.name, row]))

  const inv = byName.get('Invoice Bot')
  assert.equal(inv?.kind, 'updated')
  if (inv?.kind !== 'updated') return
  assert.deepEqual(inv.changes, [`last active ${formatShortDate('2026-10-17T19:00:00Z')}`, '5 runs', '2 tasks', '1 routine', 'first seen'])
  assert.equal(inv.patch.runs30d, 5)
  assert.equal(inv.patch.grokSync, 'synced')
  assert.equal(inv.patch.grokSyncedAt, SNAP)
  assert.equal(inv.patch.owns, undefined, 'a filled card section is never overwritten')
  assert.equal('reportsTo' in inv.patch, false, 'the manager is never taken from the snapshot')

  const quietRow = byName.get('Quiet Bot')
  assert.equal(quietRow?.kind, 'updated', 'a first match is stamped synced once')
  if (quietRow?.kind === 'updated') assert.deepEqual(quietRow.changes, ['first seen'])

  const old = byName.get('Old Bot')
  assert.equal(old?.kind, 'updated', 'a retired seat still takes facts and is not recreated')
  if (old?.kind === 'updated') assert.equal(old.patch.runs30d, 1)

  const emptyRow = byName.get('Empty Bot')
  assert.equal(emptyRow?.kind, 'updated')
  if (emptyRow?.kind === 'updated') {
    assert.deepEqual(emptyRow.patch.owns, ['From Grok'])
    assert.deepEqual(emptyRow.patch.doneWhen, ['All matched'])
    assert.equal(emptyRow.patch.may, undefined)
    assert.deepEqual(emptyRow.changes, ['Owns filled', 'Done when filled', 'first seen'])
  }

  const fresh = byName.get('Brand New Bot')
  assert.equal(fresh?.kind, 'new')
  if (fresh?.kind === 'new') assert.equal(fresh.bot.reportsTo, 'Invoice Bot')

  const orphan = byName.get('Orphan Bot')
  assert.equal(orphan?.kind, 'new')
  if (orphan?.kind === 'new') {
    assert.equal(orphan.bot.reportsTo, 'You')
    assert.match(orphan.note, /Nobody Here is not a seat here, placed under You\./)
  }

  const found = byName.get('Flagged Bot')
  assert.equal(found?.kind, 'updated')
  if (found?.kind === 'updated') {
    assert.deepEqual(found.changes, ['found again'])
    assert.equal(found.patch.grokMissingSince, null)
  }

  const missing = byName.get('Gone Bot')
  assert.equal(missing?.kind, 'missing')
  if (missing?.kind === 'missing') {
    assert.equal(missing.write, true)
    assert.equal(missing.patch.grokMissingSince, SNAP)
  }
  assert.equal(byName.get('You'), undefined, 'humans are never flagged')
  assert.equal(byName.get('Bot 8')?.kind, 'skipped')

  assert.deepEqual(plan.counts, { new: 2, missing: 1, updated: 5, processes: 0, warnings: 0, unchanged: 0 })
  assert.equal(plan.writes, 8)
  assert.equal(summaryLine(plan.counts), '2 new, 1 missing, 5 updated')
  assert.equal(summaryLine({ new: 0, missing: 0, updated: 0, processes: 1, warnings: 0, unchanged: 3 }), '1 new process')
  assert.equal(summaryLine({ new: 0, missing: 0, updated: 0, processes: 0, warnings: 2, unchanged: 3 }), 'Nothing to sync')
})

test('planSync matches by link first and treats a changed name as a rename', () => {
  const bot = seat({ slug: 'ledger-bot', title: 'Ledger Bot', grokBotUrl: 'grokbot://app/v1/agent?id=ledger' })
  const parsed = snapshotOf([{ name: 'Books Bot', grokBotUrl: 'grokbot://app/v1/agent?id=ledger' }])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [you, bot], [])
  const row = plan.rows.find((item) => item.kind === 'updated')
  assert.equal(row?.kind, 'updated')
  if (row?.kind !== 'updated') return
  assert.equal(row.renamed, true)
  assert.equal(row.patch.title, 'Books Bot')
  assert.equal(row.patch.role, 'Books Bot')
  assert.deepEqual(row.changes, ['name → Books Bot', 'first seen'])
  assert.equal(plan.rows.some((item) => item.kind === 'new'), false)
  assert.equal(plan.rows.some((item) => item.kind === 'missing'), false)
})

test('planSync never matches a human seat, even by name', () => {
  const ada = seat({ slug: 'ada', title: 'Ada', kind: 'human', reportsTo: '', seatOrigin: '', role: 'Founder', owns: [], may: [], mustAskBefore: [], doneWhen: [] })
  const parsed = snapshotOf([{ name: 'Ada', runs30d: 9, owns: ['Bot things'] }])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [ada], [])
  assert.equal(plan.rows.some((row) => row.kind === 'updated' && row.slug === 'ada'), false, 'a human seat is never patched by a sync')
  assert.equal(plan.rows.some((row) => row.kind === 'new' && row.name === 'Ada'), true, 'the bot called Ada becomes its own seat')
})

test('planSync lists a duplicated snapshot bot once as updated and once as new', () => {
  const bot = seat({ slug: 'inbox-bot', title: 'Inbox Bot' })
  const parsed = snapshotOf([{ name: 'Inbox Bot', runs30d: 1 }, { name: 'Inbox Bot', runs30d: 2 }])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [you, bot], [])
  assert.deepEqual(plan.rows.map((row) => row.kind).sort(), ['new', 'updated'])
})

test('planSync never turns a routine into a flow; it warns on a schedule mismatch with an existing one', () => {
  const existing: ProcessFile = {
    slug: 'daily-brief',
    name: 'Daily brief',
    trigger: { type: 'schedule', schedule: 'weekdays 08:00', source: '', description: '' },
    steps: [{ seat: 'you', action: 'Read it' }],
    doneWhen: 'Read',
    next: '',
    notes: '',
  }
  const parsed = snapshotOf([{ name: 'Daily Bot' }], [
    { name: 'Daily brief', trigger: { type: 'schedule', schedule: '0 9 * * 1-5' }, steps: [{ seat: 'You', action: 'Read it' }] },
    { name: 'Invoice arrives', trigger: { type: 'event', source: 'email' }, steps: [{ seat: 'You', action: 'Approve' }], doneWhen: 'Approved' },
    { name: 'Invoice arrives', trigger: { type: 'manual' } },
    { trigger: { type: 'manual' } },
  ])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [you], [existing])
  const kinds = plan.rows.map((row) => `${row.kind}:${row.name}`)
  assert.deepEqual(kinds, ['new:Daily Bot', 'schedule:Daily brief', 'skipped:Process'], 'Invoice arrives has no flow and stays only a routine: flows come from the Work Chart import')
  const warning = plan.rows[0]
  if (warning?.kind === 'schedule') {
    assert.equal(warning.process, 'weekdays 08:00')
    assert.equal(warning.routine, '0 9 * * 1-5')
  }
  assert.equal(plan.counts.processes, 0)
  assert.equal(plan.counts.warnings, 1)
  assert.equal(plan.writes, 1)
})

test('patchSeatSource rewrites a Grok-written seat without a BOM, with LF, keeping the card', () => {
  const windows = '﻿---\r\nname: Invoice Bot\r\nkind: bot\r\nsource: existing\r\ngrokBotUrl: ""\r\nreportsTo: you\r\n---\r\n\r\n## Owns\r\nMatch it\r\n\r\n## May\r\nRead\r\n\r\n## Needs approval\r\nPay\r\n\r\n## Done when\r\n\r\n'
  const patched = patchSeatSource('invoice-bot', windows, {
    grokSync: 'synced',
    grokSyncedAt: SNAP,
    grokBotUrl: 'grokbot://app/v1/agent?id=inv',
    runs30d: 4,
    doneWhen: ['Recorded'],
    grokMissingSince: null,
  })
  assert.equal(patched.ok, true)
  if (!patched.ok) return
  assert.equal(patched.source.charCodeAt(0) === 0xfeff, false)
  assert.equal(patched.source.includes('\r'), false)
  const seatBack = parseSeatMarkdown('invoice-bot', patched.source)
  assert.equal(seatBack.ok, true)
  if (!seatBack.ok) return
  assert.deepEqual(seatBack.seat.owns, ['Match it'])
  assert.deepEqual(seatBack.seat.doneWhen, ['Recorded'])
  assert.equal(seatBack.seat.grokBotUrl, 'grokbot://app/v1/agent?id=inv')
  assert.equal(seatBack.seat.runs30d, 4)
  assert.equal(seatBack.seat.grokSync, 'synced')
  assert.equal(seatBack.seat.reportsTo, 'you')
  const renamed = patchSeatSource('invoice-bot', patched.source, { grokSync: 'synced', title: 'Bills Bot', role: 'Bills Bot' })
  assert.equal(renamed.ok, true)
  if (!renamed.ok) return
  assert.match(renamed.source, /^name: Bills Bot$/m)
  assert.equal(patchSeatSource('x', 'garbage', { grokSync: 'synced' }).ok, false)
})

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { applySync, readSnapshot, startTemplateServer, syncStatus } from '../src/template-server.ts'

function writeSnapshot(root: string, body: unknown, options: { bom?: boolean } = {}) {
  mkdirSync(join(root, 'grok'), { recursive: true })
  const text = `${options.bom ? '﻿' : ''}${JSON.stringify(body, null, 2).replace(/\n/g, '\r\n')}`
  writeFileSync(join(root, 'grok', 'snapshot.json'), text, 'utf8')
}

test('syncStatus reads the snapshot, applySync writes the merge once, and nothing is deleted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-sync-apply-'))
  try {
    const created = createOrgFiles(dir, 'Desk', 'Ada')
    assert.equal(created.ok, true)
    if (!created.ok) return
    const root = join(dir, created.slug)
    const seeded = parseBotsFile(JSON.stringify({ bots: [
      { name: 'Invoice Bot', owns: ['Match'], may: ['Read'], needsApproval: ['Pay'], doneWhen: 'Recorded' },
      { name: 'Gone Bot', owns: ['Nothing'], may: ['Nothing'], needsApproval: ['Nothing'], doneWhen: 'Never' },
    ] }))
    assert.equal(seeded.ok, true)
    if (!seeded.ok) return
    const first = importBotsFile(root, created.slug, seeded.rows)
    assert.deepEqual(first.errors, [])

    const empty = syncStatus(root, created.slug)
    assert.equal(empty.ok, true)
    if (!empty.ok) return
    assert.equal(empty.status.snapshot, null)
    assert.equal(empty.status.plan, null)
    assert.equal(empty.status.lastConfirmed, '')
    assert.equal(empty.status.folder, root, 'the status carries the absolute org folder so the Connector prompt can name it')

    writeSnapshot(root, {
      syncedAt: '2026-10-17T20:10:00Z',
      bots: [
        { name: 'Invoice Bot', grokBotUrl: 'grokbot://app/v1/agent?id=inv', runs30d: 7 },
        { name: 'Brand New Bot', reportsTo: 'Invoice Bot', owns: ['New things'] },
      ],
      processes: [{ name: 'Invoice arrives', trigger: { type: 'event', source: 'email' }, steps: [{ seat: 'Invoice Bot', action: 'Match it' }], doneWhen: 'Matched' }],
    }, { bom: true })

    const read = readSnapshot(root)
    assert.equal(read.ok, true)
    if (!read.ok) return
    assert.equal(read.snapshot.syncedAt, '2026-10-17T20:10:00.000Z')
    assert.match(read.stamp, /^\d+:\d+$/)

    const status = syncStatus(root, created.slug)
    assert.equal(status.ok, true)
    if (!status.ok || !status.status.plan) return
    assert.deepEqual(status.status.plan.counts, { new: 1, missing: 1, updated: 1, processes: 0, warnings: 0, unchanged: 0 })

    const applied = applySync(root, created.slug, status.status.plan)
    assert.equal(applied.ok, true)
    if (!applied.ok) return
    assert.deepEqual(applied.errors, [])
    assert.equal(applied.summary, '1 new, 1 missing, 1 updated')
    const seatNames = readdirSync(join(root, 'seats')).sort()
    assert.deepEqual(seatNames, ['brand-new-bot.md', 'gone-bot.md', 'invoice-bot.md', 'you.md'], 'nothing deleted, one seat added')
    const invoice = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
    assert.match(invoice, /^runs30d: 7$/m)
    assert.match(invoice, /^grokSync: synced$/m)
    assert.match(invoice, /^## Owns\nMatch$/m, 'the filled card stays')
    const gone = readFileSync(join(root, 'seats', 'gone-bot.md'), 'utf8')
    assert.match(gone, /^grokSync: missing$/m)
    assert.match(gone, /^grokMissingSince: "2026-10-17T20:10:00\.000Z"$/m)
    assert.doesNotMatch(gone, /^status: retired$/m)
    const fresh = readFileSync(join(root, 'seats', 'brand-new-bot.md'), 'utf8')
    assert.match(fresh, /^reportsTo: invoice-bot$/m)
    assert.match(fresh, /^grokSync: new$/m)
    assert.equal(existsSync(join(root, 'processes', 'invoice-arrives.md')), false, 'a routine never becomes a flow by itself')
    for (const name of seatNames.map((item) => join('seats', item))) {
      const text = readFileSync(join(root, name), 'utf8')
      assert.equal(text.charCodeAt(0) === 0xfeff, false, `${name} has no BOM`)
      assert.equal(text.includes('\r'), false, `${name} uses LF`)
    }
    const after = readOrgDir(root, created.slug)
    assert.equal(after.ok, true)
    if (!after.ok) return
    const syncEvents = after.bundle.activity.filter((event) => event.id.startsWith('sync-'))
    assert.equal(syncEvents.length, 1)
    assert.match(syncEvents[0]!.summary, /^Synced with Grok Bot: 1 new, 1 missing, 1 updated$/)

    const second = syncStatus(root, created.slug)
    assert.equal(second.ok, true)
    if (!second.ok || !second.status.plan) return
    assert.equal(second.status.lastConfirmed, syncEvents[0]!.timestamp)
    const flips = second.status.plan.rows.filter((row) => row.kind === 'updated')
    assert.deepEqual(flips.map((row) => row.kind === 'updated' && row.changes), [['no longer new']], 'the second sync only clears the New tag')
    assert.equal(second.status.plan.writes, 1)
    const again = applySync(root, created.slug, second.status.plan)
    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.deepEqual(again.files, [`orgs/${created.slug}/seats/brand-new-bot.md`])
    assert.match(readFileSync(join(root, 'seats', 'brand-new-bot.md'), 'utf8'), /^grokSync: synced$/m)

    const third = syncStatus(root, created.slug)
    assert.equal(third.ok, true)
    if (!third.ok || !third.status.plan) return
    assert.equal(third.status.plan.writes, 0, 'the same snapshot applies to nothing once every seat is synced')
    const once = applySync(root, created.slug, third.status.plan)
    assert.equal(once.ok, true)
    if (!once.ok) return
    assert.deepEqual(once.files, [])
    const stillTwo = readOrgDir(root, created.slug)
    if (stillTwo.ok) assert.equal(stillTwo.bundle.activity.filter((event) => event.id.startsWith('sync-')).length, 2, 'a sync that writes nothing logs nothing')

    writeFileSync(join(root, 'grok', 'snapshot.json'), 'not json', 'utf8')
    const broken = syncStatus(root, created.slug)
    assert.equal(broken.ok, true)
    if (!broken.ok) return
    assert.equal(broken.status.error, 'This file is not JSON.')
    assert.equal(broken.status.plan, null)
    assert.equal(readOrgDir(root, created.slug).ok, true, 'a broken snapshot never breaks the org')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the sync routes preview, apply, and refuse a stale stamp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-sync-routes-'))
  const created = createOrgFiles(dir, 'Desk', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api/orgs/${created.slug}`
  try {
    const none = await fetch(`${base}/sync`)
    assert.equal(none.status, 200)
    assert.equal(((await none.json()) as { snapshot: unknown }).snapshot, null)

    const preview = await fetch(`${base}/sync/preview`, { method: 'POST', body: JSON.stringify({ bots: [{ name: 'Pasted Bot' }] }) })
    assert.equal(preview.status, 200)
    const previewBody = (await preview.json()) as { plan: { counts: { new: number } } }
    assert.equal(previewBody.plan.counts.new, 1)
    assert.equal(existsSync(join(root, 'seats', 'pasted-bot.md')), false, 'preview writes nothing')

    const badPreview = await fetch(`${base}/sync/preview`, { method: 'POST', body: 'nope' })
    assert.equal(badPreview.status, 422)

    writeSnapshot(root, { syncedAt: '2026-10-17T20:10:00Z', bots: [{ name: 'File Bot' }] })
    const status = (await (await fetch(`${base}/sync`)).json()) as { snapshot: { stamp: string } }
    const stale = await fetch(`${base}/sync/apply`, { method: 'POST', body: JSON.stringify({ source: 'file', stamp: 'old:1' }) })
    assert.equal(stale.status, 409)
    const unstamped = await fetch(`${base}/sync/apply`, { method: 'POST', body: JSON.stringify({ source: 'file' }) })
    assert.equal(unstamped.status, 422, 'applying the file without the preview stamp is refused')
    const applied = await fetch(`${base}/sync/apply`, { method: 'POST', body: JSON.stringify({ source: 'file', stamp: status.snapshot.stamp }) })
    assert.equal(applied.status, 200)
    const appliedBody = (await applied.json()) as { ok: boolean; summary: string }
    assert.equal(appliedBody.summary, '1 new')
    assert.equal(existsSync(join(root, 'seats', 'file-bot.md')), true)

    const pasted = await fetch(`${base}/sync/apply`, { method: 'POST', body: JSON.stringify({ source: 'json', json: JSON.stringify({ bots: [{ name: 'Pasted Bot' }] }) }) })
    assert.equal(pasted.status, 200)
    assert.equal(existsSync(join(root, 'seats', 'pasted-bot.md')), true)

    const missingFile = await fetch(`http://127.0.0.1:${started.port}/api/orgs/nope/sync`)
    assert.equal(missingFile.status, 404)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

import { quote } from '../src/org-files.ts'

test('a snapshot cannot inject frontmatter lines or card headings into a seat file', () => {
  const bot = seat({ slug: 'ledger-bot', title: 'Ledger Bot', grokBotUrl: 'grokbot://app/v1/agent?id=ledger', reportsTo: 'you', owns: [] })
  const parsed = snapshotOf([
    { name: 'Ledger Bot\nreportsTo: ledger-bot', grokBotUrl: 'grokbot://app/v1/agent?id=ledger', owns: ['## May', 'Keep the books\nreportsTo: nobody'] },
    { name: 'New\nBot', owns: ['## Owns', '---', 'Real work'] },
  ])
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const plan = planSync(parsed.snapshot, [you, bot], [])
  const row = plan.rows.find((item) => item.kind === 'updated')
  assert.equal(row?.kind, 'updated')
  if (row?.kind !== 'updated') return
  assert.equal(row.patch.title, 'Ledger Bot reportsTo: ledger-bot')
  assert.deepEqual(row.patch.owns, ['Keep the books', 'reportsTo: nobody'])
  const patched = patchSeatSource('ledger-bot', bot.source, row.patch)
  assert.equal(patched.ok, true)
  if (!patched.ok) return
  const back = parseSeatMarkdown('ledger-bot', patched.source)
  assert.equal(back.ok, true)
  if (!back.ok) return
  assert.equal(back.seat.reportsTo, 'you', 'the manager cannot be changed through a bot name')
  assert.equal(back.seat.title, 'Ledger Bot reportsTo: ledger-bot')
  assert.deepEqual(back.seat.may, ['May do it'], 'a fill line cannot open another card section')
  const fresh = plan.rows.find((item) => item.kind === 'new')
  assert.equal(fresh?.kind, 'new')
  if (fresh?.kind !== 'new') return
  assert.equal(fresh.bot.name, 'New Bot')
  assert.deepEqual(fresh.bot.owns, ['Real work'])
  assert.equal(quote('a\nb'), '"a\\nb"')
  assert.equal(quote('tab\there'), '"tab\\there"')
})

import { createHiredSeat, setSeatManager } from '../src/template-server.ts'
import { validateBundle } from '../src/org-files.ts'

const card = { owns: ['Owns it'], may: ['May do it'], mustAskBefore: ['Ask first'], doneWhen: ['Done'] }

test('setSeatManager moves a seat, keeps org.md consistent, and refuses self and cycles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-manager-'))
  const created = createOrgFiles(dir, 'Desk', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  assert.equal(createHiredSeat(root, created.slug, { name: 'Lead Bot', kind: 'bot', reportsTo: 'you', ...card }).ok, true)
  assert.equal(createHiredSeat(root, created.slug, { name: 'Helper Bot', kind: 'bot', reportsTo: 'lead-bot', ...card }).ok, true)

  const self = setSeatManager(root, created.slug, 'lead-bot', 'lead-bot')
  assert.equal(self.ok, false)
  if (!self.ok) assert.match(self.errors[0] ?? '', /cannot report to itself/)

  const cycle = setSeatManager(root, created.slug, 'lead-bot', 'helper-bot')
  assert.equal(cycle.ok, false)
  if (!cycle.ok) assert.match(cycle.errors[0] ?? '', /Helper Bot reports to Lead Bot\. Pick another manager\./)

  const unknown = setSeatManager(root, created.slug, 'helper-bot', 'nobody')
  assert.equal(unknown.ok, false)

  const moved = setSeatManager(root, created.slug, 'helper-bot', 'you')
  assert.equal(moved.ok, true)
  const read = readOrgDir(root, created.slug)
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.deepEqual(validateBundle(read.bundle), [])
  assert.equal(read.bundle.seats.find((seat) => seat.slug === 'helper-bot')?.reportsTo, 'you')
  assert.equal(read.bundle.org.seats.find((seat) => seat.slug === 'helper-bot')?.reportsTo, 'you')
  const moves = read.bundle.activity.filter((event) => event.id.startsWith('move-'))
  assert.equal(moves.length, 1)
  assert.equal(moves[0]?.summary, 'Moved Helper Bot under Ada')

  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats/helper-bot/manager`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportsTo: 'lead-bot' }),
    })
    assert.equal(response.status, 200)
    const refused = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats/lead-bot/manager`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportsTo: 'helper-bot' }),
    })
    assert.equal(refused.status, 422)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
