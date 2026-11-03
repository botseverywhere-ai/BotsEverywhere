import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { orgBlocks, sha256 } from '../src/bot-blocks.ts'
import { connectorState, runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, RESULTS_FILE, TODO_FILE } from '../src/connector-files.ts'
import { computeTodo, parseResults, type ResultsFile, type TodoFile } from '../src/connector-todo.ts'
import { parseGrokData, snapshotFromData, type GrokData, type GrokDataBot } from '../src/grok-data.ts'
import type { GrokRequest } from '../src/grok-requests.ts'
import { bundleFromState, parseSeatMarkdown, type OrgBundle, type SeatDocument } from '../src/org-files.ts'
import { ensureProjectId } from '../src/project.ts'
import { createExistingBot, createOrgFiles } from '../src/template-server.ts'

const NOW = new Date('2026-10-28T10:00:00.000Z')
const BASE = { copyId: '3s53', orgsFolder: '/o', timeZone: 'Europe/Madrid', now: NOW, removeCopies: [] as string[] }
const NO_RESULTS: ResultsFile = { results: [], confirmations: [] }

function seat(slug: string, lines: string): SeatDocument {
  const parsed = parseSeatMarkdown(slug, `---\n${lines}\n---\n\n## Owns\nWork\n`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.seat
}

function org(id: string, name: string, seats: SeatDocument[]): OrgBundle {
  return bundleFromState(id, { company: { name }, departments: [], people: [], seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })) }, seats, { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })
}

const you = seat('you', 'title: You\nkind: human\nreportsTo: ""')
const lead = seat('lead', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"')

function bot(id: string, name: string, description: string, extra: Partial<GrokDataBot> = {}): GrokDataBot {
  return { id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description, routinesVisible: false, ...extra }
}

function data(bots: GrokDataBot[], dumpedAt = '2026-10-28T10:00:00+01:00'): GrokData {
  return { dumpedAt, copy: '3s53', bots, skills: [] }
}

const blocksOf = (text: string, org: string) => (text.match(new RegExp(`^=== BotsEverywhere 3s53 ${org} ===$`, 'gm')) ?? []).length

test('the dump keeps a description exactly, CRLF and all, so the hash the Connector checks is the hash of what Grok Bot holds', () => {
  const raw = 'Line one\r\nLine two · C:\\x 🙂\r\n'
  const parsed = parseGrokData(JSON.stringify({ dumpedAt: '2026-10-28T10:00:00+01:00', bots: [{ id: 'lead', name: 'Lead', description: raw, routinesVisible: false }] }))
  assert.ok(parsed.ok)
  assert.equal(parsed.data.bots[0]!.description, raw)
  const todo = computeTodo({ ...BASE, data: parsed.data, orgs: [{ id: 'org-a', bundle: org('org-a', 'Desk', [you, lead]), requests: [] }], results: NO_RESULTS })
  const item = todo.items.find((entry) => entry.kind === 'describe')!
  assert.equal(item.expectedBeforeSha, sha256(raw))
  assert.ok(item.description!.startsWith(`${raw}\n\n=== BotsEverywhere 3s53 org-a ===`), 'the owner text, CRs included, comes first')
})

test('after a describe, a newer dump whose owner text differs from what was there before is stuck with the backup, and nothing is sent over it', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const orgs = [{ id: 'org-a', bundle: desk, requests: [] as GrokRequest[] }]
  const first = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs, results: NO_RESULTS })
  const sent = first.items.find((entry) => entry.kind === 'describe')!
  const done: ResultsFile = { results: [{ key: sent.key, status: 'done', at: '2026-10-28T09:05:00.000Z' }], confirmations: [] }
  const afterDone = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs, results: done, previous: first })
  assert.equal(afterDone.items.some((entry) => entry.kind === 'describe'), false, 'done, waiting for the next dump')
  const block = sent.description!.slice('Leads.\n\n'.length)
  const shown = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', sent.description!)], '2026-10-28T10:15:00+01:00'), orgs, results: done, previous: afterDone })
  assert.deepEqual(shown.stuck, [], 'Grok Bot shows exactly what was sent')
  const damaged = `Leads, but cut sh\n\n${block}`
  const cut = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', damaged)], '2026-10-28T10:15:00+01:00'), orgs, results: done, previous: afterDone })
  assert.equal(cut.items.some((entry) => entry.kind === 'describe'), false, 'the damaged text is never taken as the owner text')
  assert.match(cut.stuck.map((entry) => entry.why).join(' '), /Lead's instructions in Grok Bot changed when the Connector updated them[\s\S]*connector-backups/)
  const still = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', damaged)], '2026-10-28T10:30:00+01:00'), orgs, results: done, previous: cut })
  assert.equal(still.stuck.length, 1, 'stays stuck while Grok Bot shows the same text')
  const fixed = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads, fixed by the owner.')], '2026-10-28T10:45:00+01:00'), orgs, results: done, previous: still })
  assert.deepEqual(fixed.stuck, [])
  assert.ok(fixed.items.some((entry) => entry.kind === 'describe' && entry.expectedBefore === 'Leads, fixed by the owner.'))
})

