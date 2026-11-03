import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, RESULTS_FILE, TODO_FILE } from '../src/connector-files.ts'
import type { TodoFile } from '../src/connector-todo.ts'
import type { GrokData } from '../src/grok-data.ts'
import type { SyncStatus } from '../src/grok-sync.ts'
import { ensureProjectId, PROJECT_FILE, writeSyncMinutes } from '../src/project.ts'
import { createExistingBot, createOrgFiles, startTemplateServer, syncStatus } from '../src/template-server.ts'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

function team() {
  const dir = mkdtempSync(join(tmpdir(), 'be-ui-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const root = join(orgs, made.slug)
  const add = (name: string, id: string, reportsTo: string) => {
    const bot = createExistingBot(root, made.slug, { name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, reportsTo, allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-27T10:00:00.000Z' })
    assert.ok(bot.ok, bot.ok ? '' : bot.errors.join(' '))
    return bot.slug
  }
  const grok = add('Grok Bot', 'grok', 'you')
  add('Inner Loop', 'inner', grok)
  add('Outer Loop', 'outer', grok)
  add('Security', 'security', grok)
  return { orgs, root, org: made.slug, copy: ensureProjectId(orgs), done: () => rmSync(dir, { recursive: true, force: true }) }
}

const OTHER = '=== BotsEverywhere uft5 org-old ===\nOrganization: Old\n=== end BotsEverywhere uft5 org-old ==='

function dump(at: string, descriptions: Record<string, string> = {}): GrokData {
  const bot = (id: string, name: string) => ({ id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description: descriptions[id] ?? `${name} works.`, routinesVisible: false })
  return { dumpedAt: at, copy: '', bots: [bot('grok', 'Grok Bot'), bot('inner', 'Inner Loop'), bot('outer', 'Outer Loop'), bot('security', 'Security')], skills: [] }
}

const write = (orgs: string, data: GrokData) => writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify(data))
const todo = (orgs: string) => JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as TodoFile
const results = (orgs: string, list: { key: string; status: string; at: string; why?: string }[]) => writeFileSync(join(orgs, RESULTS_FILE), JSON.stringify({ results: list, confirmations: [] }))

test('sync status lists stuck items with reasons, a first failure, a dump error, items pending more than two runs, and other copies\' blocks', () => {
  const t = team()
  try {
    const descriptions = (copy: string) => ({
      security: `Security works.\n\n${OTHER}`,
      outer: `Outer Loop works.\n\n=== BotsEverywhere ${copy} ${t.org} ===\nhalf a block`,
    })
    write(t.orgs, dump('2026-10-28T10:00:00+01:00', descriptions(t.copy)))
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    const key = (bot: string) => todo(t.orgs).items.find((item) => item.kind === 'describe' && item.botId === bot)!.key.replace(/#\d+$/, '')
    const inner = key('inner')
    const security = key('security')
    results(t.orgs, [
      { key: `${inner}#1`, status: 'failed', at: '2026-10-28T10:05:00+01:00', why: 'UpdateAgent timed out' },
      { key: `${security}#1`, status: 'failed', at: '2026-10-28T10:05:00+01:00', why: 'busy' },
      { key: `${security}#2`, status: 'failed', at: '2026-10-28T10:20:00+01:00', why: 'busy again' },
    ])
    write(t.orgs, dump('2026-10-28T10:15:00+01:00', descriptions(t.copy)))
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)
    write(t.orgs, dump('2026-10-28T10:30:00+01:00', descriptions(t.copy)))
    assert.ok(runConnectorCycle(t.orgs, t.copy).ok)

    const read = syncStatus(t.root, t.org, t.orgs)
    assert.ok(read.ok)
    const connector = read.status.connector!
    assert.deepEqual(connector.stuck.map((item) => item.bot).sort(), ['Outer Loop', 'Security'])
    assert.match(connector.stuck.find((item) => item.bot === 'Security')!.why, /^Failed twice: busy again$/)
    assert.match(connector.stuck.find((item) => item.bot === 'Outer Loop')!.why, /damaged/)
    assert.deepEqual(connector.failed, [{ bot: 'Inner Loop', why: 'UpdateAgent timed out' }])
    assert.equal(connector.pending, 1, 'Grok Bot\'s block has waited through three dumps; Inner Loop is on its second attempt')
    assert.equal(connector.pendingSince, '2026-10-28T10:00:00+01:00')
    assert.deepEqual(connector.waiting, { routines: 0, profiles: 0, notes: 0 }, 'bots write their own profiles, and no one-time note goes out: nothing waits for the owner')
    assert.deepEqual(connector.otherCopies, [{ copy: 'uft5', bots: ['Security'], removing: false }])
    assert.equal(connector.dumpError, '')

    writeFileSync(join(t.orgs, GROK_DATA_FILE), '{"dumpedAt":"2026-10-28T11:00:00+01:00","bots":[{"name":"No id"}]}')
    const bad = syncStatus(t.root, t.org, t.orgs)
    assert.ok(bad.ok)
    assert.match(bad.status.connector!.dumpError, /no id/)
  } finally {
    t.done()
  }
})

test('POST /api/connector/remove-copy stores the copy, keeps the rest of project.json, and the next to-do list removes its blocks', async () => {
  const t = team()
  assert.ok(writeSyncMinutes(t.orgs, 60).ok)
  write(t.orgs, dump('2026-10-28T10:00:00+01:00', { security: `Security works.\n\n${OTHER}` }))
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  const post = (body: object) => fetch(`http://127.0.0.1:${started.port}/api/connector/remove-copy`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${started.port}` }, body: JSON.stringify(body) })
  try {
    assert.equal((await post({ copy: 'not a copy!' })).status, 422)
    assert.equal((await post({ copy: t.copy })).status, 422, 'this copy never removes its own blocks')
    const response = await post({ copy: 'uft5' })
    assert.equal(response.status, 200)
    const project = JSON.parse(readFileSync(join(t.orgs, PROJECT_FILE), 'utf8')) as { id: string; syncMinutes?: number; removeCopies?: string[] }
    assert.deepEqual(project, { id: t.copy, syncMinutes: 60, removeCopies: ['uft5'] })
    const security = todo(t.orgs).items.find((item) => item.kind === 'describe' && item.botId === 'security')!
    assert.equal(security.description!.includes('uft5'), false)
    assert.equal(security.description!.startsWith('Security works.'), true)
    assert.ok(writeSyncMinutes(t.orgs, 120).ok)
    assert.deepEqual((JSON.parse(readFileSync(join(t.orgs, PROJECT_FILE), 'utf8')) as { removeCopies?: string[] }).removeCopies, ['uft5'], 'a new interval keeps the copies to remove')
    const read = syncStatus(t.root, t.org, t.orgs)
    assert.ok(read.ok)
    assert.deepEqual(read.status.connector!.otherCopies, [{ copy: 'uft5', bots: ['Security'], removing: true }])
  } finally {
    await started.close()
    t.done()
  }
})

test('the drawer shows each of these under Going to Grok Bot', async () => {
  const { SyncDrawer } = await import('../../src/components/SyncDrawer.tsx')
  const status: SyncStatus = {
    snapshot: null,
    error: '',
    plan: null,
    lastConfirmed: '',
    folder: '',
    requests: [],
    connector: {
      stuck: [{ bot: 'Security', why: 'Failed twice: busy again' }],
      failed: [{ bot: 'Inner Loop', why: 'UpdateAgent timed out' }],
      pending: 3,
      pendingSince: '2026-10-28T10:00:00+01:00',
      waiting: { routines: 1, profiles: 18, notes: 2 },
      dumpError: 'Bot 1 has no id.',
      otherCopies: [{ copy: 'uft5', bots: ['Security', 'Outer Loop'], removing: false }, { copy: 'k7m2', bots: ['Grok Bot'], removing: true }],
    },
  }
  const html = await render(SyncDrawer, { orgSlug: 'desk', status, seats: [], onClose: () => undefined, onRefresh: async () => undefined, onApplied: async () => undefined })
  const going = html.slice(html.indexOf('Going to Grok Bot'))
  assert.ok(html.indexOf('Going to Grok Bot') > 0)
  assert.match(going, /The Connector could not do these \(1\)/)
  assert.match(going, /<strong>Security<\/strong> · Failed twice: busy again/)
  assert.match(going, /<strong>Inner Loop<\/strong> · failed once, trying again on the next run: UpdateAgent timed out/)
  assert.match(going, /The Connector&#x27;s data could not be read: Bot 1 has no id\./)
  assert.match(going, /The Connector has not acted on 3 items since /)
  assert.match(going, /18 profile requests, 1 routine request and 2 one-time notes wait for you\. Grok Bot sends messages to bots only from a chat, never from the Connector&#x27;s scheduled runs\. In the Connector&#x27;s chat in Grok Bot, say: do YOU now/)
  assert.match(going, /<summary>Copy uft5 · 2 bots<\/summary><p class="overview-note">Security, Outer Loop<\/p>/)
  assert.match(going, /<button[^>]*>Remove them<\/button>/)
  assert.match(going, /<summary>Copy k7m2 · 1 bot<\/summary><p class="overview-note">Grok Bot<\/p><\/details><span class="overview-note">Removing on the Connector&#x27;s next run<\/span>/)
})

test('Connect bots shows only the prompt to paste; CONNECTOR.md stays a file the app keeps, listed under Files the Connector uses', () => {
  const step = readFileSync(new URL('../../src/components/ConnectGrok.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(step, /Show the Connector&apos;s rules/)
  assert.doesNotMatch(step, /connectorGuide\(/)
  assert.match(step, /Show the prompt/)
  const copy = readFileSync(new URL('../../src/components/sync-copy.ts', import.meta.url), 'utf8')
  assert.match(copy, /at\(orgs, 'CONNECTOR\.md'\)/)
})
