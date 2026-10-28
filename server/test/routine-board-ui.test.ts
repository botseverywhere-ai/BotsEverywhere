import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatShortDate } from '../src/bot-metrics.ts'
import type { BoardBot } from '../src/routine-board.ts'
import { boardGroups, sourceLine, whenLine } from '../../src/components/routine-board-copy.ts'

const bot = (slug: string, source: BoardBot['source'], routines: BoardBot['routines'] = [], reportedAt = ''): BoardBot => ({ slug, title: slug.toUpperCase(), source, reportedAt, routines })

test('the board shows bots with routines one by one, and names the rest in two short lines', () => {
  const groups = boardGroups({ bots: [
    bot('x', 'bot', [{ name: 'Check', schedule: '0 9 * * *', trigger: 'schedule', enabled: true }]),
    bot('lead', 'bot'),
    bot('aura', 'files', [{ name: 'Health', schedule: '0 9 * * 1-5', trigger: 'schedule', enabled: true }]),
    bot('helper', 'none'),
    bot('empty-files', 'files'),
    bot('connector', 'app'),
  ] })
  assert.deepEqual(groups.withRoutines.map((item) => item.slug), ['x', 'aura'])
  assert.deepEqual(groups.noRoutines, ['LEAD', 'EMPTY-FILES'])
  assert.deepEqual(groups.waiting, ['HELPER', 'CONNECTOR'], 'a Connector that has not run yet is waiting too')
})

test('each bot says where its routines come from', () => {
  assert.equal(sourceLine(bot('x', 'bot', [], '2026-10-28T14:10:00+01:00')), `Reported by the bot ${formatShortDate('2026-10-28T14:10:00+01:00')}`)
  assert.equal(sourceLine(bot('aura', 'files')), "From Grok Bot's files · may be out of date")
  assert.equal(sourceLine(bot('connector', 'app')), 'Set by BotsEverywhere')
  assert.equal(sourceLine(bot('helper', 'none')), 'Not reported yet')
})

test('each routine says when it last ran and runs next, and a paused one says so', () => {
  const last = '2026-10-28T09:00:12+01:00'
  const next = '2026-10-28T20:00:00.000Z'
  assert.equal(whenLine({ name: 'Check', schedule: '0 9,21 * * *', trigger: 'schedule', enabled: true, lastRun: last, nextRun: next }), `Last run ${formatShortDate(last)} · Next run ${formatShortDate(next)}`)
  assert.equal(whenLine({ name: 'Check', schedule: '0 9 * * *', trigger: 'schedule', enabled: true }), 'Not run yet')
  assert.equal(whenLine({ name: 'Wall', schedule: '0 9 * * 2', trigger: 'schedule', enabled: false, lastRun: last }), `Paused · last run ${formatShortDate(last)}`)
  assert.equal(whenLine({ name: 'Wall', schedule: '0 9 * * 2', trigger: 'schedule', enabled: false }), 'Paused · never run')
})

test('the Work Chart shows Routines in Grok Bot on your own organizations, refreshed with the sync status', () => {
  const board = readFileSync(new URL('../../src/components/RoutineBoard.tsx', import.meta.url), 'utf8')
  assert.match(board, /fetch\(`\/api\/orgs\/\$\{orgId\}\/routines`\)/)
  assert.match(board, /<h2 id="routine-board-title">Routines in Grok Bot<\/h2>/)
  assert.match(board, /startLine\(routine\)/, 'the schedule reads in words with its time zone, as in Profile')
  assert.match(board, /\{routine\.enabled === false \? 'Paused' : 'Active'\}/)
  const chart = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /\{notice \? <SaveAlert kind=\{notice\.kind\}>\{notice\.message\}<\/SaveAlert> : null\}\n {6}\{routines\}/, 'right under the title, before the processes')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /routines=\{editable \? <RoutineBoard orgId=\{bundle\.id\} refresh=\{sync\} \/> : undefined\}/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.routine-card\.is-paused \{/)
})
