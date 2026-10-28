import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, GUIDE_FILE, TODO_FILE } from '../src/connector-files.ts'
import type { TodoFile } from '../src/connector-todo.ts'
import { snapshotFromData, snapshotJson, type GrokData } from '../src/grok-data.ts'
import { parseSnapshot } from '../src/grok-sync.ts'
import { ensureProjectId, readConnector, CONNECTOR_FILE } from '../src/project.ts'
import { createExistingBot, createOrgFiles, readOrgDir, readRequests, setSeatManagers, startTemplateServer } from '../src/template-server.ts'

function team() {
  const dir = mkdtempSync(join(tmpdir(), 'be-cycle-'))
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
  const inner = add('Inner Loop', 'inner', grok)
  const outer = add('Outer Loop', 'outer', grok)
  const security = add('Security', 'security', inner)
  return { orgs, root, org: made.slug, grok, inner, outer, security, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function dump(at: string, descriptions: Record<string, string> = {}, extra: GrokData['bots'] = []): GrokData {
  const bot = (id: string, name: string) => ({ id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description: descriptions[id] ?? `${name} works.`, routinesVisible: false })
  return { dumpedAt: at, copy: '', bots: [bot('grok', 'Grok Bot'), bot('inner', 'Inner Loop'), bot('outer', 'Outer Loop'), bot('security', 'Security'), ...extra], skills: [] }
}

const write = (orgs: string, data: GrokData) => writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify(data))
const todo = (orgs: string): TodoFile | null => (existsSync(join(orgs, TODO_FILE)) ? JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as TodoFile : null)

async function until(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return check()
}

test('the snapshot the app writes reads back the same', () => {
  const t = team()
  try {
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    const data = dump('2026-10-28T10:00:00+01:00')
    data.bots[0] = { ...data.bots[0]!, runs30d: 4, routinesVisible: true, routines: [{ name: 'Daily summary', schedule: '15 18 * * 1-5', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true }] }
    const snapshot = snapshotFromData(data, read.bundle, 'Desk', ensureProjectId(t.orgs), [{ name: 'GitHub', status: 'connected' }], [])
    const back = parseSnapshot(snapshotJson({ ...snapshot, updated: [{ seat: t.security, requestedAt: '2026-10-28T09:00:00.000Z' }] }), '')
    assert.ok(back.ok, back.ok ? '' : back.error)
    assert.deepEqual(back.snapshot.bots.map((row) => [row.name, row.reportsTo, row.runs30d, row.routines.map((routine) => routine.name), row.apps]), snapshot.bots.map((row) => [row.name, row.reportsTo, row.runs30d, row.routines.map((routine) => routine.name), row.apps]))
    assert.deepEqual(back.snapshot.processes.map((process) => process.name), ['Daily summary'])
    assert.deepEqual(back.snapshot.updated, [{ seat: t.security, requestedAt: '2026-10-28T09:00:00.000Z' }])
  } finally {
    t.done()
  }
})

test('on start the writer writes CONNECTOR.md, processes a dump already there, and rewrites the rules when the interval changes', async () => {
  const t = team()
  write(t.orgs, dump('2026-10-28T10:00:00+01:00'))
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    assert.match(readFileSync(join(t.orgs, GUIDE_FILE), 'utf8'), /\nSchedule: every 15 minutes\./)
    const first = todo(t.orgs)
    assert.ok(first, 'the to-do list is written on start')
    assert.equal(first.items.filter((item) => item.kind === 'describe').length, 4)
    assert.ok(existsSync(join(t.root, 'grok', 'snapshot.json')))
    const response = await fetch(`http://127.0.0.1:${started.port}/api/project/sync-minutes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: 120 }) })
    assert.equal(response.status, 200)
    assert.match(readFileSync(join(t.orgs, GUIDE_FILE), 'utf8'), /\nSchedule: every 2 hours\./)
  } finally {
    await started.close()
    t.done()
  }
})

test('a new manager reaches the to-do list within seconds', async () => {
  const t = team()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    write(t.orgs, dump('2026-10-28T10:00:00+01:00'))
    assert.ok(await until(() => Boolean(todo(t.orgs))))
    assert.ok(setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer]).ok)
    const security = () => todo(t.orgs)?.items.find((item) => item.kind === 'describe' && item.botId === 'security')?.description ?? ''
    assert.ok(await until(() => security().includes('Also reports to: Outer Loop (id outer)')), security())
  } finally {
    await started.close()
    t.done()
  }
})

test('a bad dump changes no file and says why', () => {
  const t = team()
  try {
    write(t.orgs, dump('2026-10-28T10:00:00+01:00'))
    assert.ok(runConnectorCycle(t.orgs, ensureProjectId(t.orgs)).ok)
    const before = [readFileSync(join(t.orgs, TODO_FILE), 'utf8'), readFileSync(join(t.root, 'grok', 'snapshot.json'), 'utf8')]
    writeFileSync(join(t.orgs, GROK_DATA_FILE), '{"dumpedAt":"2026-10-28T11:00:00+01:00","bots":[{"name":"No id"}]}')
    const result = runConnectorCycle(t.orgs, ensureProjectId(t.orgs))
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.error, /no id/)
    assert.deepEqual([readFileSync(join(t.orgs, TODO_FILE), 'utf8'), readFileSync(join(t.root, 'grok', 'snapshot.json'), 'utf8')], before)
  } finally {
    t.done()
  }
})

test('with no dump yet, the snapshot the old Connector wrote is left alone', () => {
  const t = team()
  try {
    mkdirSync(join(t.root, 'grok'), { recursive: true })
    writeFileSync(join(t.root, 'grok', 'snapshot.json'), '{"syncedAt":"2026-10-27T10:00:00Z","bots":[]}')
    const result = runConnectorCycle(t.orgs, ensureProjectId(t.orgs))
    assert.equal(result.ok, false)
    assert.equal(readFileSync(join(t.root, 'grok', 'snapshot.json'), 'utf8'), '{"syncedAt":"2026-10-27T10:00:00Z","bots":[]}')
    assert.equal(existsSync(join(t.orgs, TODO_FILE)), false)
  } finally {
    t.done()
  }
})

test('once Grok Bot shows the new blocks, the waiting update clears and logs Updated in Grok Bot', async () => {
  const t = team()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    assert.ok(setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer]).ok)
    assert.equal(readRequests(t.root).requests.length, 1)
    write(t.orgs, dump('2026-10-28T10:00:00+01:00'))
    assert.ok(await until(() => (todo(t.orgs)?.items.filter((item) => item.kind === 'describe').length ?? 0) === 4))
    const written = Object.fromEntries(todo(t.orgs)!.items.filter((item) => item.kind === 'describe').map((item) => [item.botId!, item.description!]))
    write(t.orgs, dump('2026-10-28T10:20:00+01:00', written))
    assert.ok(await until(() => readRequests(t.root).requests.length === 0), 'the update clears')
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    assert.ok(read.bundle.activity.some((item) => item.summary === 'Updated in Grok Bot: Security'))
    const backups = join(t.orgs, 'connector-backups', 'security')
    assert.ok(readdirSync(backups).some((name) => readFileSync(join(backups, name), 'utf8') === 'Security works.'), 'the text before the change is kept')
  } finally {
    await started.close()
    t.done()
  }
})

test('bots in no organization come from the dump', () => {
  const t = team()
  try {
    writeFileSync(join(t.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-28T10:00:00+01:00', syncMinutes: 15, unassigned: [] }))
    write(t.orgs, dump('2026-10-28T10:00:00+01:00', {}, [{ id: 'stray', name: 'Stray Bot', grokBotUrl: 'grokbot://app/v1/agent?id=stray', description: 'Nobody asked.', routinesVisible: false }]))
    assert.ok(runConnectorCycle(t.orgs, ensureProjectId(t.orgs)).ok)
    assert.deepEqual(readConnector(t.orgs)?.unassigned.map((bot) => bot.name), ['Stray Bot'])
  } finally {
    t.done()
  }
})

test("a bot's own profile gives the snapshot its routines, paused ones included, in place of what Grok Bot's files show; reported skills stay off the seat", () => {
  const t = team()
  try {
    const stale = { id: 'aura', name: 'Aura', grokBotUrl: 'grokbot://app/v1/agent?id=aura', description: 'Aura works.', routinesVisible: true, routines: [{ name: 'Old health', schedule: '0 9 * * 1-5', trigger: 'schedule' as const, timeZone: 'Europe/Madrid', enabled: true }] }
    const data = dump('2026-10-28T16:00:00+01:00')
    data.bots = data.bots.map((bot) => (bot.id === 'inner' ? { ...bot, routinesVisible: true, routines: stale.routines } : bot))
    write(t.orgs, data)
    writeFileSync(join(t.orgs, 'connector-results.json'), JSON.stringify({ results: [], confirmations: [{
      line: `BotsEverywhere profile: ${t.org} | ${t.inner}\nRoutines:\n- Milestone check | 0 9,21 * * * | Europe/Madrid | paused | never\nSkills:\n- graph-skill | Export the team\nSends:\n- none\nReceives:\n- none`,
      from: 'Inner Loop',
      at: '2026-10-28T16:05:00+01:00',
    }] }))
    assert.ok(runConnectorCycle(t.orgs, ensureProjectId(t.orgs)).ok)
    const snap = parseSnapshot(readFileSync(join(t.root, 'grok', 'snapshot.json'), 'utf8'), '')
    assert.ok(snap.ok)
    if (!snap.ok) return
    const inner = snap.snapshot.bots.find((bot) => bot.name === 'Inner Loop')!
    assert.deepEqual(inner.routines.map((routine) => [routine.name, routine.enabled]), [['Milestone check', false]], "the bot's own list replaces the stale files")
    assert.deepEqual(inner.skills, [], "skills the bot has turned on are not skills it should use, so the seat's skills and its block are left alone")
    assert.ok(snap.snapshot.processes.some((process) => process.name === 'Milestone check'), 'Sync can offer it as a process')
  } finally {
    t.done()
  }
})
