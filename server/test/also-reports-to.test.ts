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
