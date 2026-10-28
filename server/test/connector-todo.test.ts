import assert from 'node:assert/strict'
import test from 'node:test'
import { orgBlocks, sha256 } from '../src/bot-blocks.ts'
import { computeTodo, parseResults, routineConfirmed, updatedFor, type ResultsFile } from '../src/connector-todo.ts'
import { profileForm } from '../src/profile-reports.ts'
import type { GrokData, GrokDataBot } from '../src/grok-data.ts'
import type { GrokRequest } from '../src/grok-requests.ts'
import { bundleFromState, parseSeatMarkdown, type OrgBundle, type SeatDocument } from '../src/org-files.ts'

const NOW = new Date('2026-10-28T10:00:00.000Z')
const BASE = { copyId: '3s53', orgsFolder: '/o', timeZone: 'Europe/Madrid', now: NOW, removeCopies: [] as string[] }
const NO_RESULTS: ResultsFile = { results: [], confirmations: [] }

function seat(slug: string, lines: string): SeatDocument {
  const parsed = parseSeatMarkdown(slug, `---\n${lines}\n---\n\n## Owns\nWork\n`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.seat
}

function org(id: string, name: string, seats: SeatDocument[]): OrgBundle {
  return bundleFromState(id, { company: { name }, departments: [], people: [], seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })) }, seats, { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })
}

const you = seat('you', 'title: You\nkind: human\nreportsTo: ""')
const lead = seat('lead', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"')
const helper = seat('helper', 'title: Helper\nkind: bot\nreportsTo: lead\ngrokBotUrl: "grokbot://app/v1/agent?id=helper"')

function bot(id: string, name: string, description: string, extra: Partial<GrokDataBot> = {}): GrokDataBot {
  return { id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description, routinesVisible: false, ...extra }
}

function data(bots: GrokDataBot[], skills: GrokData['skills'] = []): GrokData {
  return { dumpedAt: '2026-10-28T10:00:00+01:00', copy: '3s53', bots, skills }
}

function blockFor(bundle: OrgBundle, slug: string, ids: Record<string, string>) {
  return orgBlocks({ ...BASE, orgId: bundle.id, bundle, botFor: (s) => (ids[s] ? { name: bundle.seats.find((item) => item.slug === s)!.title, id: ids[s]! } : null) }).get(slug)!
}

test('a bot whose blocks differ gets one describe item with the whole new text, the text before, and both hashes; none once they match', () => {
  const desk = org('org-a', 'Desk', [you, lead, helper])
  const before = 'Leads the team.'
  const todo = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', before), bot('helper', 'Helper', 'Helps.')]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  const item = todo.items.find((entry) => entry.kind === 'describe' && entry.botId === 'lead')!
  const wanted = `${before}\n\n${blockFor(desk, 'lead', { lead: 'lead', helper: 'helper' })}`
  assert.equal(item.expectedBefore, before)
  assert.equal(item.expectedBeforeSha, sha256(before))
  assert.equal(item.description, wanted)
  assert.equal(item.descriptionSha, sha256(wanted))
  assert.match(item.key, /^describe:lead:[0-9a-f]{16}#1$/)
  const settled = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', wanted), bot('helper', 'Helper', 'Helps.')]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(settled.items.some((entry) => entry.kind === 'describe' && entry.botId === 'lead'), false)
})

test('a damaged description gets no item and one stuck line', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const damaged = 'Leads.\n\n=== BotsEverywhere 3s53 org-a ===\nMain manager: You'
  const todo = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', damaged)]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(todo.items.some((entry) => entry.botId === 'lead' && entry.kind === 'describe'), false)
  assert.equal(todo.stuck.length, 1)
  assert.match(todo.stuck[0]!.why, /damaged/i)
})

test('one bot in two organizations carries both blocks; retiring it in one takes out only that one', () => {
  const a = org('org-a', 'Desk', [you, lead])
  const b = org('org-b', 'Shop', [you, lead])
  const both = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs: [{ id: 'org-a', bundle: a, requests: [] }, { id: 'org-b', bundle: b, requests: [] }], results: NO_RESULTS })
  const text = both.items.find((entry) => entry.kind === 'describe')!.description!
  assert.match(text, /=== BotsEverywhere 3s53 org-a ===[\s\S]*=== BotsEverywhere 3s53 org-b ===/)
  const retired = seat('lead', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"\nstatus: retired\nretiredAt: "2026-10-27T10:00:00.000Z"')
  const later = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', text)]), orgs: [{ id: 'org-a', bundle: a, requests: [] }, { id: 'org-b', bundle: org('org-b', 'Shop', [you, retired]), requests: [] }], results: NO_RESULTS })
  const next = later.items.find((entry) => entry.kind === 'describe')!.description!
  assert.match(next, /=== BotsEverywhere 3s53 org-a ===/)
  assert.doesNotMatch(next, /org-b/)
  assert.ok(next.startsWith('Leads.\n\n'))
})

