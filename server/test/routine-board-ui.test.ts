import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { formatShortDate } from '../src/bot-metrics.ts'
import type { ProcessFile } from '../src/processes.ts'
import type { BoardBot, RoutineBoard } from '../src/routine-board.ts'
import { lanePaused, laneRoutine, laneWhen, routinesOffChart, scheduleWords, whenLine } from '../../src/components/routine-board-copy.ts'
import { connectedApps } from '../../src/org/bot-apps.ts'

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
})

test("a flow is paused by the bot's own report first, then by the (paused) mark Grok Bot's import writes, then by Grok Bot's files", () => {
  assert.equal(lanePaused(flow('Inner Loop milestone check', 'x-com', 'Daily (paused)'), laneRoutine(flow('Inner Loop milestone check', 'x-com'), board)), false, "the bot's report wins over an old mark")
  assert.equal(lanePaused(flow('transcript-healthcheck', 'eggbot', 'Weekdays at 08:44, Europe/Madrid (paused)'), null), true)
  assert.equal(lanePaused(flow('Aura production health', 'aura', 'Weekdays (paused)'), laneRoutine(flow('Aura production health', 'aura'), board)), true, "the mark wins over Grok Bot's stale files")
  assert.equal(lanePaused(flow('Aura production health', 'aura'), laneRoutine(flow('Aura production health', 'aura'), board)), null, "Grok Bot's files still said active for routines paused weeks ago, so they never decide the badge")
  assert.equal(lanePaused(flow('Build handoff', 'eggbot', 'Manual'), null), null, 'nothing says, so no badge')
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
  assert.deepEqual(routinesOffChart(board, [{ name: 'Inner Loop milestone check' }, { name: 'aura production health' }]), ['AURA: Old routine'])
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
  assert.match(profile, /<h3 className="card-label">Turned on in Grok Bot<\/h3>/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.process-lane\.is-paused \{/)
  assert.equal(css.includes('.routine-board {'), false)
  assert.match(css, /\.app-badge\.is-connected \{ background: var\(--color-green-50\); color: var\(--color-green-700\); border-color: var\(--color-green-200\); \}/)
  assert.match(css, /\.app-badge\.is-needs-auth \{ background: var\(--color-amber-50\); color: var\(--color-amber-800\); border-color: var\(--color-amber-200\); \}/)
})
