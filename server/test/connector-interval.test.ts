import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { checkConnectorStopped, recordConnectorRun } from '../src/connector-log.ts'
import { everyLabel, joinSyncMinutes, splitSyncMinutes, staleMinutes, validSyncMinutes } from '../src/connector-timing.ts'
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
  assert.equal(details[0], 'Grok Bot is connected.')
  assert.equal(details[1], 'The Connector syncs with Grok Bot every hour.')
  assert.match(details[2]!, /^Last sync: \d{2}:\d{2} \(10 min ago\)\.$/)
  assert.match(details[3]!, /^Next sync due around \d{2}:\d{2}\.$/)

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
})
