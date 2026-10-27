import assert from 'node:assert/strict'
import test from 'node:test'
import { managerLoop, parseSeatMarkdown, serializeSeat } from '../src/org-files.ts'

const SEAT = `---
title: "Security - botseverywhere"
department: "general"
reportsTo: "inner-loop"
alsoReportsTo: "[\\"outer-loop\\",\\"grok-bot\\"]"
addToGrokBotUrl: ""
status: active
kind: bot
role: "Secrets hygiene"
personId: ""
hiredAt: ""
retiredAt: ""
directoryId: ""
---

## Owns
Secrets hygiene

## May

## Needs approval

## Done when
`

const EXISTING = `---
name: "Security - botseverywhere"
kind: bot
source: existing
grokBotUrl: "grokbot://app/v1/agent?id=sec"
reportsTo: "inner-loop"
alsoReportsTo: "[\\"outer-loop\\"]"
---

## Owns
Secrets hygiene
`

test('alsoReportsTo is read from a seat file and written back right after reportsTo', () => {
  const parsed = parseSeatMarkdown('security', SEAT)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.deepEqual(parsed.seat.alsoReportsTo, ['outer-loop', 'grok-bot'])
  const lines = serializeSeat(parsed.seat).split('\n')
  const at = lines.findIndex((line) => line.startsWith('reportsTo:'))
  assert.equal(lines[at + 1], 'alsoReportsTo: "[\\"outer-loop\\",\\"grok-bot\\"]"')
  const again = parseSeatMarkdown('security', serializeSeat(parsed.seat))
  assert.ok(again.ok)
  assert.deepEqual(again.seat.alsoReportsTo, ['outer-loop', 'grok-bot'])
})

test('a bot added from Grok Bot keeps alsoReportsTo in its own format', () => {
  const parsed = parseSeatMarkdown('security', EXISTING)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.deepEqual(parsed.seat.alsoReportsTo, ['outer-loop'])
  assert.match(serializeSeat(parsed.seat), /\nreportsTo: inner-loop\nalsoReportsTo: "\[\\"outer-loop\\"\]"\n/)
})

test('a seat file without alsoReportsTo has none and writes no line', () => {
  const parsed = parseSeatMarkdown('security', SEAT.replace(/alsoReportsTo:.*\n/, ''))
  assert.ok(parsed.ok)
  assert.equal(parsed.seat.alsoReportsTo, undefined)
  assert.doesNotMatch(serializeSeat(parsed.seat), /alsoReportsTo/)
})

test('a bad alsoReportsTo never makes a seat unreadable: bad entries, the seat itself, its main manager, and repeats are dropped', () => {
  const messy = SEAT.replace(/alsoReportsTo:.*\n/, 'alsoReportsTo: "[\\"outer-loop\\",\\"Not A Slug\\",\\"security\\",\\"inner-loop\\",\\"outer-loop\\"]"\n')
  const parsed = parseSeatMarkdown('security', messy)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.deepEqual(parsed.seat.alsoReportsTo, ['outer-loop'])
  const broken = parseSeatMarkdown('security', SEAT.replace(/alsoReportsTo:.*\n/, 'alsoReportsTo: "not json"\n'))
  assert.ok(broken.ok, 'unreadable JSON is ignored, not fatal')
  assert.equal(broken.seat.alsoReportsTo, undefined)
})

