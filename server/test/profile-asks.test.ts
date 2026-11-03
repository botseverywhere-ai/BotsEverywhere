import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, TODO_FILE } from '../src/connector-files.ts'
import type { TodoFile } from '../src/connector-todo.ts'
import { PROFILE_ASKS_FILE, readProfileAsk } from '../src/profile-asks.ts'
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

test("Performance has a Get the bots' profiles button that posts the ask and says what to tell the Connector", () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /\/grok\/profile-asks`/)
  assert.match(workspace, /appsUsed: appsShown\(/)
  const status = readFileSync(new URL('../../src/components/PerformanceStatus.tsx', import.meta.url), 'utf8')
  assert.match(status, /Get the bots&apos; profiles/)
})
