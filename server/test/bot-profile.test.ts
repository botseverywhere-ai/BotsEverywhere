import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseSeatMarkdown, serializeExistingSeat, serializeSeat } from '../src/org-files.ts'
import { createExistingBot, createHiredSeat, createOrgFiles, importBotsFile, readRequests, requestGrokBot, startTemplateServer, updateSeatProfile } from '../src/template-server.ts'
import { SNAPSHOT_FORMAT, connectorPrompt } from '../src/connector-prompt.ts'
import { GROK_BOTS_PROMPT } from '../../src/content/grok-bots-prompt.ts'
import { parseBotsFile } from '../src/bots-file.ts'
import { parseSnapshot, patchSeatSource, performanceOnly, planSync } from '../src/grok-sync.ts'

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

const LINK = 'grokbot://app/v1/agent?id=1'
const BOTS = JSON.stringify({ bots: [{ name: 'Grok Bot', grokBotUrl: LINK, skills: [...SKILLS, { description: 'no name' }], publicUrl: 'https://x.ai/bot/grok-bot' }, { name: 'Other Bot', publicUrl: 'ftp://nope' }] })

test('the bots file and the snapshot bring each bot\'s skills and public link; a link that is not https is left out with a note', () => {
  const parsed = parseBotsFile(BOTS)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.rows[0]!.skills, SKILLS)
  assert.equal(parsed.rows[0]!.publicUrl, 'https://x.ai/bot/grok-bot')
  assert.equal(parsed.rows[1]!.publicUrl, '')
  assert.match(parsed.rows[1]!.note, /publicUrl was left out/)
})

test('importing a bot writes its skills and public link onto the new seat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-profile-import-'))
  try {
    const made = createOrgFiles(dir, 'Desk', 'You')
    assert.ok(made.ok)
    const parsed = parseBotsFile(BOTS)
    assert.ok(parsed.ok)
    const result = importBotsFile(join(dir, made.slug), made.slug, parsed.rows.slice(0, 1))
    assert.equal(result.errors.length, 0, JSON.stringify(result.errors))
    const seat = seatIn(dir, made.slug, result.imported[0]!.slug)
    assert.deepEqual(seat.skills, SKILLS)
    assert.equal(seat.publicUrl, 'https://x.ai/bot/grok-bot')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a Connector run fills skills and the public link without a Sync, and an empty list never clears them', () => {
  const seat = parseSeatMarkdown('grok-bot', serializeExistingSeat({ name: 'Grok Bot', grokBotUrl: LINK, reportsTo: 'you', owns: ['Route any task'], may: [], mustAskBefore: [], doneWhen: [], grokSync: 'synced' }))
  assert.ok(seat.ok)
  const snap = parseSnapshot(JSON.stringify({ syncedAt: '2026-10-21T12:00:00.000Z', bots: [{ name: 'Grok Bot', grokBotUrl: LINK, skills: SKILLS, publicUrl: 'https://x.ai/bot/grok-bot' }], processes: [] }), '2026-10-21T12:00:00.000Z')
  assert.ok(snap.ok)
  const row = planSync(snap.snapshot, [seat.seat], []).rows.find((item) => item.kind === 'updated')
  assert.ok(row && row.kind === 'updated', 'skills and the link are news')
  assert.deepEqual(row.patch.skills, SKILLS)
  assert.equal(row.patch.publicUrl, 'https://x.ai/bot/grok-bot')
  assert.ok(performanceOnly(row), 'they apply on every Connector run, like routines')
  const written = patchSeatSource('grok-bot', seat.seat.source, row.patch)
  assert.ok(written.ok)
  const after = parseSeatMarkdown('grok-bot', written.source)
  assert.ok(after.ok)
  assert.deepEqual(after.seat.skills, SKILLS)
  assert.equal(after.seat.publicUrl, 'https://x.ai/bot/grok-bot')
  const empty = parseSnapshot(JSON.stringify({ syncedAt: '2026-10-21T12:30:00.000Z', bots: [{ name: 'Grok Bot', grokBotUrl: LINK, skills: [] }], processes: [] }), '2026-10-21T12:30:00.000Z')
  assert.ok(empty.ok)
  assert.equal(planSync(empty.snapshot, [after.seat], []).rows[0]?.kind, 'unchanged', 'an empty list or a missing link changes nothing')
})

