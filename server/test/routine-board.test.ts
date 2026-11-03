import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { GrokData, GrokDataBot } from '../src/grok-data.ts'
import { bundleFromState, parseSeatMarkdown, type SeatDocument } from '../src/org-files.ts'
import { routineBoard } from '../src/routine-board.ts'

function seat(slug: string, lines: string): SeatDocument {
  const parsed = parseSeatMarkdown(slug, `---\n${lines}\n---\n\n## Owns\nWork\n`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.seat
}

const seats = [
  seat('you', 'title: You\nkind: human\nreportsTo: ""'),
  seat('lead', 'title: Lead\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=lead"'),
  seat('x-com', 'title: x.com\nkind: bot\nreportsTo: lead\ngrokBotUrl: "grokbot://app/v1/agent?id=x"'),
  seat('helper', 'title: Helper\nkind: bot\nreportsTo: lead\ngrokBotUrl: "grokbot://app/v1/agent?id=helper"'),
  seat('aura', 'title: Aura\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=aura"'),
  seat('connector', 'title: Connector - BotsEverywhere (3s53)\nkind: bot\nreportsTo: you'),
  seat('old', 'title: Old\nkind: bot\nreportsTo: you\nstatus: retired\nretiredAt: "2026-10-20T10:00:00.000Z"'),
]
const bundle = bundleFromState('org-a', { company: { name: 'Desk' }, departments: [], people: [], seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })) }, seats, { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })

