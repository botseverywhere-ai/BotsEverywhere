import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, TODO_FILE } from '../src/connector-files.ts'
import type { TodoFile } from '../src/connector-todo.ts'
import { LIBRARY_SEEN_FILE, PROFILE_ASKS_FILE, readLibrarySeen, readProfileAsk } from '../src/profile-asks.ts'
import { ensureProjectId } from '../src/project.ts'
import { createExistingBot, createOrgFiles, startTemplateServer } from '../src/template-server.ts'
import { appsShown } from '../../src/org/bot-apps.ts'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-profile-asks-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const root = join(orgs, made.slug)
  for (const [name, id] of [['Lead', 'lead'], ['Helper', 'helper']]) {
    const added = createExistingBot(root, made.slug, { name: name!, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, reportsTo: 'you', allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-27T10:00:00.000Z' })
    assert.ok(added.ok)
  }
  const bots = [['lead', 'Lead'], ['helper', 'Helper']].map(([id, name]) => ({ id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description: `${name} works.`, routinesVisible: false }))
  writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-11-03T13:00:00+01:00', copy: '', bots, skills: [] }))
  return { orgs, root, org: made.slug, copy: ensureProjectId(orgs), done: () => rmSync(dir, { recursive: true, force: true }) }
}

const todo = (orgs: string) => JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as TodoFile

test("POST .../grok/profile-asks saves when the owner asked, and the next cycle lists one profile ask per bot", async () => {
  const t = project()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  const post = (slug: string, origin = `http://127.0.0.1:${started.port}`) => fetch(`http://127.0.0.1:${started.port}/api/orgs/${slug}/grok/profile-asks`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}' })
  try {
    assert.equal((await post('no-such-org')).status, 404)
    assert.equal((await post(t.org, 'https://evil.example')).status, 403, 'it leads to messages being sent to bots')
    const form = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${t.org}/grok/profile-asks`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x=1' })
    assert.equal(form.status, 415, 'a form post with no JSON never counts as a click')
    assert.equal(existsSync(join(t.root, PROFILE_ASKS_FILE)), false)
    const response = await post(t.org)
    assert.equal(response.status, 200)
    const body = (await response.json()) as { askedAt: string; bots: number }
    assert.equal(body.bots, 2)
    assert.ok(Number.isFinite(Date.parse(body.askedAt)))
    assert.ok(existsSync(join(t.root, PROFILE_ASKS_FILE)))
    assert.equal(readProfileAsk(t.root), body.askedAt)
    const asks = todo(t.orgs).items.filter((item) => item.kind === 'profile')
    assert.deepEqual(asks.map((item) => item.bot).sort(), ['Helper', 'Lead'], 'the cycle ran at once')
    assert.ok(asks[0]!.message!.includes(join(t.root, 'profiles')), 'the message names this organization\'s profiles folder')
  } finally {
    await started.close()
    t.done()
  }
})

test('a profile ask written by hand is read on the next cycle; a bad file is no ask', () => {
  const t = project()
  try {
    mkdirSync(join(t.root, 'grok'), { recursive: true })
    writeFileSync(join(t.root, PROFILE_ASKS_FILE), '﻿{"askedAt":"2026-11-03T13:05:00+01:00"}\r\n')
    assert.equal(readProfileAsk(t.root), '2026-11-03T13:05:00+01:00')
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    const clicked = todo(t.orgs).items.filter((item) => item.kind === 'profile')
    assert.equal(clicked.length, 2)
    assert.ok(clicked.every((item) => /:[0-9a-f]{16}#1$/.test(item.key)), 'keyed by the click')
    writeFileSync(join(t.root, PROFILE_ASKS_FILE), 'not json')
    assert.equal(readProfileAsk(t.root), '')
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    const first = todo(t.orgs).items.filter((item) => item.kind === 'profile')
    assert.equal(first.length, 2, 'no click to read, but neither bot has reported yet: asked by itself')
    assert.ok(first.every((item) => /:first#1$/.test(item.key)))
  } finally {
    t.done()
  }
})

test("Performance's Apps used shows the bot's own report, else what the Connector read onto the seat", () => {
  assert.deepEqual(appsShown([{ name: 'GitHub', use: 'checks PRs' }], ['X']), [{ name: 'GitHub', use: 'checks PRs' }], 'the bot knows best')
  assert.deepEqual(appsShown([], ['X']), [], 'a bot that reported no apps uses none')
  assert.deepEqual(appsShown(undefined, ['X', 'Gmail']), [{ name: 'X' }, { name: 'Gmail' }], 'no profile yet: the Connector\'s reading')
  assert.deepEqual(appsShown(undefined, undefined), [])
})

test('the ask answers how many greyed bots there are, and with no bot of its own the page says why nothing was asked', async () => {
  const t = project()
  const greyed = createExistingBot(t.root, t.org, { name: 'Visitor', grokBotUrl: 'grokbot://app/v1/agent?id=visitor', reportsTo: 'you', allowEmptyCard: true, greyed: true })
  assert.ok(greyed.ok, greyed.ok ? '' : greyed.errors.join(' '))
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${t.org}/grok/profile-asks`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${started.port}` }, body: '{}' })
    const body = (await response.json()) as { bots: number; greyed: number }
    assert.equal(body.bots, 2, 'the greyed one is not asked')
    assert.equal(body.greyed, 1)
  } finally {
    await started.close()
    t.done()
  }
  const { profilesAskedLine } = await import('../../src/components/sync-copy.ts')
  assert.equal(profilesAskedLine(21, 0), "Asked 21 bots for their profile. The Connector sends the asks on its next run; Run the Connector now in the Sync drawer sends them sooner. Skills, Apps used, and Automated tasks done fill in as each profile lands.")
  assert.equal(profilesAskedLine(1, 3), "Asked 1 bot for its profile. The Connector sends the ask on its next run; Run the Connector now in the Sync drawer sends it sooner. Skills, Apps used, and Automated tasks done fill in as each profile lands.")
  assert.equal(profilesAskedLine(0, 21), 'This organization has no bot of its own to ask: 21 are greyed, working for another organization, and the Connector is never asked. Move a bot here, or add one, first.')
  assert.equal(profilesAskedLine(0, 1), 'This organization has no bot of its own to ask: 1 is greyed, working for another organization, and the Connector is never asked. Move a bot here, or add one, first.')
  assert.equal(profilesAskedLine(0, 0), 'This organization has no bot of its own to ask. Add bots on Connect bots first.')
})

test("Performance has a Sync bots button that posts the ask and says what to tell the Connector", () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /profilesAskedLine\(body\.bots \?\? 0, body\.greyed \?\? 0\)/)
  assert.match(workspace, /\/grok\/profile-asks`/)
  assert.match(workspace, /appsUsed: appsShown\(/)
  const status = readFileSync(new URL('../../src/components/PerformanceStatus.tsx', import.meta.url), 'utf8')
  assert.match(status, /<Button[^>]*>Sync bots<\/Button>/)
  assert.doesNotMatch(status, /Get the bots&apos; profiles/, 'the button is called Sync bots everywhere the page names it')
})

test('a skill new in the library makes the app ask every bot for its profile, so a skill a bot saved in Grok Bot reaches its card by the next run', () => {
  const t = project()
  try {
    assert.ok(runConnectorCycle(t.orgs, t.copy, new Date('2026-11-03T12:01:00.000Z')).ok)
    assert.equal(readProfileAsk(t.root), '', 'the first reading only remembers the library')
    assert.equal(readLibrarySeen(t.orgs)?.length, 0)
    const data = JSON.parse(readFileSync(join(t.orgs, GROK_DATA_FILE), 'utf8')) as { skills: unknown[] }
    writeFileSync(join(t.orgs, GROK_DATA_FILE), JSON.stringify({ ...data, dumpedAt: '2026-11-03T13:15:00+01:00', skills: [{ name: 'open-source-maintenance', description: 'Keeps the repo healthy.' }] }))
    assert.ok(runConnectorCycle(t.orgs, t.copy, new Date('2026-11-03T12:16:00.000Z')).ok)
    assert.equal(readProfileAsk(t.root), '2026-11-03T12:16:00.000Z', 'asked when the library grew')
    const asks = todo(t.orgs).items.filter((item) => item.kind === 'profile')
    assert.deepEqual(asks.map((item) => item.bot).sort(), ['Helper', 'Lead'])
    assert.ok(asks.every((item) => /:[0-9a-f]{16}#1$/.test(item.key)), 'keyed like a click, so a bot that reported before is asked again')
    assert.deepEqual(readLibrarySeen(t.orgs), ['open-source-maintenance'])
    assert.ok(runConnectorCycle(t.orgs, t.copy, new Date('2026-11-03T12:31:00.000Z')).ok)
    assert.equal(readProfileAsk(t.root), '2026-11-03T12:16:00.000Z', 'the same library asks nothing more')
    writeFileSync(join(t.orgs, LIBRARY_SEEN_FILE), '﻿["open-source-maintenance"]\r\n')
    assert.deepEqual(readLibrarySeen(t.orgs), ['open-source-maintenance'], 'a BOM and CRLF read fine')
    writeFileSync(join(t.orgs, LIBRARY_SEEN_FILE), 'not json')
    assert.equal(readLibrarySeen(t.orgs), null, 'a bad file counts as a first reading: nothing is asked')
  } finally {
    t.done()
  }
})