test('a seat file with a byte-order mark and CRLF keeps alsoReportsTo', () => {
  const parsed = parseSeatMarkdown('security', `﻿${SEAT.replace(/\n/g, '\r\n')}`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.deepEqual(parsed.seat.alsoReportsTo, ['outer-loop', 'grok-bot'])
})

test('chart seats carry alsoReportsTo from the seat files', async () => {
  const { companyFromBundle } = await import('../../src/org/company.ts')
  const { bundleFromState } = await import('../src/org-files.ts')
  const parsed = parseSeatMarkdown('security', SEAT)
  assert.ok(parsed.ok)
  const bundle = bundleFromState('org-test', { company: { name: 'Acme' }, departments: [], people: [], seats: [{ slug: 'security', reportsTo: 'inner-loop' }] }, [parsed.seat], { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })
  assert.deepEqual(companyFromBundle(bundle).seats[0]?.alsoReportsTo, ['outer-loop', 'grok-bot'])
})

test('managerLoop finds a loop through any mix of main and also lines, and nothing otherwise', () => {
  const tree = [
    { slug: 'you', reportsTo: '' },
    { slug: 'grok-bot', reportsTo: 'you' },
    { slug: 'inner-loop', reportsTo: 'grok-bot' },
    { slug: 'outer-loop', reportsTo: 'grok-bot' },
    { slug: 'security', reportsTo: 'inner-loop', alsoReportsTo: ['outer-loop'] },
  ]
  assert.equal(managerLoop(tree), null)
  const looped = tree.map((seat) => (seat.slug === 'outer-loop' ? { ...seat, alsoReportsTo: ['security'] } : seat))
  assert.ok(['security', 'outer-loop'].includes(managerLoop(looped) ?? ''), 'security → outer-loop (also) → security')
  assert.equal(managerLoop([{ slug: 'a', reportsTo: 'b' }, { slug: 'b', reportsTo: 'a' }]) !== null, true, 'main lines alone still count')
})

/** You, then Grok Bot, then Inner Loop and Outer Loop under Grok Bot, then Security under Inner Loop. Every bot is in Grok Bot. */
async function team() {
  const { mkdirSync, mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createExistingBot, createOrgFiles } = await import('../src/template-server.ts')
  const dir = mkdtempSync(join(tmpdir(), 'be-also-'))
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

test('saving extra managers writes them to the seat and puts their names on one update request', async () => {
  const { readOrgDir, readRequests, setSeatManagers } = await import('../src/template-server.ts')
  const t = await team()
  try {
    const saved = setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer])
    assert.ok(saved.ok, saved.ok ? '' : saved.errors.join(' '))
    assert.equal(saved.sent, true)
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    const seat = read.bundle.seats.find((item) => item.slug === t.security)
    assert.equal(seat?.reportsTo, t.inner)
    assert.deepEqual(seat?.alsoReportsTo, [t.outer])
    const waiting = readRequests(t.root).requests
    assert.equal(waiting.length, 1)
    assert.equal(waiting[0]!.kind, 'update')
    assert.deepEqual(waiting[0]!.alsoReportsTo, ['Outer Loop'])
  } finally {
    t.done()
  }
})

test('saving the same managers again changes nothing and asks nothing', async () => {
  const { readRequests, setSeatManagers } = await import('../src/template-server.ts')
  const t = await team()
  try {
    assert.ok(setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer]).ok)
    const first = readRequests(t.root).requests[0]!.requestedAt
    const again = setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer])
    assert.ok(again.ok)
    assert.equal(again.sent, false)
    assert.equal(readRequests(t.root).requests[0]!.requestedAt, first)
  } finally {
    t.done()
  }
})

test('an extra manager that is not a seat, or that makes a loop, is refused and nothing is written', async () => {
  const { readFileSync } = await import('node:fs')
  const { readRequests, seatFile, setSeatManagers, startTemplateServer } = await import('../src/template-server.ts')
  const t = await team()
  const started = await startTemplateServer({ port: 0, orgsDir: t.orgs, host: '127.0.0.1' })
  try {
    const unknown = setSeatManagers(t.root, t.org, t.security, t.inner, ['nobody'])
    assert.equal(unknown.ok, false)
    assert.ok(setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer]).ok)
    const before = readFileSync(seatFile(t.root, t.outer)!, 'utf8')
    const requests = readRequests(t.root).requests.length
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${t.org}/seats/${t.outer}/manager`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportsTo: t.grok, alsoReportsTo: [t.security] }),
    })
    assert.equal(response.status, 422)
    const body = (await response.json()) as { errors: string[] }
    assert.match(body.errors.join(' '), /loop/i)
    assert.equal(readFileSync(seatFile(t.root, t.outer)!, 'utf8'), before)
    assert.equal(readRequests(t.root).requests.length, requests)
  } finally {
    await started.close()
    t.done()
  }
})

test('moving the main manager under a dotted-line report is refused as a loop', async () => {
  const { readFileSync } = await import('node:fs')
  const { seatFile, setSeatManager, setSeatManagers } = await import('../src/template-server.ts')
  const t = await team()
  try {
    assert.ok(setSeatManagers(t.root, t.org, t.security, t.inner, [t.outer]).ok)
    const before = readFileSync(seatFile(t.root, t.outer)!, 'utf8')
    const moved = setSeatManager(t.root, t.org, t.outer, t.security)
    assert.equal(moved.ok, false)
    assert.match(moved.ok ? '' : moved.errors.join(' '), /loop/i)
    assert.equal(readFileSync(seatFile(t.root, t.outer)!, 'utf8'), before)
  } finally {
    t.done()
  }
})
