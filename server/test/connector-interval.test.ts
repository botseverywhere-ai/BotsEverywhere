import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { checkConnectorStopped, recordConnectorRun } from '../src/connector-log.ts'
import { everyLabel, joinSyncMinutes, scheduleFor, splitSyncMinutes, staleMinutes, validSyncMinutes } from '../src/connector-timing.ts'
import { CONNECTOR_FILE, PROJECT_FILE, ensureProjectId, readSyncMinutes, writeSyncMinutes } from '../src/project.ts'
import { createOrgFiles, startTemplateServer } from '../src/template-server.ts'
import { connectorDetails, connectorState } from '../../src/components/sync-copy.ts'

test('the interval reads as words, splits into a number and a unit, and stays between 15 minutes and 7 days', () => {
  assert.equal(everyLabel(15), '15 minutes')
  assert.equal(everyLabel(60), 'hour')
  assert.equal(everyLabel(90), '90 minutes')
  assert.equal(everyLabel(120), '2 hours')
  assert.equal(everyLabel(1440), 'day')
  assert.equal(everyLabel(2880), '2 days')
  assert.deepEqual(splitSyncMinutes(30), { amount: 30, unit: 'minutes' })
  assert.deepEqual(splitSyncMinutes(180), { amount: 3, unit: 'hours' })
  assert.deepEqual(splitSyncMinutes(1440), { amount: 1, unit: 'days' })
  assert.equal(joinSyncMinutes('2', 'hours'), 120)
  assert.ok(Number.isNaN(joinSyncMinutes('', 'hours')))
  assert.equal(validSyncMinutes(30), 30)
  assert.equal(validSyncMinutes(10), null, 'under 15 minutes')
  assert.equal(validSyncMinutes(8 * 1440), null, 'over 7 days')
  assert.equal(validSyncMinutes(22.5), null, 'whole minutes only')
  assert.equal(staleMinutes(60), 120, 'two missed runs')
})

