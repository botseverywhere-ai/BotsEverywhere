import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ownerText } from '../src/bot-blocks.ts'
import { readTextFile, writeFileAtomic } from '../src/connector-files.ts'
import { orgBots, parseGrokData, snapshotFromData, unassignedFromData, type GrokData } from '../src/grok-data.ts'
import { bundleFromState, parseSeatMarkdown, type SeatDocument } from '../src/org-files.ts'

function seat(slug: string, lines: string): SeatDocument {
  const parsed = parseSeatMarkdown(slug, `---\n${lines}\n---\n\n## Owns\nWork\n`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.seat
}

function desk() {
  const seats = [
    seat('you', 'title: You\nkind: human\nreportsTo: ""'),
    seat('grok-bot', 'title: Grok Bot\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=grok"\napps: "[\\"Slack\\"]"'),
    seat('inner-loop', 'title: Inner Loop\nkind: bot\nreportsTo: grok-bot'),
    seat('research', 'title: Research\nkind: bot\nreportsTo: you'),
  ]
  return bundleFromState('org-test', { company: { name: 'Desk' }, departments: [], people: [], seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })) }, seats, { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })
}

const THEIRS = '=== BotsEverywhere uft5 org-test ===\nMain manager: Pera Shaw\n=== end BotsEverywhere uft5 org-test ==='
const OURS = '=== BotsEverywhere 3s53 org-test ===\nMain manager: Grok Bot (id grok)\nSkills to use: GitHub sweep\n=== end BotsEverywhere 3s53 org-test ==='

const DUMP: GrokData = {
  dumpedAt: '2026-10-27T19:00:00+01:00',
  copy: '3s53',
  bots: [
    { id: 'grok', name: 'Grok Bot Renamed', grokBotUrl: 'grokbot://app/v1/agent?id=grok', description: `Sorts mail in Gmail.\n\n${OURS.replace('Grok Bot (id grok)', 'You')}`, routinesVisible: true, runs30d: 172, routines: [{ name: 'Daily summary', schedule: '15 18 * * 1-5', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-10-26T18:22:59+01:00' }] },
    { id: 'inner', name: 'Inner Loop', grokBotUrl: 'grokbot://app/v1/agent?id=inner', description: `Runs build prompts. Uses GitHub.\n\n${THEIRS}\n\n${OURS}`, routinesVisible: false },
    { id: 'res', name: 'Research · Desk', grokBotUrl: 'grokbot://app/v1/agent?id=res', description: 'Reads papers.', routinesVisible: false },
    { id: 'new', name: 'New Helper', grokBotUrl: 'grokbot://app/v1/agent?id=new', description: 'Helps. Reports to Inner Loop.', routinesVisible: false },
    { id: 'stray', name: 'Stray Bot', grokBotUrl: 'grokbot://app/v1/agent?id=stray', description: 'Nobody asked for me.', routinesVisible: false },
  ],
  skills: [{ name: 'GitHub sweep', description: 'Sweeps issues.' }],
}
const APPS = [{ name: 'Gmail', status: 'connected' as const }, { name: 'GitHub', status: 'connected' as const }]

test('a dump without a bot list, with a bot without an id, or not JSON is refused with a reason', () => {
  const noBots = parseGrokData('{"dumpedAt":"2026-10-27T19:00:00+01:00","copy":"3s53"}')
  assert.equal(noBots.ok, false)
  assert.match(noBots.ok ? '' : noBots.error, /bots/)
  const noId = parseGrokData(JSON.stringify({ ...DUMP, bots: [{ name: 'X', description: '' }] }))
  assert.equal(noId.ok, false)
  assert.match(noId.ok ? '' : noId.error, /id/)
  assert.equal(parseGrokData('not json').ok, false)
})

test('a dump with a byte-order mark and CRLF reads the same', () => {
  const parsed = parseGrokData(`﻿${JSON.stringify(DUMP, null, 2).replace(/\n/g, '\r\n')}`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  assert.equal(parsed.data.bots.length, 5)
  assert.equal(parsed.data.bots[1]!.description, DUMP.bots[1]!.description)
})

test('a bot belongs by its Grok Bot id in a seat link, by its title, or as "Title · Organization", and by a create request', () => {
  const names = orgBots(DUMP, desk(), 'Desk', ['New Helper']).map((bot) => bot.id).sort()
  assert.deepEqual(names, ['grok', 'inner', 'new', 'res'])
})

test("apps come only from the owner's own text, never from blocks; the manager only from this copy's block", () => {
  const snapshot = snapshotFromData(DUMP, desk(), 'Desk', '3s53', APPS, ['New Helper'])
  const row = (id: string) => snapshot.bots.find((bot) => bot.grokBotUrl.endsWith(`id=${id}`))!
  assert.deepEqual(row('grok').apps, ['Gmail'])
  assert.deepEqual(row('inner').apps, ['GitHub'])
  assert.equal(row('inner').reportsTo, 'Grok Bot', 'never Pera Shaw from another copy')
  assert.equal(row('new').reportsTo, 'Inner Loop', "a line the owner wrote, matching a seat title")
  assert.equal(row('res').reportsTo, 'You')
  assert.deepEqual(row('inner').skills, [], 'skills in a block are not read back')
})

test('a value Grok Bot does not show stays missing, and unknown account apps never clear a seat', () => {
  const snapshot = snapshotFromData(DUMP, desk(), 'Desk', '3s53', undefined, [])
  const inner = snapshot.bots.find((bot) => bot.name === 'Inner Loop')!
  assert.equal(inner.runs30d, undefined)
  assert.deepEqual(inner.routines, [])
  assert.equal(inner.lastActive, '')
  const grok = snapshot.bots.find((bot) => bot.grokBotUrl.endsWith('id=grok'))!
  assert.deepEqual(grok.apps, ['Slack'], 'the seat keeps what it had')
  assert.equal(grok.runs30d, 172)
  assert.equal(grok.routines[0]!.lastRun, '2026-10-26T18:22:59+01:00')
  assert.deepEqual(snapshot.processes.map((process) => process.name), ['Daily summary'], 'processes only from routines Grok Bot shows')
})

test('bots in no organization are the unassigned list', () => {
  assert.deepEqual(unassignedFromData(DUMP, [{ bundle: desk(), orgName: 'Desk', created: ['New Helper'] }]).map((bot) => bot.name), ['Stray Bot'])
})

test('ownerText leaves out every BotsEverywhere block, of any copy', () => {
  assert.equal(ownerText(DUMP.bots[1]!.description).trim(), 'Runs build prompts. Uses GitHub.')
})

test('files the app writes for the Connector land whole, and reads tolerate a byte-order mark and CRLF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-files-'))
  try {
    const path = join(dir, 'connector-todo.json')
    writeFileAtomic(path, '{"items":[]}\n')
    assert.deepEqual(readdirSync(dir), ['connector-todo.json'], 'no temporary file left behind')
    writeFileAtomic(path, '﻿{"a":1}\r\n')
    assert.equal(readTextFile(path), '{"a":1}\n')
    assert.equal(readTextFile(join(dir, 'missing.json')), null)
    assert.equal(existsSync(path), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