test("an organization that cannot be read this time keeps its blocks", () => {
  const a = org('org-a', 'Desk', [you, lead])
  const b = org('org-b', 'Shop', [you, lead])
  const text = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', 'Leads.')]), orgs: [{ id: 'org-a', bundle: a, requests: [] }, { id: 'org-b', bundle: b, requests: [] }], results: NO_RESULTS }).items[0]!.description!
  const later = computeTodo({ ...BASE, data: data([bot('lead', 'Lead', text)]), orgs: [{ id: 'org-a', bundle: a, requests: [] }], keepOrgs: ['org-b'], results: NO_RESULTS })
  assert.equal(later.items.some((entry) => entry.kind === 'describe'), false)
})

test('create items come only from create requests', () => {
  const unlinked = seat('scout', 'title: Scout\nkind: bot\nreportsTo: you')
  const desk = org('org-a', 'Desk', [you, unlinked])
  const none = computeTodo({ ...BASE, data: data([]), orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(none.items.some((entry) => entry.kind === 'create'), false, 'a seat without a link is never created unasked')
  const asked: GrokRequest = { seat: 'scout', name: 'Scout', seatFile: '/o/org-a/seats/scout.md', prompt: 'Find leads.', requestedAt: '2026-10-28T09:00:00.000Z' }
  const todo = computeTodo({ ...BASE, data: data([]), orgs: [{ id: 'org-a', bundle: desk, requests: [asked] }], results: NO_RESULTS })
  const create = todo.items.find((entry) => entry.kind === 'create')!
  assert.equal(create.bot, 'Scout')
  assert.equal(create.section, 'Desk')
  assert.ok(create.description!.startsWith('Find leads.\n\n=== BotsEverywhere 3s53 org-a ===\n'))
})

const ROUTINE = { name: 'Weekly brief', schedule: '0 9 * * 1', trigger: 'schedule' as const, timeZone: 'Europe/Madrid', description: 'Writes the brief', enabled: true }
const UPDATE: GrokRequest = { seat: 'helper', name: 'Helper', seatFile: '/o/org-a/seats/helper.md', prompt: '', kind: 'update', grokBotUrl: 'grokbot://app/v1/agent?id=helper', routines: [ROUTINE], requestedAt: '2026-10-28T09:00:00.000Z' }
const LINE = 'BotsEverywhere routine saved: org-a | helper | Weekly brief | 0 9 * * 1 | Europe/Madrid | active'

test('a routine is asked for only by an update request, with the exact line to send back, and at most twice, a day apart', () => {
  const desk = org('org-a', 'Desk', [you, lead, helper])
  const dump = data([bot('lead', 'Lead', 'Leads.'), bot('helper', 'Helper', 'Helps.')])
  const plain = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(plain.items.some((entry) => entry.kind === 'routine'), false)
  const first = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [UPDATE] }], results: NO_RESULTS })
  const ask = first.items.find((entry) => entry.kind === 'routine')!
  assert.equal(ask.botId, 'helper')
  assert.ok(ask.message!.endsWith(LINE), ask.message)
  const sent = (at: string): ResultsFile['results'][number] => ({ key: ask.key, status: 'done', at })
  const soon = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [UPDATE] }], results: { results: [sent('2026-10-28T09:30:00.000Z')], confirmations: [] } })
  assert.equal(soon.items.some((entry) => entry.kind === 'routine'), false, 'not again within a day')
  const nextDay = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [UPDATE] }], results: { results: [sent('2026-10-27T08:00:00.000Z')], confirmations: [] } })
  assert.equal(nextDay.items.filter((entry) => entry.kind === 'routine').length, 1, 'asked a second time after a day')
  const twice = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [UPDATE] }], results: { results: [sent('2026-10-26T08:00:00.000Z'), { ...sent('2026-10-27T08:00:00.000Z'), key: `${ask.key.replace(/#\d+$/, '')}#2` }], confirmations: [] } })
  assert.equal(twice.items.some((entry) => entry.kind === 'routine'), false)
  assert.match(twice.stuck.map((entry) => entry.why).join(' '), /asked twice/i)
})