test('two seats in one organization that are the same bot give it one block, and the second seat is stuck', () => {
  const twin = seat('lead-2', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"')
  const todo = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs: [{ id: 'org-a', bundle: org('org-a', 'Desk', [you, lead, twin]), requests: [] }], results: NO_RESULTS })
  const text = todo.items.find((entry) => entry.kind === 'describe')!.description!
  assert.equal(blocksOf(text, 'org-a'), 1)
  assert.match(todo.stuck.map((entry) => entry.why).join(' '), /Two seats in Desk are the same bot in Grok Bot \(Lead\)/)
})

test("a seat without a link never takes a bot another seat links, and a linked seat never falls back to its title", () => {
  const alpha = org('org-alpha', 'Alpha', [you, seat('security', 'title: Security\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=sec-a"')])
  const beta = org('org-beta', 'Beta', [you, seat('security', 'title: Security\nkind: bot\nreportsTo: you')])
  const orgs = [{ id: 'org-alpha', bundle: alpha, requests: [] }, { id: 'org-beta', bundle: beta, requests: [] }]
  const one = computeTodo({ ...BASE, data: data([bot('sec-a', 'Security', 'Guards.')]), orgs, results: NO_RESULTS })
  const text = one.items.find((entry) => entry.kind === 'describe' && entry.botId === 'sec-a')!.description!
  assert.equal(blocksOf(text, 'org-alpha'), 1)
  assert.equal(blocksOf(text, 'org-beta'), 0, "Beta's unlinked Security is not Alpha's bot")
  const two = computeTodo({ ...BASE, data: data([bot('sec-a', 'Security', 'Guards.'), bot('sec-b', 'Security · Beta', 'Guards Beta.')]), orgs, results: NO_RESULTS })
  const beta2 = two.items.find((entry) => entry.kind === 'describe' && entry.botId === 'sec-b')!.description!
  assert.equal(blocksOf(beta2, 'org-beta'), 1, 'the "Title · Organization" bot is Beta\'s')
  const gone = org('org-alpha', 'Alpha', [you, seat('security', 'title: Security\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=deleted"')])
  const three = computeTodo({ ...BASE, data: data([bot('other', 'Security', 'Someone else.')]), orgs: [{ id: 'org-alpha', bundle: gone, requests: [] }], results: NO_RESULTS })
  assert.equal(three.items.some((entry) => entry.kind === 'describe' && entry.botId === 'other'), false, 'a linked seat whose bot is gone does not take another bot by name')
})

test("this copy's blocks already right means no describe, whatever another copy's blocks do after them", () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const block = orgBlocks({ ...BASE, orgId: 'org-a', bundle: desk, botFor: (slug) => (slug === 'lead' ? { name: 'Lead', id: 'lead' } : null) }).get('lead')!
  const other = '=== BotsEverywhere zz99 org-x ===\nOther copy.\n=== end BotsEverywhere zz99 org-x ==='
  const mixed = `Leads.\n\n${block}\n\n${other}`
  const todo = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', mixed)]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(todo.items.some((entry) => entry.kind === 'describe'), false)
  const removing = computeTodo({ ...BASE, removeCopies: ['zz99'], data: data([bot('lead', 'Lead', mixed)]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(removing.items.find((entry) => entry.kind === 'describe')!.description, `Leads.\n\n${block}`)
})

test('a routine ask that failed is sent again as the next attempt, and is stuck after two failures', () => {
  const helper = seat('helper', 'title: Helper\nkind: bot\nreportsTo: lead\ngrokBotUrl: "grokbot://app/v1/agent?id=helper"')
  const desk = org('org-a', 'Desk', [you, lead, helper])
  const update: GrokRequest = { seat: 'helper', name: 'Helper', seatFile: '/o/org-a/seats/helper.md', prompt: '', kind: 'update', grokBotUrl: 'grokbot://app/v1/agent?id=helper', routines: [{ name: 'Weekly brief', schedule: '0 9 * * 1', trigger: 'schedule', timeZone: 'Europe/Madrid' }], requestedAt: '2026-10-28T08:00:00.000Z' }
  const dump = data([bot('lead', 'Lead', 'Leads.'), bot('helper', 'Helper', 'Helps.')])
  const run = (results: ResultsFile['results']) => computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [update] }], results: { results, confirmations: [] } })
  const ask = run([]).items.find((entry) => entry.kind === 'routine')!
  const failed = (key: string) => ({ key, status: 'failed' as const, at: '2026-10-28T09:00:00.000Z', why: 'bot busy' })
  const again = run([failed(ask.key)]).items.find((entry) => entry.kind === 'routine')!
  assert.equal(again.key, ask.key.replace(/#1$/, '#2'))
  const twice = run([failed(ask.key), failed(again.key)])
  assert.equal(twice.items.some((entry) => entry.kind === 'routine'), false)
  assert.match(twice.stuck.map((entry) => entry.why).join(' '), /Failed twice: bot busy/)
})

