import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatShortDate } from '../src/bot-metrics.ts'
import type { BoardBot } from '../src/routine-board.ts'
import { boardGroups, handoffLine, sourceLine, whenLine } from '../../src/components/routine-board-copy.ts'
import { connectedApps } from '../../src/org/bot-apps.ts'

const bot = (slug: string, source: BoardBot['source'], routines: BoardBot['routines'] = [], extra: Partial<BoardBot> = {}): BoardBot => ({ slug, title: slug.toUpperCase(), source, reportedAt: '', routines, ...extra })

test('the board shows each bot with routines or handoffs, and names the rest in two short lines', () => {
  const groups = boardGroups({ bots: [
    bot('x', 'bot', [{ name: 'Check', schedule: '0 9 * * *', trigger: 'schedule', enabled: true }]),
    bot('research', 'bot', [], { sends: [{ who: 'x.com', what: 'Milestone briefs' }] }),
    bot('lead', 'bot', [], { sends: [], receives: [] }),
    bot('aura', 'files', [{ name: 'Health', schedule: '0 9 * * 1-5', trigger: 'schedule', enabled: true }]),
    bot('helper', 'none'),
    bot('empty-files', 'files'),
    bot('connector', 'app'),
  ] })
  assert.deepEqual(groups.shown.map((item) => item.slug), ['x', 'research', 'aura'], 'a bot with handoffs and no routines still gets its row')
  assert.deepEqual(groups.nothing, ['LEAD', 'EMPTY-FILES'])
  assert.deepEqual(groups.waiting, ['HELPER', 'CONNECTOR'], 'a Connector that has not run yet is waiting too')
})

test('each bot says where its routines come from', () => {
  assert.equal(sourceLine({ source: 'bot', reportedAt: '2026-10-28T14:10:00+01:00' }), `Reported by the bot ${formatShortDate('2026-10-28T14:10:00+01:00')}`)
  assert.equal(sourceLine({ source: 'files', reportedAt: '' }), "From Grok Bot's files · may be out of date")
  assert.equal(sourceLine({ source: 'app', reportedAt: '' }), 'Set by BotsEverywhere')
  assert.equal(sourceLine({ source: 'none', reportedAt: '' }), 'Not reported yet')
})

test('each routine says when it last ran and runs next, and a paused one says so', () => {
  const last = '2026-10-28T09:00:12+01:00'
  const next = '2026-10-28T20:00:00.000Z'
  assert.equal(whenLine({ enabled: true, lastRun: last, nextRun: next }), `Last run ${formatShortDate(last)} · Next run ${formatShortDate(next)}`)
  assert.equal(whenLine({ enabled: true }), 'Not run yet')
  assert.equal(whenLine({ enabled: false, lastRun: last }), `Paused · last run ${formatShortDate(last)}`)
  assert.equal(whenLine({ enabled: false }), 'Paused · never run')
})

test('a handoff reads as who, what, and when', () => {
  assert.equal(handoffLine({ who: 'Inner Loop - botseverywhere', what: 'Ask what shipped', when: 'Twice a day' }), 'Inner Loop - botseverywhere: Ask what shipped (Twice a day)')
  assert.equal(handoffLine({ who: 'Miguel', what: 'Post drafts for approval' }), 'Miguel: Post drafts for approval')
})

test("every bot is connected to the account's apps: connected first, then the ones that need signing in again", () => {
  assert.deepEqual(connectedApps([{ name: 'Finance', status: 'needsAuth' }, { name: 'X', status: 'connected' }, { name: 'Gmail', status: 'connected' }]), [
    { name: 'X', status: 'connected' },
    { name: 'Gmail', status: 'connected' },
    { name: 'Finance', status: 'needsAuth' },
  ])
  assert.deepEqual(connectedApps(undefined), [])
})

test('the Work Chart shows routines and handoffs on your own organizations; Performance and Profile say Connected; Profile shows the skills a bot reports', () => {
  const hook = readFileSync(new URL('../../src/live/use-routine-board.ts', import.meta.url), 'utf8')
  assert.match(hook, /export function useRoutineBoard\(orgId: string, refresh: unknown, enabled: boolean\)/)
  assert.match(hook, /fetch\(`\/api\/orgs\/\$\{orgId\}\/routines`\)/)
  const board = readFileSync(new URL('../../src/components/RoutineBoard.tsx', import.meta.url), 'utf8')
  assert.match(board, /<h2 id="routine-board-title">Routines and handoffs in Grok Bot<\/h2>/)
  assert.match(board, /startLine\(routine\)/, 'the schedule reads in words with its time zone, as in Profile')
  assert.match(board, /\{routine\.enabled === false \? 'Paused' : 'Active'\}/)
  assert.match(board, /<strong>Sends:<\/strong>/)
  assert.match(board, /<strong>Gets work from:<\/strong>/)
  const chart = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /\{notice \? <SaveAlert kind=\{notice\.kind\}>\{notice\.message\}<\/SaveAlert> : null\}\n {6}\{routines\}/, 'right under the title, before the processes')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /const routineBoard = useRoutineBoard\(bundle\.id, sync, editable\)/)
  assert.match(workspace, /routines=\{editable && routineBoard \? <RoutineBoard board=\{routineBoard\} \/> : undefined\}/)
  assert.match(workspace, /<th>Connected<\/th>/)
  assert.equal(workspace.includes('<th>Apps</th>'), false)
  assert.match(workspace, /connectedApps\(accountApps\)/)
  assert.match(workspace, /reportedSkills=\{routineBoard\?\.bots\.find\(\(item\) => item\.slug === chartSeat\.id\)\?\.skills\}/)
  const profile = readFileSync(new URL('../../src/components/BotProfile.tsx', import.meta.url), 'utf8')
  assert.match(profile, /<h3 className="card-label">Connected<\/h3>/)
  assert.match(profile, /<h3 className="card-label">Turned on in Grok Bot<\/h3>/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.routine-card\.is-paused \{/)
  assert.match(css, /\.routine-handoffs \{/)
})