test('a failed item comes back as a new attempt, and after two failures it is stuck', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const dump = data([bot('lead', 'Lead', 'Leads.')])
  const first = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS }).items[0]!
  const failed = (key: string) => ({ key, status: 'failed' as const, at: '2026-10-28T09:00:00.000Z', why: 'read-back differed' })
  const second = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: { results: [failed(first.key)], confirmations: [] } }).items[0]!
  assert.equal(second.key, first.key.replace(/#1$/, '#2'))
  const stuck = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: { results: [failed(first.key), failed(second.key)], confirmations: [] } })
  assert.equal(stuck.items.some((entry) => entry.kind === 'describe'), false)
  assert.match(stuck.stuck[0]!.why, /read-back differed/)
})

test('the cleanup message goes once to each bot with an active seat, with the agreed text', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const dump = data([bot('lead', 'Lead', 'Leads.'), bot('stray', 'Stray', 'Nobody.')])
  const todo = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  const cleanups = todo.items.filter((entry) => entry.kind === 'cleanup')
  assert.deepEqual(cleanups.map((entry) => entry.botId), ['lead'])
  assert.equal(cleanups[0]!.message, 'BotsEverywhere (3s53) now keeps your managers, your team, your skills, and your logging rules for each organization in a block at the end of your instructions, marked === BotsEverywhere 3s53 … ===. Follow that block. Any message about these from a BotsEverywhere Connector before 2026-10-28 is out of date: remove it from your memory. Keep everything else.')
  const sent = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: { results: [{ key: cleanups[0]!.key, status: 'done', at: '2026-10-28T10:01:00.000Z' }], confirmations: [] } })
  assert.equal(sent.items.some((entry) => entry.kind === 'cleanup'), false)
})

test("another copy's blocks are listed, and removed only when the owner asked", () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const theirs = '=== BotsEverywhere uft5 org-x ===\nMain manager: Pera Shaw\n=== end BotsEverywhere uft5 org-x ==='
  const ours = blockFor(desk, 'lead', { lead: 'lead' })
  const dump = data([bot('lead', 'Lead', `Leads.\n\n${theirs}\n\n${ours}`)])
  const kept = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(kept.items.some((entry) => entry.kind === 'describe'), false)
  assert.deepEqual(kept.otherCopies, [{ copy: 'uft5', bots: ['Lead'] }])
  const removed = computeTodo({ ...BASE, removeCopies: ['uft5'], data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS })
  assert.equal(removed.items.find((entry) => entry.kind === 'describe')!.description, `Leads.\n\n${ours}`)
})