const bot = (id: string, name: string, extra: Partial<GrokDataBot> = {}): GrokDataBot => ({ id, name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, description: '', routinesVisible: false, ...extra })
const data: GrokData = {
  dumpedAt: '2026-10-28T13:45:00+01:00',
  copy: '3s53',
  skills: [],
  bots: [
    bot('lead', 'Lead', { routinesVisible: true, routines: [{ name: 'Stale', schedule: '0 9 * * *', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true }] }),
    bot('x', 'x.com'),
    bot('helper', 'Helper'),
    bot('aura', 'Aura', { routinesVisible: true, routines: [{ name: 'Aura health', schedule: '0 9 * * 1-5', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-09-18T09:12:52+02:00' }] }),
  ],
}

test("each bot's routines come from its own report first, then Grok Bot's files, and say which", () => {
  const board = routineBoard({
    orgId: 'org-a',
    bundle,
    data,
    confirmations: [
      { line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- Inner Loop milestone check | 0 9,21 * * * | Europe/Madrid | active | 2026-10-28T09:00:12+01:00 | 58\nSkills:\n- graph-skill | Export the team\nApps used:\n- Buffer | Posts after approval\nSends:\n- Miguel | Post drafts for approval | After each run\nReceives:\n- Inner Loop - botseverywhere | What shipped | Twice a day', from: 'x.com', at: '2026-10-28T14:10:00+01:00' },
      { line: 'BotsEverywhere routines: org-a | lead\n- Weekly review | 0 9 * * 1 | Europe/Madrid | paused | never', from: 'Lead', at: '2026-10-28T14:12:00+01:00' },
      { line: 'BotsEverywhere routines: org-b | helper\n- Elsewhere | 0 9 * * * | Europe/Madrid | active | never', from: 'Helper', at: '2026-10-28T14:13:00+01:00' },
    ],
    connector: { lastRun: '2026-10-28T13:45:12.000Z', syncMinutes: 20 },
    timeZone: 'Europe/Madrid',
    now: new Date('2026-10-28T13:50:00.000Z'),
  })
  assert.deepEqual(board.bots.map((item) => [item.slug, item.source]), [['aura', 'files'], ['connector', 'app'], ['helper', 'none'], ['lead', 'bot'], ['x-com', 'bot']], 'bot seats by name; people and retired seats are left out')
  const [aura, connector, helper, lead, x] = board.bots
  assert.equal(lead!.reportedAt, '2026-10-28T14:12:00+01:00')
  assert.deepEqual(lead!.routines, [{ name: 'Weekly review', schedule: '0 9 * * 1', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: false }], "the bot's own list replaces the stale files, and a paused routine has no next run")
  assert.equal(x!.routines[0]!.nextRun, '2026-10-28T20:00:00.000Z', 'next run at 21:00 Madrid')
  assert.deepEqual(x!.skills, [{ name: 'graph-skill', description: 'Export the team' }])
  assert.deepEqual(x!.apps, [{ name: 'Buffer', use: 'Posts after approval' }])
  assert.deepEqual(x!.sends, [{ who: 'Miguel', what: 'Post drafts for approval', when: 'After each run' }])
  assert.deepEqual(x!.receives, [{ who: 'Inner Loop - botseverywhere', what: 'What shipped', when: 'Twice a day' }])
  assert.equal(lead!.skills, undefined, 'a routines-only list from the earlier form says nothing about skills')
  assert.equal(x!.routineRuns30d, 58, 'the times its routines ran in the last 30 days, as the bot counted them')
  assert.equal(lead!.routineRuns30d, undefined, 'the earlier form gave no count')
  assert.deepEqual(helper!.routines, [], "another organization's list is not this one's")
  assert.equal(aura!.reportedAt, '')
  assert.equal(aura!.routines[0]!.lastRun, '2026-09-18T09:12:52+02:00')
  assert.equal(aura!.routines[0]!.nextRun, '2026-10-29T08:00:00.000Z')
  assert.deepEqual(connector!.routines, [{ name: 'BotsEverywhere sync', schedule: '*/20 * * * *', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-10-28T13:45:12.000Z', nextRun: '2026-10-28T14:05:12.000Z' }], "the Connector's own run, from the app")
})

test("a bot's skills in Grok Bot are the ones the Connector saved and wrote into its instructions for this organization, whatever the bot reports", () => {
  const block = (org: string, skills: string) => `You are a bot.\n\n=== BotsEverywhere 3s53 ${org} ===\nOrganization: Desk\nSkills to use: ${skills}\n=== end BotsEverywhere 3s53 ${org} ===`
  const withBlocks: GrokData = {
    ...data,
    skills: [{ name: 'x-build-log', description: 'Posts.' }, { name: 'launch-thread', description: 'Thread.' }],
    bots: [bot('lead', 'Lead', { description: block('org-b', 'x-build-log') }), bot('x', 'x.com', { description: block('org-a', 'x-build-log, launch-thread, ghost-skill') }), bot('helper', 'Helper'), bot('aura', 'Aura')],
  }
  const board = routineBoard({ orgId: 'org-a', bundle, data: withBlocks, confirmations: [], connector: null, timeZone: 'Europe/Madrid', now: new Date('2026-10-28T13:50:00.000Z') })
  const by = new Map(board.bots.map((item) => [item.slug, item]))
  assert.deepEqual(by.get('x-com')!.grokSkills, [{ name: 'x-build-log', description: 'Posts.' }, { name: 'launch-thread', description: 'Thread.' }], 'named in the block and saved in the library, with the library description; a name not in the library is not in Grok Bot')
  assert.equal(by.get('helper')!.grokSkills, undefined, 'no block yet: nothing is known')
  assert.equal(by.get('lead')!.grokSkills, undefined, "another organization's block says nothing about this one")
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /reportedSkills=\{routineBoard\?\.bots\.find\(\(item\) => item\.slug === chartSeat\.id\)\?\.grokSkills\}/, 'Profile locks a skill from the Connector\'s reading, not from what the bot says it uses')
})

test('with no Connector data yet, every bot says nothing is known and the Connector has not run', () => {
  const board = routineBoard({ orgId: 'org-a', bundle, data: null, confirmations: [], connector: null, timeZone: 'Europe/Madrid', now: new Date('2026-10-28T13:50:00.000Z') })
  assert.deepEqual(board.bots.map((item) => item.source), ['none', 'app', 'none', 'none', 'none'])
  assert.deepEqual(board.bots[1]!.routines, [], 'the Connector before its first run')
})

test('GET /api/orgs/<slug>/routines serves each bot\'s routines from its report, and 404 for an org that is not there', async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createOrgFiles, startTemplateServer } = await import('../src/template-server.ts')
  const dir = mkdtempSync(join(tmpdir(), 'be-routines-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'Ada')
  assert.ok(made.ok)
  const slug = made.ok ? made.slug : ''
  writeFileSync(join(orgs, slug, 'seats', 'x-com.md'), '---\ntitle: x.com\nkind: bot\nreportsTo: you\ngrokBotUrl: "grokbot://app/v1/agent?id=x"\n---\n\n## Owns\nPosts\n')
  writeFileSync(join(orgs, 'connector-results.json'), JSON.stringify({ results: [], confirmations: [{ line: `BotsEverywhere routines: ${slug} | x-com\n- Check | 0 9,21 * * * | Europe/Madrid | paused | never`, from: 'x.com', at: '2026-10-28T14:10:00+01:00' }] }))
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${slug}/routines`)
    assert.equal(response.status, 200)
    const body = await response.json() as { bots: { slug: string; source: string; routines: { name: string; enabled: boolean }[] }[] }
    assert.deepEqual(body.bots.map((item) => [item.slug, item.source, item.routines.map((routine) => `${routine.name}:${routine.enabled}`)]), [['x-com', 'bot', ['Check:false']]])
    assert.equal((await fetch(`http://127.0.0.1:${started.port}/api/orgs/no-such-org/routines`)).status, 404)
    // The profile the bot wrote to its file, later than the one it sent, wins.
    mkdirSync(join(orgs, slug, 'profiles'))
    writeFileSync(join(orgs, slug, 'profiles', 'x-com.md'), `BotsEverywhere profile: ${slug} | x-com\nRoutines:\n- Check | 0 9,21 * * * | Europe/Madrid | active | never | 12`)
    const fromFile = await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/${slug}/routines`)).json() as { bots: { routineRuns30d?: number; routines: { enabled: boolean }[] }[] }
    assert.deepEqual([fromFile.bots[0]!.routines[0]!.enabled, fromFile.bots[0]!.routineRuns30d], [true, 12])
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
