import assert from 'node:assert/strict'
import test from 'node:test'
import { latestProfileReports, parseProfileReport, profileForm } from '../src/profile-reports.ts'

test('the profile a bot fills in names its organization and seat, then its routines, private skills, and handoffs', () => {
  assert.deepEqual(profileForm('org-a', 'x-com'), [
    'BotsEverywhere profile: org-a | x-com',
    'Routines:',
    '- <routine name> | <cron line, or the event that starts it> | <time zone> | active or paused | <last run in ISO 8601, or never>',
    'Skills:',
    '- <private skill turned on for you, not a built-in one> | <what it does, in one line>',
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

test('the newest profile for each seat wins', () => {
  const reports = latestProfileReports([
    { line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- Old | 0 9 * * * | Europe/Madrid | active | never', from: 'x.com', at: '2026-10-28T10:00:00+01:00' },
    { line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- New | 0 9 * * * | Europe/Madrid | paused | never', from: 'x.com', at: '2026-10-28T11:00:00+01:00' },
    { line: 'BotsEverywhere profile: org-a | lead\nRoutines:\n- none', from: 'Lead', at: '2026-10-28T09:00:00+01:00' },
  ])
  assert.deepEqual([...reports.keys()].sort(), ['org-a|lead', 'org-a|x-com'])
  assert.equal(reports.get('org-a|x-com')!.routines[0]!.name, 'New')
})
