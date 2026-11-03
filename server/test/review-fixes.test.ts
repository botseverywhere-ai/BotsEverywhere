import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importLocked, parseBotsFile } from '../src/bots-file.ts'
import { orgImportLocked } from '../src/org-file.ts'
import { GROK_DATA_FILE } from '../src/connector-files.ts'
import { canRequest } from '../src/grok-requests.ts'
import { connectorImportNotice } from '../../src/components/sync-copy.ts'
import { alsoChoices, managerChoices } from '../../src/org/manager-choices.ts'
import { createExistingBot, createOrgFiles, importBotsFile, importFromConnector, moveBotHere, readOrgDir, readRoutineBoard, removeGreyedSeat, setSeatManagers } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

/** A runs Security. B imported Security greyed, plus Writer, which is active. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-review-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const a = createOrgFiles(orgs, 'BotsEverywhere', 'You')
  const b = createOrgFiles(orgs, 'Northwind Events', 'You')
  assert.ok(a.ok && b.ok)
  const rootA = join(orgs, a.slug)
  const rootB = join(orgs, b.slug)
  assert.ok(createExistingBot(rootA, a.slug, { name: 'Security', grokBotUrl: link('s1'), reportsTo: 'you', allowEmptyCard: true }).ok)
  const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Security', grokBotUrl: link('s1') }, { name: 'Writer', grokBotUrl: link('w1') }] }))
  assert.ok(file.ok)
  if (file.ok) importBotsFile(rootB, b.slug, file.rows)
  return { orgs, a: a.slug, b: b.slug, rootA, rootB, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('C1: no seat may report to a greyed bot, and the choices leave greyed bots out', () => {
  const { orgs, b, rootB, done } = project()
  try {
    const main = setSeatManagers(rootB, b, 'writer', 'security', [])
    assert.equal(main.ok, false)
    if (!main.ok) assert.match(main.errors.join(' '), /Security works in another organization/)
    assert.equal(setSeatManagers(rootB, b, 'writer', 'you', ['security']).ok, false, 'not on a dotted line either')
    assert.equal(createExistingBot(rootB, b, { name: 'Notes', grokBotUrl: '', reportsTo: 'security', allowEmptyCard: true }).ok, false)
    const read = readOrgDir(rootB, b)
    assert.ok(read.ok)
    if (!read.ok) return
    assert.equal(managerChoices(read.bundle.seats, 'writer').some((item) => item.slug === 'security'), false)
    assert.equal(alsoChoices(read.bundle.seats, 'writer').some((item) => item.slug === 'security'), false)
    assert.ok(orgs)
  } finally {
    done()
  }
})

test('C1: removing a greyed bot that a seat still reports to leaves the organization readable', () => {
  const { orgs, b, rootB, done } = project()
  try {
    // A report written before greyed managers were refused.
    const seat = join(rootB, 'seats', 'writer.md')
    writeFileSync(seat, readFileSync(seat, 'utf8').replace(/^reportsTo: .*$/m, 'reportsTo: security'))
    const orgFile = join(rootB, 'org.md')
    writeFileSync(orgFile, readFileSync(orgFile, 'utf8').replace(/^- writer: .*$/m, '- writer: security'))
    assert.deepEqual(removeGreyedSeat(orgs, b, 'security'), { ok: true })
    const read = readOrgDir(rootB, b)
    assert.ok(read.ok, read.ok ? '' : read.errors.join(' '))
    if (read.ok) assert.equal(read.bundle.seats.find((item) => item.slug === 'writer')?.reportsTo, 'you')
  } finally {
    done()
  }
})

test('C2: a manager loop in the imported file never makes the organization unreadable', () => {
  const { orgs, b, rootB, done } = project()
  try {
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Alpha', grokBotUrl: link('al'), reportsTo: 'Beta' }, { name: 'Beta', grokBotUrl: link('be'), reportsTo: 'Alpha' }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    const fresh = createOrgFiles(orgs, 'northwind-test', 'You')
    assert.ok(fresh.ok)
    if (!fresh.ok) return
    const result = importBotsFile(join(orgs, fresh.slug), fresh.slug, file.rows)
    const read = readOrgDir(join(orgs, fresh.slug), fresh.slug)
    assert.ok(read.ok, read.ok ? '' : read.errors.join(' '))
    assert.ok(result.notes.some((note) => /loop/.test(note.note)), JSON.stringify(result.notes))
    assert.ok(b && rootB)
  } finally {
    done()
  }
})

test('I1: a greyed seat is never offered to Create in Grok Bot', () => {
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokBotUrl: '', elsewhereUrl: link('s1') }), false)
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokBotUrl: '' }), true)
})

test("I2: the Work Chart's routine board leaves a greyed bot out", () => {
  const { orgs, b, done } = project()
  try {
    writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', skills: [], bots: [{ id: 's1', name: 'Security', grokBotUrl: link('s1'), description: 'x', routinesVisible: true, routines: [{ name: 'Nightly scan', trigger: 'schedule', schedule: '0 2 * * *' }] }] }))
    const board = readRoutineBoard(orgs, b)
    assert.ok(board)
    assert.equal(board?.bots.some((bot) => bot.slug === 'security'), false)
  } finally {
    done()
  }
})

test('I3: the new-name box starts over for each greyed seat', () => {
  assert.match(source('src/components/SeatDrawer.tsx'), /<GreyedSeatBox key=\{seat\.id\}/)
})

test('I4: the import result, its notes, and its errors reach the owner', () => {
  const line = connectorImportNotice({ imported: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], greyed: [{ name: 'A' }], notes: [{ name: 'Writer', note: 'Nobody is not a seat here; placed under You.' }], errors: [{ name: 'Bad', error: 'Bot name is required.' }] })
  assert.match(line, /^3 bots added\. 1 are greyed: they work in another organization\./)
  assert.match(line, /Writer: Nobody is not a seat here; placed under You\./)
  assert.match(line, /Not added: Bad: Bot name is required\./)
  assert.match(source('src/components/LinkCompany.tsx'), /onNotice\?\.\(/)
  assert.match(source('src/pages/Workspace.tsx'), /onNotice=\{/)
})

test('I5: while another organization cannot be read, no bot moves and the Connector import waits', () => {
  const { orgs, a, b, rootA, done } = project()
  try {
    writeFileSync(join(rootA, 'seats', 'ghost.md'), '---\nname: Ghost\nkind: bot\nsource: existing\ngrokBotUrl: ""\nreportsTo: nobody\n---\n')
    assert.equal(readOrgDir(rootA, a).ok, false, 'A is unreadable')
    const moved = moveBotHere(orgs, b, 'security')
    assert.equal(moved.ok, false)
    if (!moved.ok) assert.match(moved.errors.join(' '), new RegExp(a))
    writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', skills: [], bots: [{ id: 's1', name: 'Security', grokBotUrl: link('s1'), description: 'x', routinesVisible: false }] }))
    const fresh = createOrgFiles(orgs, 'northwind-test', 'You')
    assert.ok(fresh.ok)
    if (!fresh.ok) return
    const result = importFromConnector(orgs, join(orgs, fresh.slug), fresh.slug)
    assert.ok('status' in result, 'refused')
    if ('status' in result) assert.match(result.error, new RegExp(a))
  } finally {
    done()
  }
})

test('the main bot is recognized whatever letters its id has', () => {
  const seats = [{ kind: 'human' as const, title: 'You', slug: 'you', grokBotUrl: '' }, { kind: 'bot' as const, title: 'My Assistant', slug: 'my-assistant', grokBotUrl: link('sss-ask-1') }]
  assert.equal(importLocked(seats, 'sss-ask-1'), false)
  assert.equal(orgImportLocked(seats, 'sss-ask-1'), false)
})
