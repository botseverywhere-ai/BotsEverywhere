import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatShortDate, shownBotMetrics } from '../src/bot-metrics.ts'

/** Run-log lines carry the wall-clock time of this computer, so the fixtures are built in local time. */
function local(hours: number, minutes: number): Date {
  return new Date(2026, 9, 17, hours, minutes)
}

const now = local(20, 0).getTime()

test('last active uses the import or a newer log line, and counts add after that snapshot', () => {
  const shown = shownBotMetrics({
    title: 'Invoice Bot',
    slug: 'invoice-bot',
    createdAt: '2026-03-02',
    lastActive: local(19, 32).toISOString(),
    runs30d: 14,
    tasksDone30d: 9,
    now,
    log: [
      { date: '2026-10-17', time: '19:32', bot: 'Invoice Bot', status: 'done' },
      { date: '2026-10-17', time: '19:40', bot: 'Invoice Bot', status: 'running' },
      { date: '2026-10-17', time: '19:41', bot: 'Invoice Bot', status: 'done' },
      { date: '2026-10-17', time: '19:42', bot: 'Someone else', status: 'done' },
    ],
  })
  assert.equal(shown.createdAt, '2026-03-02')
  assert.equal(shown.lastActive, local(19, 41).toISOString())
  assert.equal(shown.usage, 14, 'routine lines are automated tasks, not uses: the reported 14 stays')
  assert.equal(shown.tasks, 10, 'the reported 9 plus the done line after the report')
  assert.equal(formatShortDate(shown.createdAt), '2 Mar 2026')
  assert.equal(formatShortDate('2026-10-17T19:41:00.000Z'), '17 Oct 2026, 19:41')
  assert.equal(formatShortDate(''), '—')

  const unknown = shownBotMetrics({
    title: 'Quiet Bot',
    slug: 'quiet-bot',
    now,
    log: [],
  })
  assert.equal(unknown.lastActive, '')
  assert.equal(unknown.usage, null)
  assert.equal(unknown.tasks, null)

  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  assert.match(page, /<th>Created<\/th>/)
  assert.match(page, /Times used counts each time the Connector saw a bot become active, or the chats the bot logged itself\./)
  assert.equal(page.includes('toLocaleString'), false)
  const drawer = readFileSync(fileURLToPath(new URL('../../src/components/SeatDrawer.tsx', import.meta.url)), 'utf8')
  assert.match(drawer, /1 routine/)
  assert.match(drawer, /routines\.length/)
})

test('a run-log line stamped this evening in local time counts today', () => {
  const shown = shownBotMetrics({
    title: 'aurafarming.world orchestrator',
    slug: 'aurafarming-world-orchestrator',
    now: local(22, 30).getTime(),
    log: [
      { date: '2026-10-17', time: '22:19', bot: 'aurafarming.world orchestrator', status: 'running' },
      { date: '2026-10-17', time: '22:20', bot: 'aurafarming.world orchestrator', status: 'done' },
    ],
  })
  assert.equal(shown.usage, null, 'no chat logged')
  assert.equal(shown.tasks, 1)
  assert.equal(shown.lastActive, local(22, 20).toISOString())
})
