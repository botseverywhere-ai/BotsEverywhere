import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { formatShortDate } from '../src/bot-metrics.ts'
import type { ProcessFile } from '../src/processes.ts'
import type { BoardBot, RoutineBoard } from '../src/routine-board.ts'
import { HANDOFFS_HINT, OFF_CHART_HINT, ROUTINES_HINT, flowSegment, laneNoRoutine, lanePaused, laneProblems, laneRoutine, laneWhen, routinesOffChart, scheduleWords, whenLine } from '../../src/components/routine-board-copy.ts'
import { connectedApps } from '../../src/org/bot-apps.ts'
import { skillCount, skillsInGrok } from '../../src/org/bot-skills.ts'

const bot = (slug: string, source: BoardBot['source'], routines: BoardBot['routines'] = []): BoardBot => ({ slug, title: slug.toUpperCase(), source, reportedAt: '', routines })
const flow = (name: string, seat: string, description = ''): Pick<ProcessFile, 'name' | 'steps' | 'trigger'> => ({ name, steps: [{ seat, action: 'Do it' }], trigger: { type: 'schedule', schedule: '49 8 * * 1', source: '', description } })
const board: RoutineBoard = { bots: [
  bot('x-com', 'bot', [{ name: 'Inner Loop milestone check', schedule: '0 9,21 * * *', trigger: 'schedule', timeZone: 'Europe/Madrid', enabled: true, lastRun: '2026-10-28T09:09:57+01:00', nextRun: '2026-10-28T20:00:00.000Z' }]),
  bot('aura', 'files', [{ name: 'Aura production health', schedule: '0 9 * * 1-5', trigger: 'schedule', enabled: true }, { name: 'Old routine', schedule: '0 9 * * 1', trigger: 'schedule', enabled: false }]),
  bot('eggbot', 'none'),
  bot('connector', 'app', [{ name: 'BotsEverywhere sync', schedule: '*/20 * * * *', trigger: 'schedule', enabled: true }]),
] }

test("a flow shows the routine of the same name owned by the bot on its first step", () => {
  assert.equal(laneRoutine(flow('inner loop milestone check', 'x-com'), board)?.routine.lastRun, '2026-10-28T09:09:57+01:00', 'names match without regard to case')
  assert.equal(laneRoutine(flow('Inner Loop milestone check', 'aura'), board), null, "another bot's routine is not this flow's")
  assert.equal(laneRoutine(flow('Anything', 'eggbot'), board), null)
  assert.equal(laneRoutine(flow('Anything', 'x-com'), null), null)
  assert.equal(laneRoutine(flow('BotsEverywhere Connector run', 'connector'), board)?.routine.name, 'BotsEverywhere sync', "the Connector has one routine, whatever Grok Bot's file calls its flow")
  assert.equal(lanePaused(flow('BotsEverywhere Connector run', 'connector'), laneRoutine(flow('BotsEverywhere Connector run', 'connector'), board)), false, 'so it shows Active')
})

test("a routine flow's badge comes only from the bot's own report or the (paused) mark, never a guess; a handoff has none", () => {
  assert.equal(lanePaused(flow('Inner Loop milestone check', 'x-com', 'Daily (paused)'), laneRoutine(flow('Inner Loop milestone check', 'x-com'), board)), false, "the bot's report wins over an old mark")
  assert.equal(lanePaused(flow('transcript-healthcheck', 'eggbot', 'Weekdays at 08:44, Europe/Madrid (paused)'), null), true)
  assert.equal(lanePaused(flow('Aura production health', 'aura', 'Weekdays (paused)'), laneRoutine(flow('Aura production health', 'aura'), board)), true, "the mark wins over Grok Bot's stale files")
  assert.equal(lanePaused(flow('Aura production health', 'aura'), laneRoutine(flow('Aura production health', 'aura'), board)), null, "Grok Bot's files alone give no badge")
  assert.equal(lanePaused(flow('Weekly brief', 'eggbot'), null), null, 'no routine reported: no badge')
  assert.equal(lanePaused({ ...flow('Inner Loop milestone check', 'x-com'), trigger: { type: 'event', schedule: '', source: 'email', description: '' } }, laneRoutine(flow('Inner Loop milestone check', 'x-com'), board)), null, 'an event flow is a handoff: no badge')
  assert.equal(lanePaused({ ...flow('Build handoff', 'eggbot'), trigger: { type: 'manual', schedule: '', source: '', description: 'Outer Loop has a change' } }, null), null, 'a manual flow shows no state')
})