test('a result without a date is not taken as done, and a change the Connector saw that a newer dump does not explain is stuck', () => {
  assert.deepEqual(parseResults(JSON.stringify({ results: [{ key: 'describe:lead:aaaa#1', status: 'done' }, { key: 'describe:lead:aaaa#1', status: 'done', at: 'soon' }] })).results, [])
  const desk = org('org-a', 'Desk', [you, lead])
  const orgs = [{ id: 'org-a', bundle: desk, requests: [] }]
  const item = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs, results: NO_RESULTS }).items.find((entry) => entry.kind === 'describe')!
  const changed: ResultsFile = { results: [{ key: item.key, status: 'changed', at: '2026-10-28T09:05:00.000Z' }], confirmations: [] }
  const waiting = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs, results: changed })
  assert.deepEqual([waiting.items.some((entry) => entry.kind === 'describe'), waiting.stuck.length], [false, 0], 'waits for the next dump')
  const same = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')], '2026-10-28T10:15:00+01:00'), orgs, results: changed })
  assert.match(same.stuck.map((entry) => entry.why).join(' '), /The Connector saw different text in Lead than Grok Bot's data shows/)
})

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-review-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const added = createExistingBot(join(orgs, made.slug), made.slug, { name: 'Lead', grokBotUrl: 'grokbot://app/v1/agent?id=lead', reportsTo: 'you', allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-27T10:00:00.000Z' })
  assert.ok(added.ok)
  return { orgs, org: made.slug, copy: ensureProjectId(orgs), done: () => rmSync(dir, { recursive: true, force: true }) }
}

const todoOf = (orgs: string) => JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as TodoFile

test('an unreadable results file stops the cycle and says so, and leaves the to-do list as it was', () => {
  const t = project()
  try {
    writeFileSync(join(t.orgs, GROK_DATA_FILE), JSON.stringify(data([bot('lead', 'Lead', 'Leads.')])))
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    const before = readFileSync(join(t.orgs, TODO_FILE), 'utf8')
    writeFileSync(join(t.orgs, RESULTS_FILE), '{"results": [')
    const broken = runConnectorCycle(t.orgs, t.copy)
    assert.equal(broken.ok, false)
    assert.match(broken.ok ? '' : broken.error, /connector-results\.json/)
    assert.equal(readFileSync(join(t.orgs, TODO_FILE), 'utf8'), before, 'the to-do list is left as it was')
    assert.match(connectorState(t.orgs, t.org).dumpError, /connector-results\.json/)
    writeFileSync(join(t.orgs, RESULTS_FILE), JSON.stringify({ results: [], confirmations: [] }))
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
  } finally {
    t.done()
  }
})

test('a broken to-do file never breaks the drawer or the next cycle', () => {
  const t = project()
  try {
    writeFileSync(join(t.orgs, GROK_DATA_FILE), JSON.stringify(data([bot('lead', 'Lead', 'Leads.')])))
    writeFileSync(join(t.orgs, TODO_FILE), '{"basedOn":"x","items":[null,{"key":5},{"key":"describe:lead:aaaa#1","kind":"describe","bot":"Lead","org":7}],"stuck":[null,{"bot":"Lead"}],"otherCopies":"no","ledger":[null]}')
    const state = connectorState(t.orgs, t.org)
    assert.deepEqual([state.stuck, state.failed, state.otherCopies], [[], [], []])
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    assert.ok(todoOf(t.orgs).items.some((entry) => entry.kind === 'describe'))
  } finally {
    t.done()
  }
})

test("messages to bots wait for the owner from the start; only work a scheduled run can do counts as not acted on", () => {
  const t = project()
  try {
    writeFileSync(join(t.orgs, GROK_DATA_FILE), JSON.stringify(data([bot('lead', 'Lead', 'Leads.')])))
    const item = (kind: string, runs: number, since: string) => ({ key: `${kind}:lead#1`, kind, bot: 'Lead', botId: 'lead', org: t.org, message: 'Hi', runs, since })
    writeFileSync(join(t.orgs, TODO_FILE), JSON.stringify({ basedOn: 'x', items: [
      item('describe', 3, '2026-10-28T17:08:00+01:00'),
      item('create', 1, '2026-10-28T18:00:00+01:00'),
      item('profile', 3, '2026-10-28T17:08:00+01:00'),
      item('profile', 0, '2026-10-28T18:00:00+01:00'),
      item('routine', 1, '2026-10-28T18:00:00+01:00'),
      item('cleanup', 4, '2026-10-28T17:00:00+01:00'),
    ], stuck: [], otherCopies: [], ledger: [] }))
    const state = connectorState(t.orgs, t.org)
    assert.equal(state.pending, 1, 'the describe item, listed after more than two runs')
    assert.equal(state.pendingSince, '2026-10-28T17:08:00+01:00')
    assert.deepEqual(state.waiting, { routines: 1, profiles: 2, notes: 1 })
  } finally {
    t.done()
  }
})

test('the drawer learns how many items the Connector carried out since the oldest late one, so a slow Connector is not called stopped', () => {
  const t = project()
  try {
    writeFileSync(join(t.orgs, GROK_DATA_FILE), JSON.stringify(data([bot('lead', 'Lead', 'Leads.')])))
    const late = { key: 'describe:lead:aaaa#1', kind: 'describe', bot: 'Lead', botId: 'lead', org: t.org, runs: 3, since: '2026-11-03T11:55:22+01:00' }
    writeFileSync(join(t.orgs, TODO_FILE), JSON.stringify({ basedOn: 'x', items: [late], stuck: [], otherCopies: [], ledger: [] }))
    writeFileSync(join(t.orgs, RESULTS_FILE), JSON.stringify({ results: [
      { key: 'describe:old:1111#1', status: 'done', at: '2026-11-03T11:40:00+01:00' },
      { key: 'describe:one:2222#1', status: 'done', at: '2026-11-03T12:08:26+01:00' },
      { key: 'describe:two:3333#1', status: 'changed', at: '2026-11-03T12:09:19+01:00' },
      { key: 'describe:three:4444#1', status: 'failed', at: '2026-11-03T11:20:41Z', why: 'busy' },
    ], confirmations: [] }))
    const state = connectorState(t.orgs, t.org)
    assert.equal(state.pending, 1)
    assert.equal(state.actedSince, 3, 'each result after the oldest late item counts, whatever its status; 11:20Z is 12:20 in Madrid')
    writeFileSync(join(t.orgs, TODO_FILE), JSON.stringify({ basedOn: 'x', items: [{ ...late, runs: 1 }], stuck: [], otherCopies: [], ledger: [] }))
    assert.equal(connectorState(t.orgs, t.org).actedSince, 0, 'nothing is late, so there is nothing to weigh')
  } finally {
    t.done()
  }
})

test("a bot whose routines Grok Bot does not show keeps the seat's apps; one whose routines it shows gets exactly what it finds", () => {
  const withApps = seat('lead', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"\napps: ["Gmail"]')
  const desk = org('org-a', 'Desk', [you, withApps])
  const apps = [{ name: 'Gmail', status: 'connected' as const }, { name: 'Slack', status: 'connected' as const }]
  const hidden = snapshotFromData(data([bot('lead', 'Lead', 'Leads.')]), desk, 'Desk', '3s53', apps, [])
  assert.deepEqual(hidden.bots[0]!.apps, ['Gmail'])
  const shown = snapshotFromData(data([bot('lead', 'Lead', 'Leads. Posts in Slack.', { routinesVisible: true, routines: [] })]), desk, 'Desk', '3s53', apps, [])
  assert.deepEqual(shown.bots[0]!.apps, ['Slack'])
})
