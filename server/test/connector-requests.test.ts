import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { SyncPlan } from '../src/grok-sync.ts'
import { clearFulfilledRequests, createExistingBot, createOrgFiles, readOrgDir, readRequests, seatFile, startTemplateServer } from '../src/template-server.ts'

function team() {
  const dir = mkdtempSync(join(tmpdir(), 'be-requests-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const root = join(orgs, made.slug)
  const bot = createExistingBot(root, made.slug, { name: 'Security', grokBotUrl: 'grokbot://app/v1/agent?id=security', reportsTo: 'you', allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-27T10:00:00.000Z' })
  assert.ok(bot.ok, bot.ok ? '' : bot.errors.join(' '))
  return { orgs, root, org: made.slug, security: bot.slug, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const ROUTINE = { name: 'Weekly brief', schedule: '0 9 * * 1', trigger: 'schedule' as const, description: 'Writes the brief', enabled: true }

test('a created bot that came with skills or routines leaves one update asking for them', () => {
  const t = team()
  try {
    mkdirSync(join(t.root, 'grok'), { recursive: true })
    writeFileSync(join(t.root, 'grok', 'requests.json'), JSON.stringify({ requests: [{ seat: t.security, name: 'Security', seatFile: seatFile(t.root, t.security), prompt: '', skills: [{ name: 'Sweep', description: 'Sweeps.' }], routines: [ROUTINE], requestedAt: '2026-10-28T09:00:00.000Z' }] }))
    clearFulfilledRequests(t.root, t.org, { rows: [{ kind: 'unchanged', name: 'Security', slug: t.security }] } as unknown as SyncPlan)
    const waiting = readRequests(t.root).requests
    assert.equal(waiting.length, 1)
    assert.equal(waiting[0]!.kind, 'update')
    assert.deepEqual(waiting[0]!.skills, [{ name: 'Sweep', description: 'Sweeps.' }])
    assert.deepEqual(waiting[0]!.routines?.map((routine) => routine.name), ['Weekly brief'])
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    assert.ok(read.bundle.activity.some((item) => item.summary === 'Created in Grok Bot: Security'))
  } finally {
    t.done()
  }
})

test('the Work Chart no longer saves or simulates a flow; Delete still removes one and asks no bot for anything', async () => {
  const t = team()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api/orgs/${t.org}/processes`
  try {
    const file = { processes: [{ name: 'Weekly brief', trigger: { type: 'schedule', schedule: '0 9 * * 1' }, steps: [{ seat: 'Security', action: 'Write the brief' }] }] }
    assert.equal((await fetch(`${base}-file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) })).status, 200)
    const process = { slug: 'weekly-brief', name: 'Weekly brief', trigger: { type: 'schedule', schedule: '0 10 * * 1', source: '', description: '' }, steps: [{ seat: t.security, action: 'Write it' }], doneWhen: '', next: '', notes: '' }
    assert.equal((await fetch(`${base}/weekly-brief`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(process) })).status, 404, 'no saving: flows come from Grok Bot')
    assert.equal((await fetch(`${base}/weekly-brief/simulate`, { method: 'POST', body: '{}' })).status, 404, 'no simulated runs in the real run log')
    assert.equal((await fetch(`${base}/weekly-brief`, { method: 'DELETE' })).status, 200)
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    assert.equal(read.bundle.processes?.length ?? 0, 0)
    assert.deepEqual(readRequests(t.root).requests, [], 'nothing was asked of any bot')
  } finally {
    await started.close()
    t.done()
  }
})

test('importing a processes file from Grok Bot asks no bot for a routine: it describes routines the bots already run', async () => {
  const t = team()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    const file = { processes: [
      { name: 'Weekly brief', trigger: { type: 'schedule', schedule: '0 9 * * 1', description: 'Mondays at 09:00, Europe/Madrid' }, steps: [{ seat: 'Security', action: 'Write the brief' }] },
      { name: 'Transcript check', trigger: { type: 'schedule', schedule: '44 8 * * 1-5', description: 'Weekdays at 08:44, Europe/Madrid (paused)' }, steps: [{ seat: 'Security', action: 'Scan transcripts' }] },
    ] }
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${t.org}/processes-file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(file) })
    assert.equal(response.status, 200)
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    assert.equal(read.bundle.processes?.length, 2, 'both flows are imported')
    assert.deepEqual(readRequests(t.root).requests, [], 'nothing asks a bot to create or switch on a routine it already has')
  } finally {
    await started.close()
    t.done()
  }
})
