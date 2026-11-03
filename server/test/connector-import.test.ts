import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importLocked } from '../src/bots-file.ts'
import { GROK_DATA_FILE } from '../src/connector-files.ts'
import { writeMainBot } from '../src/project.ts'
import { createExistingBot, createOrgFiles, importFromConnector, startTemplateServer } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`
const bot = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, grokBotUrl: link(id), description: `${name} works.`, routinesVisible: false, ...extra })

function project(dump?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'be-connector-import-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Alicante Tech Vibes', 'You')
  assert.ok(made.ok)
  if (dump) writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', skills: [], ...dump }))
  const seat = (slug: string) => readFileSync(join(orgs, made.slug, 'seats', `${slug}.md`), 'utf8')
  return { orgs, org: made.slug, root: join(orgs, made.slug), seat, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test("the Connector import brings every bot with its own-text manager", async () => {
  const { orgs, org, root, seat, done } = project({ bots: [bot('g', 'Grok Bot'), bot('s', 'Security', { reportsTo: 'Grok Bot' })], self: { id: 'c1', name: 'Connector - BotsEverywhere (acn8)', grokBotUrl: link('c1') } })
  try {
    const result = importFromConnector(orgs, root, org)
    assert.ok(!('status' in result), JSON.stringify(result))
    assert.match(seat('security'), /^reportsTo: grok-bot$/m)
    assert.match(seat('grok-bot'), /^reportsTo: you$/m)
    assert.match(seat('connector-botseverywhere-acn8'), /id=c1/)
    assert.match(seat('security'), /^grokSync: synced$/m)
    const { readProfileAsk } = await import('../src/profile-asks.ts')
    assert.ok(Number.isFinite(Date.parse(readProfileAsk(root))), 'the import asks every bot for its profile by itself, so nobody has to find the button')
  } finally {
    done()
  }
})

test("another copy's Connector is neither imported nor listed as a bot in no organization: only this copy's Connector comes in", async () => {
  const { orgs, org, root, done } = project({
    bots: [bot('g', 'Grok Bot'), bot('old', 'Connector - BotsEverywhere (ddap)'), bot('b', 'Brand', { reportsTo: 'Grok Bot' })],
    self: { id: 'c1', name: 'Connector - BotsEverywhere (acn8)', grokBotUrl: link('c1') },
  })
  try {
    const { readGrokData, unassignedFromData } = await import('../src/grok-data.ts')
    const read = readGrokData(orgs)
    assert.ok(read.ok)
    if (!read.ok) return
    assert.deepEqual(unassignedFromData(read.data, []).map((row) => row.name), ['Grok Bot', 'Brand'], 'the old Connector is not offered as a bot to add')
    const result = importFromConnector(orgs, root, org)
    assert.ok(!('status' in result), JSON.stringify(result))
    assert.deepEqual(readdirSync(join(root, 'seats')).sort(), ['brand.md', 'connector-botseverywhere-acn8.md', 'grok-bot.md', 'you.md'])
  } finally {
    done()
  }
})

test('an older dump without managers or self still imports, under You', () => {
  const { orgs, org, root, seat, done } = project({ bots: [bot('g', 'Grok Bot'), bot('s', 'Security')] })
  try {
    const result = importFromConnector(orgs, root, org)
    assert.ok(!('status' in result), JSON.stringify(result))
    assert.match(seat('security'), /^reportsTo: you$/m)
    const connector = readdirSync(join(root, 'seats')).find((name) => name.startsWith('connector-botseverywhere-'))
    assert.ok(connector, 'the Connector still gets its seat')
    if (connector) assert.match(seat(connector.slice(0, -3)), /^grokBotUrl: ""$/m, 'without self or another organization to copy from, it has no link')
  } finally {
    done()
  }
})

test('POST connector-import answers 404 with no dump and 409 once the organization has bots', async () => {
  const empty = project()
  const started = await startTemplateServer({ port: 0, orgsDir: empty.orgs, host: '127.0.0.1' })
  try {
    const post = () => fetch(`http://127.0.0.1:${started.port}/api/orgs/${empty.org}/connector-import`, { method: 'POST' })
    assert.equal((await post()).status, 404)
    writeFileSync(join(empty.orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', skills: [], bots: [bot('s', 'Security')] }))
    const first = await post()
    assert.equal(first.status, 200, await first.clone().text())
    assert.equal((await post()).status, 409)
    const foreign = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${empty.org}/connector-import`, { method: 'POST', headers: { origin: 'https://example.com' } })
    assert.equal(foreign.status, 403)
  } finally {
    await started.close()
    empty.done()
  }
})

test('the main bot does not lock the import', () => {
  const { orgs, org, root, done } = project({ bots: [bot('g', 'Grok Bot'), bot('s', 'Security')] })
  try {
    assert.ok(writeMainBot(orgs, 'g').ok)
    assert.ok(createExistingBot(root, org, { name: 'Grok Bot', grokBotUrl: link('g'), reportsTo: 'you', allowEmptyCard: true }).ok)
    const seats = [{ kind: 'human' as const, title: 'You', grokBotUrl: '' }, { kind: 'bot' as const, title: 'Connector - BotsEverywhere (acn8)', grokBotUrl: link('c1') }, { kind: 'bot' as const, title: 'Grok Bot', grokBotUrl: link('g') }]
    assert.equal(importLocked(seats, 'g'), false)
    assert.equal(importLocked([...seats, { kind: 'bot' as const, title: 'Security', grokBotUrl: link('s') }], 'g'), true)
    const result = importFromConnector(orgs, root, org)
    assert.ok(!('status' in result), JSON.stringify(result))
    assert.equal(existsSync(join(root, 'seats', 'grok-bot-2.md')), false, 'a bot already here is not added twice')
  } finally {
    done()
  }
})

test('an import that brings no new bot asks nobody for a profile: every round is one message per bot', async () => {
  // Only the main bot is here, so the import stays open; the dump holds nothing new.
  const { orgs, org, root, done } = project({ bots: [bot('g', 'Grok Bot')], self: { id: 'c1', name: 'Connector - BotsEverywhere (acn8)', grokBotUrl: link('c1') } })
  try {
    const projectFile = join(orgs, 'project.json')
    writeFileSync(projectFile, JSON.stringify({ ...(existsSync(projectFile) ? JSON.parse(readFileSync(projectFile, 'utf8')) as object : { id: 'acn8' }), mainBot: 'g' }))
    const { readProfileAsk } = await import('../src/profile-asks.ts')
    const first = importFromConnector(orgs, root, org)
    assert.ok(!('status' in first), JSON.stringify(first))
    const asked = readProfileAsk(root)
    assert.ok(Number.isFinite(Date.parse(asked)), 'the first import brought Grok Bot, so it asks')
    const again = importFromConnector(orgs, root, org)
    assert.ok(!('status' in again), JSON.stringify(again))
    assert.equal(readProfileAsk(root), asked, 'nothing new came in, so nobody is asked again')
  } finally {
    done()
  }
})