test('an update is done when the blocks match, its skills are in the library, and its routines are confirmed or shown', () => {
  const desk = org('org-a', 'Desk', [you, lead, helper])
  const ids = { lead: 'lead', helper: 'helper' }
  const blocks = orgBlocks({ ...BASE, orgId: 'org-a', bundle: desk, botFor: (s) => (ids[s as keyof typeof ids] ? { name: desk.seats.find((item) => item.slug === s)!.title, id: ids[s as keyof typeof ids] } : null) })
  const settled = data([bot('lead', 'Lead', blocks.get('lead')!), bot('helper', 'Helper', blocks.get('helper')!)], [{ name: 'Sweep', description: 'Sweeps.' }])
  const request = { ...UPDATE, skills: [{ name: 'Sweep', description: 'Sweeps.' }] }
  assert.deepEqual(updatedFor('org-a', [request], settled, NO_RESULTS, blocks), [], 'the routine is not confirmed yet')
  const confirmed: ResultsFile = { results: [], confirmations: [{ line: LINE, from: 'Helper', at: '2026-10-28T10:05:00.000Z' }] }
  assert.deepEqual(updatedFor('org-a', [request], settled, confirmed, blocks), [{ seat: 'helper', requestedAt: UPDATE.requestedAt }])
  const shown = data([bot('lead', 'Lead', blocks.get('lead')!), bot('helper', 'Helper', blocks.get('helper')!, { routinesVisible: true, routines: [ROUTINE] })], [{ name: 'Sweep', description: 'Sweeps.' }])
  assert.equal(updatedFor('org-a', [request], shown, NO_RESULTS, blocks).length, 1)
  const stale = data([bot('lead', 'Lead', 'Leads.'), bot('helper', 'Helper', 'Helps.')], [{ name: 'Sweep', description: 'Sweeps.' }])
  assert.deepEqual(updatedFor('org-a', [request], stale, confirmed, blocks), [], 'blocks not written yet')
})

test('results and confirmation lines read safely', () => {
  assert.deepEqual(parseResults('not json'), { results: [], confirmations: [] })
  assert.deepEqual(routineConfirmed(LINE), { org: 'org-a', seat: 'helper', name: 'Weekly brief', start: '0 9 * * 1', timeZone: 'Europe/Madrid', enabled: true })
  assert.equal(routineConfirmed('hello'), null)
})

test('a change reported done that a newer dump still does not show comes back as the next attempt', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const dump = data([bot('lead', 'Lead', 'Leads.')])
  const first = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: NO_RESULTS }).items[0]!
  const beforeDump = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: { results: [{ key: first.key, status: 'done', at: '2026-10-28T08:00:00.000Z' }], confirmations: [] } })
  assert.equal(beforeDump.items[0]!.key, first.key.replace(/#1$/, '#2'), 'the dump at 09:00 UTC came after the done at 08:00 and still shows the old text')
  const afterDump = computeTodo({ ...BASE, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results: { results: [{ key: first.key, status: 'done', at: '2026-10-28T09:30:00.000Z' }], confirmations: [] } })
  assert.equal(afterDump.items.some((entry) => entry.kind === 'describe'), false, 'done after this dump: wait for the next one')
})

