import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseSeatMarkdown, serializeExistingSeat, serializeSeat } from '../src/org-files.ts'
import { createExistingBot, createOrgFiles, startTemplateServer } from '../src/template-server.ts'

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

async function withServer(run: (base: string, orgs: string, org: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'be-profile-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    await run(`http://127.0.0.1:${started.port}`, orgs, made.slug)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function seatIn(orgs: string, org: string, slug: string) {
  const parsed = parseSeatMarkdown(slug, readFileSync(join(orgs, org, 'seats', `${slug}.md`), 'utf8'))
  assert.ok(parsed.ok)
  return parsed.seat
}

const put = (base: string, org: string, seat: string, body: unknown) =>
  fetch(`${base}/api/orgs/${org}/seats/${seat}/profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('Profile saves a hand-added bot\'s instructions, skills, and routines, and leaves its card and manager alone', async () => {
  await withServer(async (base, orgs, org) => {
    const added = await fetch(`${base}/api/orgs/${org}/seats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Lead Sorter', kind: 'bot', slug: 'lead-sorter', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', owns: ['Sorting new leads'], may: ['Read the lead list'], mustAskBefore: ['Contacting a lead'], doneWhen: ['Every lead is marked'] }) })
    assert.equal(added.status, 201, await added.text())
    const saved = await put(base, org, 'lead-sorter', { instructions: INSTRUCTIONS, skills: [...SKILLS, { description: 'no name' }], routines: ROUTINES })
    assert.equal(saved.status, 200, await saved.text())
    const seat = seatIn(orgs, org, 'lead-sorter')
    assert.equal(seat.instructions, INSTRUCTIONS)
    assert.deepEqual(seat.skills, SKILLS, 'a skill without a name is left out')
    assert.deepEqual(seat.routines, ROUTINES)
    assert.deepEqual(seat.owns, ['Sorting new leads'], 'the seat card is untouched')
    assert.equal(seat.reportsTo, 'you', 'the manager is untouched')
    assert.equal((await put(base, org, 'lead-sorter', { skills: [] })).status, 200)
    assert.equal(seatIn(orgs, org, 'lead-sorter').skills, undefined, 'an empty list clears the skills')
    assert.equal(seatIn(orgs, org, 'lead-sorter').instructions, INSTRUCTIONS, 'a field left out stays as it was')
  })
})

test('an imported bot\'s skills and routines come from Grok Bot, so Profile refuses to change them', async () => {
  await withServer(async (base, orgs, org) => {
    const imported = createExistingBot(join(orgs, org), org, { name: 'Grok Bot', grokBotUrl: 'grokbot://app/v1/agent?id=1', reportsTo: 'you', allowEmptyCard: true, routines: [{ name: 'daily summary', schedule: '15 18 * * 1-5' }] })
    assert.ok(imported.ok, imported.ok ? '' : imported.errors.join(' '))
    const refused = await put(base, org, imported.slug, { skills: SKILLS })
    assert.equal(refused.status, 422)
    assert.deepEqual(seatIn(orgs, org, imported.slug).routines, [{ name: 'daily summary', schedule: '15 18 * * 1-5' }])
    assert.equal((await put(base, org, 'nobody', { instructions: 'x' })).status, 422)
  })
})