test('routines and handoffs are different segments: a scheduled flow is a routine a bot starts on its own; a manual or event flow is a handoff', () => {
  const at = (type: 'schedule' | 'event' | 'manual') => ({ trigger: { type, schedule: '', source: '', description: '' } })
  assert.equal(flowSegment(at('schedule')), 'routines')
  assert.equal(flowSegment(at('manual')), 'handoffs')
  assert.equal(flowSegment(at('event')), 'handoffs')
  assert.equal(ROUTINES_HINT, 'Flows a bot starts on its own, on a schedule. The badge says whether its routine is on (Active) or off (Paused) in Grok Bot.')
  assert.equal(HANDOFFS_HINT, "Flows that start when someone hands work on, or when something happens, like an email. Nothing runs on a timer, so there's no badge.")
  assert.equal(OFF_CHART_HINT, 'Routines your bots run in Grok Bot that no flow describes yet. Import processes from Grok Bot to add them with all their steps.')
})

test('a routine flow with no badge says why; one with a badge, a handoff, or a stale file match says nothing more', () => {
  assert.equal(laneNoRoutine(flow('Weekly brief', 'eggbot'), null), "No badge yet: the bot hasn't reported a routine with this name.")
  assert.equal(laneNoRoutine(flow('Inner Loop milestone check', 'x-com'), laneRoutine(flow('Inner Loop milestone check', 'x-com'), board)), '')
  assert.equal(laneNoRoutine(flow('Aura production health', 'aura'), laneRoutine(flow('Aura production health', 'aura'), board)), '', 'the last-run line already says the bot has not confirmed it')
  assert.equal(laneNoRoutine(flow('transcript-healthcheck', 'eggbot', 'Weekdays (paused)'), null), '')
  assert.equal(laneNoRoutine({ ...flow('Build handoff', 'eggbot'), trigger: { type: 'manual', schedule: '', source: '', description: '' } }, null), '')
})

test('a routine not on the Work Chart shows Paused only when its bot says so, and an event routine shows its event', () => {
  const own = { bots: [bot('lead', 'bot', [
    { name: 'Weekly', schedule: '0 9 * * 1', trigger: 'schedule' as const, timeZone: 'Europe/Madrid', enabled: false },
    { name: 'Inbox watch', schedule: '', trigger: 'email' as const, event: 'A supplier invoice lands', enabled: true },
  ])] }
  assert.deepEqual(routinesOffChart(own, []), [
    { bot: 'LEAD', name: 'Weekly', schedule: scheduleWords('0 9 * * 1', 'Europe/Madrid'), paused: true },
    { bot: 'LEAD', name: 'Inbox watch', schedule: 'A supplier invoice lands', paused: false },
  ])
})

test('a flow names what needs your attention: a step whose seat is gone or retired, a last run that failed, a schedule faster than hourly', () => {
  const seats = [
    { slug: 'inner', title: 'Inner Loop', status: 'active' as const },
    { slug: 'old', title: 'Old Bot', status: 'retired' as const },
    { slug: 'connector', title: 'Connector - BotsEverywhere (acn8)', status: 'active' as const },
  ]
  const process = (steps: { seat: string; action: string }[], schedule = '0 9 * * 1'): ProcessFile => ({ slug: 'p', name: 'Weekly', trigger: { type: 'schedule', schedule, source: '', description: '' }, steps, doneWhen: '', next: '', notes: '' })
  assert.deepEqual(laneProblems(process([{ seat: 'inner', action: 'Check' }]), seats, []), [])
  assert.deepEqual(laneProblems(process([{ seat: 'inner', action: 'Check' }, { seat: 'old', action: 'Review' }, { seat: 'gone', action: 'Ship' }]), seats, []), ['Old Bot is retired', 'gone is not a seat in this organization'])
  assert.deepEqual(laneProblems(process([{ seat: '', action: 'Ship' }]), seats, []), ['A step has no seat'])
  const failed = [
    { date: '2026-10-28', time: '09:00', bot: 'Inner Loop', process: 'Weekly', step: 'Check', status: 'done' as const, note: '-', index: 0 },
    { date: '2026-10-28', time: '09:01', bot: 'Inner Loop', process: 'Weekly', step: 'Review', status: 'failed' as const, note: 'timeout', index: 1 },
  ]
  assert.deepEqual(laneProblems(process([{ seat: 'inner', action: 'Check' }, { seat: 'inner', action: 'Review' }]), seats, failed), ['The last run failed at: Review'])
  assert.deepEqual(laneProblems(process([{ seat: 'inner', action: 'Check' }], '*/10 * * * *'), seats, []), ['Runs more than once an hour'])
  assert.deepEqual(laneProblems(process([{ seat: 'connector', action: 'Sync' }], '*/20 * * * *'), seats, []), [], "the Connector's own run is meant to run often")
})