test('the Connector prompt runs at the saved interval', () => {
  assert.match(connectorPrompt({ id: 'k3f9', orgsFolder: '/o' }), /Run this routine every 15 minutes\./)
  assert.match(connectorPrompt({ id: 'k3f9', orgsFolder: '/o', syncMinutes: 120 }), /Run this routine every 2 hours\./)
})

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-interval-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  return { orgs, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('project.json keeps the id and the interval together, and a bad file never breaks it', () => {
  const { orgs, done } = project()
  try {
    assert.equal(readSyncMinutes(orgs), 15, 'no file: the default')
    const id = ensureProjectId(orgs)
    assert.deepEqual(JSON.parse(readFileSync(join(orgs, PROJECT_FILE), 'utf8')), { id }, 'the default is not written')
    assert.deepEqual(writeSyncMinutes(orgs, 60), { ok: true, minutes: 60 })
    assert.deepEqual(JSON.parse(readFileSync(join(orgs, PROJECT_FILE), 'utf8')), { id, syncMinutes: 60 })
    assert.equal(ensureProjectId(orgs), id, 'the id is kept')
    assert.equal(writeSyncMinutes(orgs, 5).ok, false)
    assert.equal(readSyncMinutes(orgs), 60)
    writeFileSync(join(orgs, PROJECT_FILE), `﻿{"id":"k3f9","syncMinutes":"lots"}\r\n`, 'utf8')
    assert.equal(readSyncMinutes(orgs), 15, 'a bad value is the default')
    writeFileSync(join(orgs, PROJECT_FILE), '{broken', 'utf8')
    assert.equal(readSyncMinutes(orgs), 15)
  } finally {
    done()
  }
})

test('the writer saves the interval from this computer only, and the sync status carries it', async () => {
  const { orgs, done } = project()
  const made = createOrgFiles(orgs, 'Desk', 'Ada')
  assert.equal(made.ok, true)
  if (!made.ok) return done()
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api`
  const json = { 'content-type': 'application/json' }
  try {
    assert.equal((await fetch(`${base}/project/sync-minutes`, { method: 'PUT', headers: json, body: JSON.stringify({ minutes: 60 }) })).status, 200)
    assert.equal((await fetch(`${base}/project/sync-minutes`, { method: 'PUT', headers: json, body: JSON.stringify({ minutes: 3 }) })).status, 422)
    assert.equal((await fetch(`${base}/project/sync-minutes`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ minutes: 30 }) })).status, 415)
    assert.equal((await fetch(`${base}/project/sync-minutes`, { method: 'PUT', headers: { ...json, origin: 'https://evil.example' }, body: JSON.stringify({ minutes: 30 }) })).status, 403)
    const status = (await (await fetch(`${base}/orgs/${made.slug}/sync`)).json()) as { project: { syncMinutes: number } }
    assert.equal(status.project.syncMinutes, 60)
  } finally {
    await started.close()
    done()
  }
})

test('Disconnected and Connector stopped wait for two missed runs at the set interval', () => {
  const now = Date.parse('2026-10-20T15:00:00.000Z')
  const ranAgo = (minutes: number) => ({ snapshot: null, error: '', project: { id: 'k3f9', connectorName: 'C', orgsFolder: '/o', connector: { stamp: `${now - minutes * 60_000}:10`, syncedAt: '', error: '' }, unassigned: [], bots: 0, renamed: {}, syncMinutes: 60 } })
  assert.equal(connectorState(ranAgo(45), now).state, 'connected', '45 minutes is not late for an hourly Connector')
  assert.equal(connectorState(ranAgo(125), now).state, 'stale')
  const details = connectorDetails(ranAgo(10), now)
  assert.equal(details.title, 'Connected to Grok Bot')
  assert.equal(details.note, 'The Connector syncs your organizations with Grok Bot every hour.')
  assert.deepEqual(details.facts.map(([label]) => label), ['Runs every', 'Last sync', 'Next sync'])
  assert.equal(details.facts[0]![1], 'hour')
  assert.match(details.facts[1]![1], /^\d{2}:\d{2}, 10 min ago$/)
  assert.match(details.facts[2]![1], /^around \d{2}:\d{2}$/)
  assert.equal(connectorDetails(ranAgo(125), now).title, 'Connector stopped')

  const { orgs, done } = project()
  try {
    createOrgFiles(orgs, 'Desk', 'Ada')
    writeSyncMinutes(orgs, 60)
    const ran = new Date(Date.now() - 45 * 60_000)
    const path = join(orgs, CONNECTOR_FILE)
    writeFileSync(path, JSON.stringify({ syncedAt: ran.toISOString(), unassigned: [] }))
    utimesSync(path, ran, ran)
    recordConnectorRun(orgs, 'Connector')
    checkConnectorStopped(orgs)
    assert.equal(JSON.parse(readFileSync(join(orgs, 'connector-log.json'), 'utf8')).state, 'connected', 'an hourly Connector 45 minutes in is not stopped')
    checkConnectorStopped(orgs, new Date(Date.now() + 90 * 60_000))
    assert.equal(JSON.parse(readFileSync(join(orgs, 'connector-log.json'), 'utf8')).state, 'stopped')
  } finally {
    done()
  }
})

test('the header status opens a dropdown, and Connect bots has the interval row', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const badge = read('../../src/components/GrokStatusBadge.tsx')
  const connect = read('../../src/components/ConnectGrok.tsx')
  assert.match(badge, /<details ref=\{menuRef\} className="grok-status-menu">/)
  assert.match(badge, /connectorDetails\(status, now\)/)
  assert.match(connect, /<label htmlFor="connect-interval-amount">Runs every<\/label>/)
  assert.match(connect, /<option value="hours">hours<\/option>/)
  assert.match(connect, /The Connector will sync with Grok Bot every \$\{everyLabel\(minutes\)\}/)
  assert.match(connect, /disabled=\{!editing \|\| busy\}/, 'locked until Change')
  assert.match(connect, /<LockIcon open \/>Change<\/Button>/, 'Change shows an open lock')
  assert.match(badge, /Open Connect bots/)
})

test('the Connector reports its interval, and the app warns until it matches what was saved', async () => {
  const { intervalWarning, runMinutes } = await import('../../src/components/sync-copy.ts')
  const { readConnector } = await import('../src/project.ts')
  assert.match(connectorPrompt({ id: 'k3f9', orgsFolder: '/o', syncMinutes: 17 }), /"syncMinutes": 17 \(how often you run, in minutes\)/)

  const { orgs, done } = project()
  try {
    const write = (body: object) => writeFileSync(join(orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-20T15:00:00Z', unassigned: [], ...body }))
    write({ syncMinutes: 17 })
    assert.equal(readConnector(orgs)?.syncMinutes, 17)
    write({})
    assert.equal(readConnector(orgs)?.syncMinutes, undefined, 'an older prompt reports nothing')
    write({ syncMinutes: 'often' })
    assert.equal(readConnector(orgs)?.syncMinutes, undefined, 'a bad value is ignored')
  } finally {
    done()
  }

  const info = (saved: number | undefined, reported: number | undefined) => ({ syncMinutes: saved, connector: { stamp: '1:1', syncedAt: '', error: '', ...(reported ? { syncMinutes: reported } : {}) } })
  assert.equal(intervalWarning(info(17, 17)), '', 'pasted: no warning')
  assert.equal(intervalWarning(info(17, 15)), 'Grok Bot still runs the Connector every 15 minutes, not every 17 minutes. Copy the prompt on Connect bots and paste it into the Connector.')
  assert.match(intervalWarning(info(15, undefined)), /has not said how often it runs/)
  assert.equal(intervalWarning({ syncMinutes: 17, connector: null }), '', 'no Connector yet: nothing to compare')
  assert.equal(runMinutes(info(15, 120)), 120, 'Disconnected waits for the interval Grok Bot really uses')
  assert.equal(runMinutes(info(60, undefined)), 60)

  const now = Date.parse('2026-10-20T15:00:00.000Z')
  const status = { snapshot: null, error: '', project: { id: 'k3f9', connectorName: 'C', orgsFolder: '/o', connector: { stamp: `${now - 45 * 60_000}:10`, syncedAt: '', error: '', syncMinutes: 120 }, unassigned: [], bots: 0, renamed: {}, syncMinutes: 15 } }
  assert.equal(connectorState(status, now).state, 'connected', 'saved 15 but never pasted: a 2-hour Connector 45 minutes in is not Disconnected')
  assert.match(connectorDetails(status, now).warning, /still runs the Connector every 2 hours, not every 15 minutes/)
  const connect = readFileSync(new URL('../../src/components/ConnectGrok.tsx', import.meta.url), 'utf8')
  const badge = readFileSync(new URL('../../src/components/GrokStatusBadge.tsx', import.meta.url), 'utf8')
  assert.match(connect, /intervalWarning\(project\)/)
  assert.match(badge, /details\.warning \? <p className="grok-status-warning"/)
})

test('Connector stopped waits for the interval the Connector reports', () => {
  const { orgs, done } = project()
  try {
    createOrgFiles(orgs, 'Desk', 'Ada')
    const ran = new Date(Date.now() - 60 * 60_000)
    const path = join(orgs, CONNECTOR_FILE)
    writeFileSync(path, JSON.stringify({ syncedAt: ran.toISOString(), syncMinutes: 120, unassigned: [] }))
    utimesSync(path, ran, ran)
    recordConnectorRun(orgs, 'Connector')
    checkConnectorStopped(orgs)
    assert.equal(JSON.parse(readFileSync(join(orgs, 'connector-log.json'), 'utf8')).state, 'connected', 'saved 15, Connector says 120: an hour is not two missed runs')
  } finally {
    done()
  }
})

test("saving the interval moves the Connector's own process to it, and keeps the rest of its description", async () => {
  assert.equal(scheduleFor(15), '*/15 * * * *')
  assert.equal(scheduleFor(17), 'every 17 minutes', 'no cron line runs every 17 minutes')
  assert.equal(scheduleFor(120), '0 */2 * * *')
  assert.equal(scheduleFor(1440), '0 0 * * *')
  assert.equal(scheduleFor(300), 'every 5 hours')

  const { orgs, done } = project()
  const made = createOrgFiles(orgs, 'Desk', 'Ada')
  assert.equal(made.ok, true)
  if (!made.ok) return done()
  const root = join(orgs, made.slug)
  writeFileSync(join(root, 'seats', 'connector-botseverywhere-k3f9.md'), '---\ntitle: Connector - BotsEverywhere (k3f9)\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: Sync\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\n---\n\n## Owns\nSync\n\n## May\nRead\n\n## Needs approval\nNothing\n\n## Done when\nSynced\n', 'utf8')
  mkdirSync(join(root, 'processes'), { recursive: true })
  writeFileSync(join(root, 'processes', 'botseverywhere-sync.md'), '---\nname: BotsEverywhere sync\ntrigger: schedule\nschedule: "*/15 * * * *"\ndescription: "Every 15 minutes, Madrid time"\ndoneWhen: Synced.\n---\n\n## Steps\n\n- connector-botseverywhere-k3f9 | Sync\n\n## Notes\n\n', 'utf8')
  writeFileSync(join(root, 'processes', 'weekly.md'), '---\nname: Weekly\ntrigger: schedule\nschedule: "Mon 09:00"\ndescription: "Every Monday"\ndoneWhen: Done.\n---\n\n## Steps\n\n- you | Review\n\n## Notes\n\n', 'utf8')
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/project/sync-minutes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: 17 }) })
    const body = (await response.json()) as { processes: string[] }
    assert.deepEqual(body.processes, [`orgs/${made.slug}/processes/botseverywhere-sync.md`])
    const sync = readFileSync(join(root, 'processes', 'botseverywhere-sync.md'), 'utf8')
    assert.match(sync, /schedule: "?every 17 minutes"?\n/)
    assert.match(sync, /description: "?Every 17 minutes, Madrid time"?\n/)
    assert.match(readFileSync(join(root, 'processes', 'weekly.md'), 'utf8'), /schedule: "?Mon 09:00"?\n/, "another bot's process is untouched")
  } finally {
    await started.close()
    done()
  }
})
