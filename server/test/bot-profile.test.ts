import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSeatMarkdown, serializeExistingSeat, serializeSeat } from '../src/org-files.ts'

const INSTRUCTIONS = 'Sort new leads against the ideal-customer points.\nNever contact a lead: say "ask Miguel" instead.'
const SKILLS = [{ name: 'Lead sort', description: 'Match a new lead to the ideal-customer points.' }, { name: 'Weekly recap' }]
const ROUTINES = [{ name: 'Weekday lead sweep', schedule: 'Weekdays 09:00', description: 'Sweep new leads each morning.' }]

const HIRED = `---
title: Lead Sorter
department: general
reportsTo: you
addToGrokBotUrl: ""
status: active
kind: bot
role: Lead Sorter
personId: ""
hiredAt: ""
retiredAt: ""
directoryId: ""
instructions: ${JSON.stringify(INSTRUCTIONS)}
skills: ${JSON.stringify(JSON.stringify(SKILLS))}
routines: ${JSON.stringify(JSON.stringify(ROUTINES))}
publicUrl: "https://x.ai/bot/lead-sorter"
---

## Owns
Sorting new leads

## May

## Needs approval
Contacting a lead

## Done when
Every new lead is marked
`

test('a seat keeps its instructions, skills, routines with a line on what they do, and public link', () => {
  const parsed = parseSeatMarkdown('lead-sorter', HIRED)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.equal(parsed.seat.instructions, INSTRUCTIONS, 'line breaks and quotes survive')
  assert.deepEqual(parsed.seat.skills, SKILLS)
  assert.deepEqual(parsed.seat.routines, ROUTINES)
  assert.equal(parsed.seat.publicUrl, 'https://x.ai/bot/lead-sorter')
  const again = parseSeatMarkdown('lead-sorter', serializeSeat(parsed.seat))
  assert.ok(again.ok)
  assert.equal(again.seat.instructions, INSTRUCTIONS)
  assert.deepEqual(again.seat.skills, SKILLS)
  assert.deepEqual(again.seat.routines, ROUTINES)
  assert.equal(again.seat.publicUrl, 'https://x.ai/bot/lead-sorter')
})

test('an imported bot keeps its skills and public link through its own file format', () => {
  const written = serializeExistingSeat({ name: 'Grok Bot', grokBotUrl: 'grokbot://app/v1/agent?id=1', reportsTo: 'you', owns: ['Route any task'], may: [], mustAskBefore: [], doneWhen: [], skills: SKILLS, publicUrl: 'https://x.ai/bot/grok-bot', instructions: INSTRUCTIONS })
  const parsed = parseSeatMarkdown('grok-bot', written)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.equal(parsed.seat.seatOrigin, 'existing')
  assert.deepEqual(parsed.seat.skills, SKILLS)
  assert.equal(parsed.seat.publicUrl, 'https://x.ai/bot/grok-bot')
  assert.equal(parsed.seat.instructions, INSTRUCTIONS)
  const again = parseSeatMarkdown('grok-bot', serializeSeat(parsed.seat))
  assert.ok(again.ok)
  assert.deepEqual(again.seat.skills, SKILLS)
  assert.equal(again.seat.publicUrl, 'https://x.ai/bot/grok-bot')
})

test('bad skills and a link that is not https are left out, never a broken seat; old routines still load', () => {
  const messy = HIRED
    .replace(/^skills: .*$/m, `skills: ${JSON.stringify(JSON.stringify([{ description: 'no name' }, 'text', { name: '  Kept  ' }]))}`)
    .replace(/^publicUrl: .*$/m, 'publicUrl: "javascript:alert(1)"')
    .replace(/^routines: .*$/m, `routines: ${JSON.stringify(JSON.stringify([{ name: 'Daily brief', schedule: 'Mon 09:00', lastRun: '2026-10-20T09:00:00.000Z' }]))}`)
  const parsed = parseSeatMarkdown('lead-sorter', messy)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  assert.deepEqual(parsed.seat.skills, [{ name: 'Kept' }])
  assert.equal(parsed.seat.publicUrl, undefined)
  assert.deepEqual(parsed.seat.routines, [{ name: 'Daily brief', schedule: 'Mon 09:00', lastRun: '2026-10-20T09:00:00.000Z' }])
  const notList = parseSeatMarkdown('lead-sorter', HIRED.replace(/^skills: .*$/m, 'skills: not a list'))
  assert.ok(notList.ok)
  assert.equal(notList.seat.skills, undefined)
})