test('a schedule reads in words with its time zone; a cron line with no words stays as it is', () => {
  assert.equal(scheduleWords('49 8 * * 1', 'Europe/Madrid'), 'Every Monday at 8:49 AM · Europe/Madrid')
  assert.equal(scheduleWords('0 9,21 * * *'), 'Every day at 9:00 AM and 9:00 PM')
  assert.equal(scheduleWords('*/20 * * * *'), 'Every 20 minutes')
  assert.equal(scheduleWords('5 4 * 2 *'), '5 4 * 2 *')
  assert.equal(scheduleWords('Mon 09:00'), 'Mon 09:00')
})

test('a routine says when it last ran and runs next; a paused one has no next run', () => {
  const last = '2026-10-28T09:00:12+01:00'
  const next = '2026-10-28T20:00:00.000Z'
  assert.equal(whenLine({ enabled: true, lastRun: last, nextRun: next }), `Last run ${formatShortDate(last)} · Next run ${formatShortDate(next)}`)
  assert.equal(whenLine({ enabled: true }), 'Not run yet')
  assert.equal(whenLine({ enabled: false, lastRun: last }), `Last run ${formatShortDate(last)}`)
  assert.equal(whenLine({ enabled: false }), 'Never run')
})

test("a flow's runs come from the bot's report; from Grok Bot's files only the last run shows, marked as not confirmed, never a next run", () => {
  const reported = laneRoutine(flow('Inner Loop milestone check', 'x-com'), board)
  assert.equal(laneWhen(reported), whenLine(reported!.routine))
  const files = laneRoutine(flow('Aura production health', 'aura'), board)!
  assert.equal(laneWhen({ ...files, routine: { ...files.routine, lastRun: '2026-09-18T09:12:52+02:00', nextRun: '2026-10-29T08:00:00.000Z' } }), `Last run ${formatShortDate('2026-09-18T09:12:52+02:00')} · not confirmed by the bot yet`)
  assert.equal(laneWhen(files), 'Not confirmed by the bot yet')
  assert.equal(laneWhen(null), '')
})

test("routines a bot reports that have no flow yet are named once; the Connector's own run is not one of them", () => {
  assert.deepEqual(routinesOffChart(board, [{ name: 'Inner Loop milestone check' }, { name: 'aura production health' }]), [{ bot: 'AURA', name: 'Old routine', schedule: scheduleWords('0 9 * * 1'), paused: false }], "Grok Bot's files never say paused")
  assert.deepEqual(routinesOffChart(board, []).map((item) => [item.name, item.paused]), [['Inner Loop milestone check', false], ['Aura production health', false], ['Old routine', false]])
  assert.deepEqual(routinesOffChart(null, []), [])
})

test("every bot is connected to the account's apps: connected first, then the ones that need signing in again", () => {
  assert.deepEqual(connectedApps([{ name: 'Finance', status: 'needsAuth' }, { name: 'X', status: 'connected' }, { name: 'Gmail', status: 'connected' }]), [
    { name: 'X', status: 'connected' },
    { name: 'Gmail', status: 'connected' },
    { name: 'Finance', status: 'needsAuth' },
  ])
  assert.deepEqual(connectedApps(undefined), [])
})

test("a bot's skills are the ones it reported in Grok Bot and the ones added here, each once by name; unknown until either is there", () => {
  const reported = [{ name: 'graph-skill', description: 'Exports the team' }, { name: 'Court one-pager' }]
  const added = [{ name: 'court one-pager', description: 'Saved from here' }, { name: 'Invoices' }, { name: ' ' }]
  assert.deepEqual(skillsInGrok(reported, added), [{ name: 'graph-skill', description: 'Exports the team' }], 'one on both lists shows once, as added here')
  assert.deepEqual(skillsInGrok(undefined, added), [])
  assert.equal(skillCount(reported, added), 3, 'graph-skill, Court one-pager and Invoices; a blank row is not a skill')
  assert.equal(skillCount([], []), 0, 'the bot reported none')
  assert.equal(skillCount(undefined, []), null, 'not reported and none added: unknown')
  assert.equal(skillCount(undefined, [{ name: 'Invoices' }]), 1)
})

