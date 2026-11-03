import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { latestProfileReports, parseProfileReport, profileForm } from '../src/profile-reports.ts'

test('the profile a bot fills in names its organization and seat, then its routines, private skills, apps used, and handoffs', () => {
  assert.deepEqual(profileForm('org-a', 'x-com'), [
    'BotsEverywhere profile: org-a | x-com',
    'Routines:',
    '- <routine name> | <cron line, or the event that starts it> | <time zone> | active or paused | <last run in ISO 8601, or never> | <times it ran in the last 30 days, from its Run history>',
    'Skills:',
    '- <private skill you use in your work; leave out skills you only have turned on> | <what it does, in one line>',
    'Apps used:',
    '- <app connected to the account that you use> | <what you use it for>',
    'Sends:',
    '- <bot or person you hand work to> | <what you send> | <when>',
    'Receives:',
    '- <bot or person who hands you work> | <what you get> | <when>',
    'Under a heading with nothing in it, write: - none',
  ])
})

test("a bot's profile reads its routines, skills, and handoffs, inside whatever else the message says", () => {
  const text = [
    "[agent] A non-urgent message from another of your user's agents, x.com - botseverywhere:",
    'Here it is.',
    'BotsEverywhere profile: org-a | x-com',
    'Routines:',
    '- Inner Loop milestone check | 0 9,21 * * * | Europe/Madrid | active | 2026-10-28T09:09:57+01:00',
    '- Tuesday wall | 0  9 * * 2 | Europe/Madrid | Paused | never',
    '- Odd state | 0 9 * * 1 | Europe/Madrid | sleeping | never',
    'Skills:',
    '- graph-skill | Export the Grok Bot team as a Grok Bot Graph JSON file',
    '- the-court-one-pager',
    'Apps used:',
    '- X | Reading his own account data; it can\'t publish posts',
    '- Buffer | Standalone X posts only after Miguel approves the exact text',
    '- Gmail',
    'Sends:',
    '- Miguel | Milestone and side post drafts for approval | After each routine run with news',
    '- Inner Loop - botseverywhere | Ask what changed in the latest stable build',
    '- broken',
    'Receives:',
    '- none',
    'Thanks!',
  ].join('\r\n')
  assert.deepEqual(parseProfileReport(text, '2026-10-28T16:30:00+01:00', 'x.com - botseverywhere'), {
    org: 'org-a',
    seat: 'x-com',
    at: '2026-10-28T16:30:00+01:00',
    from: 'x.com - botseverywhere',
    routines: [
      { name: 'Inner Loop milestone check', schedule: '0 9,21 * * *', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-10-28T09:09:57+01:00' },
      { name: 'Tuesday wall', schedule: '0 9 * * 2', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: false },
    ],
    skills: [{ name: 'graph-skill', description: 'Export the Grok Bot team as a Grok Bot Graph JSON file' }, { name: 'the-court-one-pager' }],
    apps: [
      { name: 'X', use: "Reading his own account data; it can't publish posts" },
      { name: 'Buffer', use: 'Standalone X posts only after Miguel approves the exact text' },
      { name: 'Gmail' },
    ],
    sends: [
      { who: 'Miguel', what: 'Milestone and side post drafts for approval', when: 'After each routine run with news' },
      { who: 'Inner Loop - botseverywhere', what: 'Ask what changed in the latest stable build' },
    ],
    receives: [],
  })
})

test('a heading the bot left out is unknown, not empty; a routines-only list from the earlier form still reads', () => {
  const partial = parseProfileReport('BotsEverywhere profile: org-a | lead\nRoutines:\n- none')!
  assert.deepEqual(partial.routines, [])
  assert.equal(partial.skills, undefined)
  assert.equal(partial.sends, undefined)
  const older = parseProfileReport('BotsEverywhere routines: org-a | lead\n- Weekly | 0 9 * * 1 | Europe/Madrid | active | never')!
  assert.deepEqual(older.routines.map((item) => item.name), ['Weekly'])
  assert.equal(older.skills, undefined)
  assert.equal(parseProfileReport('BotsEverywhere routine saved: org-a | lead | Weekly | 0 9 * * 1 | - | active'), null)
  assert.equal(parseProfileReport('BotsEverywhere profile: org-a'), null)
})

test("a profile adds up the times its routines ran in the last 30 days; the total is unknown unless every routine gives a count", () => {
  const head = 'BotsEverywhere profile: org-a | x-com\nRoutines:\n'
  const counted = parseProfileReport(`${head}- Milestone check | 0 9,21 * * * | Europe/Madrid | active | 2026-10-28T09:09:57+01:00 | 60\n- Health | 49 8 * * 1 | Europe/Madrid | active | never | 4`)!
  assert.equal(counted.routineRuns30d, 64)
  assert.deepEqual(counted.routines.map((item) => item.name), ['Milestone check', 'Health'], 'the count is not part of the routine')
  assert.equal(parseProfileReport(`${head}- Milestone check | 0 9,21 * * * | Europe/Madrid | active | never | 60\n- Health | 49 8 * * 1 | Europe/Madrid | active | never`)!.routineRuns30d, undefined, 'a routine from the earlier form has no count')
  assert.equal(parseProfileReport(`${head}- Health | 49 8 * * 1 | Europe/Madrid | active | never | about 4`)!.routineRuns30d, undefined, 'only a whole number counts')
  assert.equal(parseProfileReport(`${head}- none`)!.routineRuns30d, 0, 'no routines ran no times')
  assert.equal(parseProfileReport('BotsEverywhere profile: org-a | x-com\nSkills:\n- none')!.routineRuns30d, undefined, 'no Routines heading: unknown')
})

test('the newest profile for each seat wins', () => {
  const reports = latestProfileReports([
    { line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- Old | 0 9 * * * | Europe/Madrid | active | never', from: 'x.com', at: '2026-10-28T10:00:00+01:00' },
    { line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- New | 0 9 * * * | Europe/Madrid | paused | never', from: 'x.com', at: '2026-10-28T11:00:00+01:00' },
    { line: 'BotsEverywhere profile: org-a | lead\nRoutines:\n- none', from: 'Lead', at: '2026-10-28T09:00:00+01:00' },
  ])
  assert.deepEqual([...reports.keys()].sort(), ['org-a|lead', 'org-a|x-com'])
  assert.equal(reports.get('org-a|x-com')!.routines[0]!.name, 'New')
})

test('the profile form asks for skills the bot uses, not every skill turned on', () => {
  const form = profileForm('org-x', 'seat').join('\n')
  assert.match(form, /- <private skill you use in your work; leave out skills you only have turned on> \| <what it does, in one line>/)
  assert.equal(form.includes('turned on for you'), false)
  const profile = readFileSync(new URL('../../src/components/BotProfile.tsx', import.meta.url), 'utf8')
  assert.match(profile, /In Grok Bot<\/span>/, 'a skill the bot reported is shown as in Grok Bot, locked')
})