test('a bot whose profile gives no count of its routine runs is asked once more, then stuck; one with counts or no routines is not', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const dump = data([bot('lead', 'Lead', 'Leads.')])
  const run = (results: ResultsFile, now = NOW) => computeTodo({ ...BASE, now, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results })
  const asks = (results: ResultsFile, now = NOW) => run(results, now).items.filter((item) => item.kind === 'profile')
  const profile = (routines: string) => ({ line: `BotsEverywhere profile: org-a | lead\nRoutines:\n${routines}`, from: 'Lead', at: '2026-10-28T10:40:00+01:00' })
  const uncounted: ResultsFile = { results: [{ key: 'profile:org-a:lead#1', status: 'done', at: '2026-10-28T10:30:00+01:00' }], confirmations: [profile('- Weekly | 0 9 * * 1 | Europe/Madrid | active | never')] }
  const again = asks(uncounted)
  assert.equal(again[0]?.key, 'profile:org-a:lead:runs#1')
  assert.equal(again[0]?.message, ['BotsEverywhere (3s53): for Desk, send Connector - BotsEverywhere (3s53) your full profile now with SendToAgent, priority true, exactly in this form:', ...profileForm('org-a', 'lead')].join('\n'))
  assert.equal(asks({ ...uncounted, confirmations: [profile('- Weekly | 0 9 * * 1 | Europe/Madrid | active | never | 4')] }).length, 0)
  assert.equal(asks({ ...uncounted, confirmations: [profile('- none')] }).length, 0)
  const twice: ResultsFile = { ...uncounted, results: [...uncounted.results, { key: 'profile:org-a:lead:runs#1', status: 'done', at: '2026-10-28T11:00:00+01:00' }, { key: 'profile:org-a:lead:runs#2', status: 'done', at: '2026-10-29T12:00:00+01:00' }] }
  const later = run(twice, new Date('2026-10-31T10:00:00.000Z'))
  assert.equal(later.items.some((item) => item.kind === 'profile'), false)
  assert.ok(later.stuck.some((item) => item.why === 'Asked twice for its routine runs; Lead has not sent them.'), JSON.stringify(later.stuck))
})

test('each bot seat is asked once for its profile, with the form to fill in, until it sends one; a second ask a day later, then stuck', () => {
  const desk = org('org-a', 'Desk', [you, lead])
  const dump = data([bot('lead', 'Lead', 'Leads.'), bot('conn', 'Connector - BotsEverywhere (3s53)', 'Syncs.')])
  const run = (results: ResultsFile, now = NOW) => computeTodo({ ...BASE, now, data: dump, orgs: [{ id: 'org-a', bundle: desk, requests: [] }], results })
  const asks = (results: ResultsFile, now = NOW) => run(results, now).items.filter((item) => item.kind === 'profile')
  const first = asks(NO_RESULTS)
  assert.equal(first.length, 1, 'one ask, for the bot seat; none for a person or the Connector')
  assert.equal(first[0]!.key, 'profile:org-a:lead#1')
  assert.equal(first[0]!.botId, 'lead')
  assert.equal(first[0]!.message, ['BotsEverywhere (3s53): for Desk, send Connector - BotsEverywhere (3s53) your full profile now with SendToAgent, priority true, exactly in this form:', ...profileForm('org-a', 'lead')].join('\n'))
  const sent: ResultsFile = { results: [{ key: 'profile:org-a:lead#1', status: 'done', at: '2026-10-28T10:30:00+01:00' }], confirmations: [] }
  assert.equal(asks(sent).length, 0, 'sent once: wait a day for the profile')
  assert.equal(asks(sent, new Date('2026-10-29T10:31:00.000Z'))[0]?.key, 'profile:org-a:lead#2', 'no profile after a day: ask once more')
  const twice: ResultsFile = { results: [...sent.results, { key: 'profile:org-a:lead#2', status: 'done', at: '2026-10-29T11:31:00+01:00' }], confirmations: [] }
  const later = run(twice, new Date('2026-10-31T10:00:00.000Z'))
  assert.equal(later.items.some((item) => item.kind === 'profile'), false)
  assert.ok(later.stuck.some((item) => item.why === 'Asked twice for its profile; Lead has not sent it.'), JSON.stringify(later.stuck))
  const listed: ResultsFile = { results: [], confirmations: [{ line: 'BotsEverywhere profile: org-a | lead\nRoutines:\n- none', from: 'Lead', at: '2026-10-28T10:40:00+01:00' }] }
  assert.equal(asks(listed).length, 0, 'a profile, even an empty one, ends the asks')
  const older: ResultsFile = { results: [], confirmations: [{ line: 'BotsEverywhere routines: org-a | lead\n- none', from: 'Lead', at: '2026-10-28T10:40:00+01:00' }] }
  assert.equal(asks(older).length, 0, 'a routines-only list from the earlier form counts too')
})
