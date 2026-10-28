import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatShortDate, shownBotMetrics, withConnectorRuns } from '../src/bot-metrics.ts'

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
  assert.equal(formatShortDate(local(19, 41).toISOString()), '17 Oct 2026, 19:41', "a moment shows in this computer's own time")
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

test('a time shows in the time zone of the computer showing it, and a date alone stays the same day', () => {
  const before = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    assert.equal(formatShortDate('2026-10-17T19:41:00.000Z'), '17 Oct 2026, 15:41')
    assert.equal(formatShortDate('2026-10-14'), '14 Oct 2026', 'a date alone never slips to the day before')
    process.env.TZ = 'Asia/Tokyo'
    assert.equal(formatShortDate('2026-10-17T19:41:00.000Z'), '18 Oct 2026, 04:41')
    process.env.TZ = 'Europe/Madrid'
    assert.equal(formatShortDate('2026-10-26T12:23:06.005Z'), '26 Oct 2026, 13:23', 'Sync says the same time as Logs')
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
})

const runDay = (day: string, at: string, runs: number) => ({ id: `connector-day-${day}`, kind: 'connector-run', timestamp: at, stats: `Runs today=${runs}|First=09:00|Last=14:07|In Grok Bot=0|Waiting=0|No organization=16` })

test("the Connector's row counts the runs the app logged: runs in 30 days are its tasks, its last run is when it was last active", () => {
  const now = Date.parse('2026-10-28T14:10:00.000Z')
  const shown = { createdAt: '2026-10-28', lastActive: '', usage: null, tasks: null }
  const events = [
    runDay('2026-10-28', '2026-10-28T13:07:53.532Z', 2),
    runDay('2026-10-20', '2026-10-20T21:00:00.000Z', 5),
    runDay('2026-09-10', '2026-09-10T21:00:00.000Z', 9),
    { id: 'sync-2026-10-28T13:00:00.000Z', kind: 'sync', timestamp: '2026-10-28T13:00:00.000Z', stats: 'Runs today=40' },
  ]
  assert.deepEqual(withConnectorRuns('Connector - BotsEverywhere (acn8)', shown, events, now), { ...shown, tasks: 7, lastActive: '2026-10-28T13:07:53.532Z' })
  assert.equal(withConnectorRuns('connector - botseverywhere', shown, events, now).tasks, 7, 'capital letters ignored')
  const later = { ...shown, lastActive: '2026-10-28T14:00:00.000Z' }
  assert.equal(withConnectorRuns('Connector - BotsEverywhere (acn8)', later, events, now).lastActive, '2026-10-28T14:00:00.000Z', 'a newer time already shown stays')
})

test('every other bot, and a Connector with no logged runs, keeps the numbers it had', () => {
  const now = Date.parse('2026-10-28T14:10:00.000Z')
  const shown = { createdAt: '', lastActive: '2026-10-27T10:00:00.000Z', usage: 3, tasks: 1 }
  const events = [runDay('2026-10-28', '2026-10-28T13:07:53.532Z', 2)]
  assert.equal(withConnectorRuns('Research - botseverywhere', shown, events, now), shown)
  assert.equal(withConnectorRuns('Connector - BotsEverywhere (acn8)', shown, [], now), shown)
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  assert.match(page, /map\.set\(seat\.slug, withConnectorRuns\(seat\.title, shownBotMetrics\(\{/, 'Performance uses it for every bot row')
})