test('Create in Grok Bot sends the Profile: the instructions, or the directory prompt until it is edited, plus skills and routines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-profile-request-'))
  try {
    const orgs = join(dir, 'orgs')
    mkdirSync(orgs)
    mkdirSync(join(dir, 'directory'))
    writeFileSync(join(dir, 'directory', 'lead-bot.md'), '---\nname: Lead Bot\n---\n\nYou sort new leads.\n')
    const made = createOrgFiles(orgs, 'Desk', 'You')
    assert.ok(made.ok)
    const root = join(orgs, made.slug)
    const card = { owns: ['Sorting new leads'], may: ['Read the lead list'], mustAskBefore: ['Contacting a lead'], doneWhen: ['Every lead is marked'] }
    assert.ok(createHiredSeat(root, made.slug, { name: 'Lead Sorter', kind: 'bot', slug: 'lead-sorter', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', ...card }).ok)
    assert.ok(updateSeatProfile(root, made.slug, 'lead-sorter', { instructions: INSTRUCTIONS, skills: SKILLS, routines: ROUTINES }).ok)
    const manual = requestGrokBot(root, made.slug, 'lead-sorter')
    assert.ok(manual.ok, manual.ok ? '' : manual.errors.join(' '))
    assert.equal(manual.request.prompt, INSTRUCTIONS)
    assert.deepEqual(manual.request.skills, SKILLS)
    assert.deepEqual(manual.request.routines, ROUTINES)
    const stored = readRequests(root).requests.find((item) => item.seat === 'lead-sorter')
    assert.deepEqual(stored?.skills, SKILLS, 'the requests file keeps them for the Connector')
    assert.deepEqual(stored?.routines, ROUTINES)

    assert.ok(createHiredSeat(root, made.slug, { name: 'Lead Bot', kind: 'bot', slug: 'lead-bot', directorySlug: 'lead-bot', reportsTo: 'you', addToGrokBotUrl: '', ...card }).ok)
    const fromDirectory = requestGrokBot(root, made.slug, 'lead-bot')
    assert.ok(fromDirectory.ok)
    assert.equal(fromDirectory.request.prompt, 'You sort new leads.', 'a hired directory bot sends its directory prompt')
    assert.ok(updateSeatProfile(root, made.slug, 'lead-bot', { instructions: 'You sort new leads. Only from the EU list.' }).ok)
    const edited = requestGrokBot(root, made.slug, 'lead-bot')
    assert.ok(edited.ok)
    assert.equal(edited.request.prompt, 'You sort new leads. Only from the EU list.', 'once edited in Profile, the edited prompt is what Grok Bot gets')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Connector adds the skills and routines, and reports skills and the public link only for bots that have one', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/o' })
  assert.match(prompt, /When "skills" is set, add each one to the bot/)
  assert.match(prompt, /When "routines" is set, create each one for the bot/)
  assert.doesNotMatch(prompt, /template/i, 'the owner makes public links in Grok Bot; the Connector never makes templates')
  assert.match(SNAPSHOT_FORMAT, /"skills": \[/)
  assert.match(SNAPSHOT_FORMAT, /"publicUrl":/)
  assert.match(SNAPSHOT_FORMAT, /Include publicUrl only for a bot that has a public link in Grok Bot/)
  assert.match(SNAPSHOT_FORMAT, /Never invent skills/)
  assert.match(GROK_BOTS_PROMPT, /"publicUrl":/, 'importing asks for the public link')
  assert.match(GROK_BOTS_PROMPT, /"skills": \[/)
})

const FULL_ROUTINES = [
  { name: 'Weekday lead sweep', schedule: '0 9 * * 1-5', description: 'Sweep new leads and post the list.', trigger: 'schedule', timeZone: 'Europe/Madrid' },
  { name: 'Support mentions', schedule: '', description: 'Answer a mention.', trigger: 'slack', event: 'Mentions in #support', enabled: false },
]

test('a routine keeps how it starts, its event, its time zone, and whether it is paused', () => {
  const seat = parseSeatMarkdown('lead-sorter', HIRED.replace(/^routines: .*$/m, `routines: ${JSON.stringify(JSON.stringify([...FULL_ROUTINES, { name: 'Graph style', schedule: '0 8 * * *', trigger: 'cron', timeZone: 'Not/AZone' }]))}`))
  assert.ok(seat.ok, seat.ok ? '' : seat.errors.join(' '))
  assert.deepEqual(seat.seat.routines, [...FULL_ROUTINES, { name: 'Graph style', schedule: '0 8 * * *', trigger: 'schedule' }], 'cron reads as schedule, and a time zone that does not exist is left out')
  const again = parseSeatMarkdown('lead-sorter', serializeSeat(seat.seat))
  assert.ok(again.ok)
  assert.deepEqual(again.seat.routines, seat.seat.routines)
})

test('imported routines bring the same details, and an old file that put the schedule in trigger still loads', () => {
  const parsed = parseBotsFile(JSON.stringify({ bots: [{ name: 'Grok Bot', routines: [...FULL_ROUTINES, { name: 'Old style', trigger: 'Mon 09:00' }] }] }))
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.rows[0]!.routines, [...FULL_ROUTINES, { name: 'Old style', schedule: 'Mon 09:00' }])
})

test('Profile saves the routine details', async () => {
  await withServer(async (base, orgs, org) => {
    const added = await fetch(`${base}/api/orgs/${org}/seats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Lead Sorter', kind: 'bot', slug: 'lead-sorter', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', owns: ['a'], may: ['b'], mustAskBefore: ['c'], doneWhen: ['d'] }) })
    assert.equal(added.status, 201)
    assert.equal((await put(base, org, 'lead-sorter', { routines: FULL_ROUTINES })).status, 200)
    assert.deepEqual(seatIn(orgs, org, 'lead-sorter').routines, FULL_ROUTINES)
  })
})

test('the Connector and the import ask for each routine\'s start, event, time zone, and pause, and create routines with them', () => {
  for (const format of [SNAPSHOT_FORMAT, GROK_BOTS_PROMPT]) {
    assert.match(format, /"trigger": "schedule, or the product an event comes from/)
    assert.match(format, /"event":/)
    assert.match(format, /"timeZone":/)
    assert.match(format, /"enabled": true/)
  }
  assert.match(connectorPrompt({ id: 'k3f9', orgsFolder: '/o' }), /create each one for the bot, with its name, its start \(a schedule with its time zone, or an event\), its description, and paused when "enabled" is false/)
})
