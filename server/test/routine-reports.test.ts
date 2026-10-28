import assert from 'node:assert/strict'
import test from 'node:test'
import { latestRoutineReports, parseRoutineReport, routineListForm } from '../src/routine-reports.ts'

test('the form a bot fills in names its organization and seat, one line per routine, and none', () => {
  assert.deepEqual(routineListForm('org-a', 'x-com'), [
    'BotsEverywhere routines: org-a | x-com',
    '- <routine name> | <cron line, or the event that starts it> | <time zone> | active or paused | <last run in ISO 8601, or never>',
    'With no routines, send the first line and then: - none',
  ])
})

test("a bot's routine list reads its schedule, time zone, active or paused, and last run, inside whatever else the message says", () => {
  const text = [
    '[agent] A non-urgent message from another of your user\'s agents, x.com - botseverywhere:',
    'Here is my list.',
    'BotsEverywhere routines: org-a | x-com',
    '- Inner Loop milestone check | 0 9,21 * * * | Europe/Madrid | active | 2026-10-28T09:00:12+01:00',
    '- Tuesday wall refresh | 0  9 * * 2 | Europe/Madrid | Paused | never',
    '- Mentions | Slack: mentions in #launch | - | active | never',
    '- broken line without the parts',
    '- Odd state | 0 9 * * 1 | Europe/Madrid | sleeping | never',
    'Thanks!',
  ].join('\r\n')
  assert.deepEqual(parseRoutineReport(text, '2026-10-28T15:10:00+01:00', 'x.com - botseverywhere'), {
    org: 'org-a',
    seat: 'x-com',
    at: '2026-10-28T15:10:00+01:00',
    from: 'x.com - botseverywhere',
    routines: [
      { name: 'Inner Loop milestone check', schedule: '0 9,21 * * *', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-10-28T09:00:12+01:00' },
      { name: 'Tuesday wall refresh', schedule: '0 9 * * 2', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: false },
      { name: 'Mentions', schedule: 'Slack: mentions in #launch', enabled: true },
    ],
  })
  assert.deepEqual(parseRoutineReport('BotsEverywhere routines: org-a | lead\n- none')?.routines, [], 'none is a list with nothing in it')
  assert.equal(parseRoutineReport('BotsEverywhere routine saved: org-a | lead | Weekly | 0 9 * * 1 | - | active'), null, 'a single confirmation is not a list')
  assert.equal(parseRoutineReport('BotsEverywhere routines: org-a'), null, 'a header without a seat is not a list')
})

test('the newest list for each seat wins', () => {
  const reports = latestRoutineReports([
    { line: 'BotsEverywhere routines: org-a | x-com\n- Old | 0 9 * * * | Europe/Madrid | active | never', from: 'x.com', at: '2026-10-28T10:00:00+01:00' },
    { line: 'BotsEverywhere routines: org-a | x-com\n- New | 0 9 * * * | Europe/Madrid | paused | never', from: 'x.com', at: '2026-10-28T11:00:00+01:00' },
    { line: 'BotsEverywhere routines: org-a | lead\n- none', from: 'Lead', at: '2026-10-28T09:00:00+01:00' },
    { line: 'BotsEverywhere routine saved: org-a | lead | Weekly | 0 9 * * 1 | - | active', from: 'Lead', at: '2026-10-28T12:00:00+01:00' },
  ])
  assert.deepEqual([...reports.keys()].sort(), ['org-a|lead', 'org-a|x-com'])
  assert.equal(reports.get('org-a|x-com')!.routines[0]!.name, 'New')
  assert.equal(reports.get('org-a|x-com')!.routines[0]!.enabled, false)
  assert.deepEqual(reports.get('org-a|lead')!.routines, [])
})
