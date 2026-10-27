import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createExistingBot, createOrgFiles, readOrgDir, readRequests, setSeatManager, startTemplateServer } from '../src/template-server.ts'

/** You, then Grok Bot under You, then Inner Loop and UX/UI under Grok Bot. Every bot is in Grok Bot. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-connector-updated-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const root = join(orgs, made.slug)
  const add = (name: string, id: string, reportsTo: string) => {
    const bot = createExistingBot(root, made.slug, { name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, reportsTo, allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-26T10:00:00.000Z' })
    assert.ok(bot.ok, bot.ok ? '' : bot.errors.join(' '))
    return bot.slug
  }
  const grok = add('Grok Bot', 'grok', 'you')
  const lead = add('Inner Loop', 'lead', grok)
  const ux = add('UX/UI', 'ux', grok)
  return { dir, orgs, root, org: made.slug, lead, ux, done: () => rmSync(dir, { recursive: true, force: true }) }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return check()
}

test('the Connector keeps reporting a finished update on every run until the app takes it out of requests.json', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/o' })
  assert.doesNotMatch(prompt, /carried out on this run/, 'a report that lasts one run is lost whenever the app misses that run')
  assert.match(prompt, /updated lists every "kind": "update" request still in the organization's grok\/requests\.json that you have carried out, on this run or an earlier one/)
  assert.match(prompt, /Keep listing it on every run until it is gone from requests\.json/)
})

test('a snapshot that reported an update done while the writer was off clears when the writer starts', async () => {
  const p = project()
  try {
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    const waiting = readRequests(p.root).requests
    writeFileSync(join(p.root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-27T16:51:32+01:00', bots: [], processes: [], updated: [{ seat: p.ux, requestedAt: waiting[0]!.requestedAt }] }))
    const started = await startTemplateServer({ port: 0, orgsDir: p.orgs, host: '127.0.0.1' })
    try {
      assert.equal(readRequests(p.root).requests.length, 0, 'cleared on start, before any change arrives')
    } finally {
      await started.close()
    }
  } finally {
    p.done()
  }
})

test('a snapshot that reports an update done clears it within seconds, whatever order the Connector wrote its files in', async () => {
  const p = project()
  const started = await startTemplateServer({ port: 0, orgsDir: p.orgs, host: '127.0.0.1' })
  try {
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    const waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1)
    // Only the snapshot changes: the Connector wrote it after connector.json, or the writer was off for that run.
    writeFileSync(join(p.root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-27T16:51:32+01:00', bots: [], processes: [], updated: [{ seat: p.ux, requestedAt: waiting[0]!.requestedAt }] }))
    assert.ok(await until(() => readRequests(p.root).requests.length === 0, 8000), 'the waiting update clears')
    assert.equal(existsSync(join(p.orgs, CONNECTOR_FILE)), false, 'no connector.json was needed')
    const read = readOrgDir(p.root, p.org)
    assert.ok(read.ok)
    assert.equal(read.bundle.activity.filter((item) => item.summary === 'Updated in Grok Bot: UX/UI').length, 1, 'logged once, From Grok Bot')
  } finally {
    await started.close()
    p.done()
  }
})