test('a Work Chart with no flows shows only the import from Grok Bot, open; routines off the chart point to that import', () => {
  const chart = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /const empty = processes\.length === 0/)
  assert.match(chart, /\{empty \? null : <p className="process-fallback">/, 'no fallback line before there is work')
  assert.match(chart, /\{editable && !empty \? <Button variant="primary" type="button" onClick=\{\(\) => setDrawer\('new'\)\}>\+ New process<\/Button> : null\}/)
  assert.match(chart, /\{empty && !editable \? <p className="be-empty">No processes yet\./, 'only a template with no flows says so')
  assert.match(chart, /\{empty \? null : \(\n\s+<section className="process-idle"/, 'no list of idle seats before there is work')
  assert.match(chart, /<details className="link-panel" open=\{empty\}>/)
  assert.match(chart, /\{editable && empty \? \(\n\s+<div className="process-intro">/, 'an empty Work Chart explains itself under the title')
  for (const line of [
    'The Work Chart shows the work your bots already do in Grok Bot: one flow for each routine or handoff, with what starts it, each step in order, and who does it.',
    'Click <strong>Copy prompt</strong> below and paste it into Grok Bot.',
    'Grok Bot sends you a file named <code>botseverywhere-processes.json</code>. Save it.',
    'Click <strong>Import processes file</strong> and pick that file.',
  ]) assert.ok(chart.includes(line), line)
  assert.equal(chart.includes('Sync with Grok Bot adds them as flows'), false)
  assert.equal(chart.includes('process-off-chart'), false, 'routines off the chart are their own segment, not a note')
})

test('the Work Chart shows routines, handoffs, and routines not on it yet as segments, with a selector to show all or one', () => {
  const chart = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /const routineFlows = processes\.filter\(\(process\) => flowSegment\(process\) === 'routines'\)/)
  assert.match(chart, /const handoffFlows = processes\.filter\(\(process\) => flowSegment\(process\) === 'handoffs'\)/)
  assert.match(chart, /<select className="text-input" aria-label="Show" value=\{show\} onChange=\{\(event\) => setShow\(event\.target\.value as Show\)\}>/, 'a native select')
  for (const option of [
    '<option value="all">All ({processes.length + offChart.length})</option>',
    '<option value="routines">Routines ({routineFlows.length})</option>',
    '<option value="handoffs">Handoffs ({handoffFlows.length})</option>',
    '<option value="off">Not on the Work Chart yet ({offChart.length})</option>',
  ]) assert.ok(chart.includes(option), option)
  for (const hint of ['{ROUTINES_HINT}', '{HANDOFFS_HINT}', '{OFF_CHART_HINT}']) assert.ok(chart.includes(`<p className="process-segment-hint">${hint}</p>`), hint)
  assert.match(chart, /const showOff = offChart\.length > 0 && \(empty \|\| show === 'all' \|\| show === 'off'\)/, 'routines not on the chart show on an empty chart too')
  assert.match(chart, /const noRoutine = laneNoRoutine\(process, live\)/)
  assert.match(chart, /\{noRoutine \? <p>\{noRoutine\}<\/p> : null\}/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.process-segment \{/)
  assert.equal(css.includes('.process-off-chart'), false)
})

test("the Work Chart's flows carry the live routine; Performance and Profile show the account's apps once and the apps each bot uses", () => {
  const hook = readFileSync(new URL('../../src/live/use-routine-board.ts', import.meta.url), 'utf8')
  assert.match(hook, /export function useRoutineBoard\(orgId: string, refresh: unknown, enabled: boolean\)/)
  assert.match(hook, /fetch\(`\/api\/orgs\/\$\{orgId\}\/routines`\)/)
  assert.equal(existsSync(new URL('../../src/components/RoutineBoard.tsx', import.meta.url)), false, 'no separate list repeating the flows')
  const chart = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /scheduleWords\(process\.trigger\.schedule, live\?\.routine\.timeZone\)/, 'the schedule box reads in words, never a bare cron line')
  assert.match(chart, /className=\{paused \? 'process-lane is-paused' : 'process-lane'\}/)
  assert.match(chart, /\{paused === null \? null : <span className=\{paused \? 'routine-state is-paused' : 'routine-state is-active'\}>\{paused \? 'Paused' : 'Active'\}<\/span>\}/)
  assert.match(chart, /<span>\{stepText\(step\.action\)\}<\/span>/, "steps read without Grok Bot's Needs approval: mark")
  assert.match(chart, /\{status\?\.status === 'waiting' \|\| \(!status && waitsForYou\(step\)\) \? <em className="process-check">Needs your approval<\/em> : null\}/, 'the tag shows what waits for you today, not the safety asks a copied routine adds')
  assert.match(chart, /const problems = laneProblems\(process, allSeats, runLines\)/)
  assert.match(chart, /\{problems\.length \? <span className="routine-state is-problem">Needs attention<\/span> : null\}/)
  assert.match(chart, /\{problems\.length \? <ul className="process-problems">\{problems\.map\(\(problem\) => <li key=\{problem\}>\{problem\}<\/li>\)\}<\/ul> : null\}/)
  assert.equal(chart.includes('process-warn'), false, 'the once-an-hour warning is one of the problems now')
  assert.match(chart, /routinesOffChart\(board, processes\)/)
  assert.match(chart, /\{live \? <p>\{laneWhen\(live\)\}<\/p> : null\}/, "runs read from the bot's report; Grok Bot's files never give a next run")
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /const routineBoard = useRoutineBoard\(bundle\.id, sync, editable\)/)
  assert.match(workspace, /board=\{editable \? routineBoard : null\}/)
  assert.equal(workspace.includes('RoutineBoard board='), false)
  assert.match(workspace, /<th>Apps used<\/th>/)
  assert.equal(workspace.includes('<th>Connected</th>'), false, 'no column repeating the same account list on every row')
  assert.match(workspace, /<AccountApps apps=\{accountApps\} \/>/, "the account's apps once, above the table, as badges")
  const badges = readFileSync(new URL('../../src/components/AccountApps.tsx', import.meta.url), 'utf8')
  assert.match(badges, /<strong>Connected to your Grok Bot account:<\/strong>/)
  assert.match(badges, /className=\{app\.status === 'needsAuth' \? 'app-badge is-needs-auth' : 'app-badge is-connected'\}/)
  assert.match(badges, /\{app\.name\}\{app\.status === 'needsAuth' \? ' \(needs sign-in\)' : ''\}/)
  assert.match(workspace, /appsUsed: routineBoard\?\.bots\.find\(\(item\) => item\.slug === seat\.id\)\?\.apps/)
  assert.match(workspace, /reportedApps=\{routineBoard\?\.bots\.find\(\(item\) => item\.slug === chartSeat\.id\)\?\.apps\}/)
  assert.equal(workspace.includes('<th>Apps</th>'), false)
  assert.match(workspace, /reportedSkills=\{routineBoard\?\.bots\.find\(\(item\) => item\.slug === chartSeat\.id\)\?\.skills\}/)
  const profile = readFileSync(new URL('../../src/components/BotProfile.tsx', import.meta.url), 'utf8')
  assert.match(profile, /<h3 className="card-label">Apps used<\/h3>/)
  assert.match(profile, /<AccountApps apps=\{account\} \/>/, 'the same badges as Performance')
  assert.equal(profile.includes('Turned on in Grok Bot</h3>'), false, 'one Skills section, not a second one further down')
  assert.match(profile, /<SkillEditor initial=\{seat\.skills \?\? \[\]\} inGrok=\{reportedSkills\}/)
  assert.match(profile, /<ProfileLists seat=\{seat\} inGrok=\{reportedSkills\} \/>/)
  assert.match(profile, /const shown = skillsInGrok\(inGrok, skills\)/, "the bot's skills, less the ones on the list added here")
  assert.match(profile, /\{skills\.length === 0 && !shown\.length \? <p className="auth-note">No skills yet\.<\/p> : null\}/, 'No skills yet only when the bot has none')
  assert.match(workspace, /<th>Skills<\/th>/)
  assert.match(workspace, /skills: skillCount\(routineBoard\?\.bots\.find\(\(item\) => item\.slug === seat\.id\)\?\.skills, seats\.find\(\(item\) => item\.slug === seat\.id\)\?\.skills\)/)
  assert.match(workspace, /tasksDone30d: board\?\.routineRuns30d \?\? seat\.tasksDone30d,\n\s+tasksReportedAt: board\?\.routineRuns30d === undefined \? undefined : board\.reportedAt,/, "the bot's own count of routine runs first")
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.process-lane\.is-paused \{/)
  assert.match(css, /\.routine-state\.is-problem \{ background: var\(--color-amber-50\); color: var\(--color-amber-800\); border-color: var\(--color-amber-200\); \}/)
  assert.equal(css.includes('.routine-board {'), false)
  assert.match(css, /\.app-badge\.is-connected \{ background: var\(--color-green-50\); color: var\(--color-green-700\); border-color: var\(--color-green-200\); \}/)
  assert.match(css, /\.app-badge\.is-needs-auth \{ background: var\(--color-amber-50\); color: var\(--color-amber-800\); border-color: var\(--color-amber-200\); \}/)
})
