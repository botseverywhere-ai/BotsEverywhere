import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shownBotMetrics } from '../src/bot-metrics.ts'
import { connectorPrompt } from '../src/connector-prompt.ts'

const local = (day: number, hours: number, minutes: number) => new Date(2026, 9, day, hours, minutes)
const now = local(20, 20, 0).getTime()
const line = (date: string, time: string, bot: string, process: string, status: string) => ({ date, time, bot, process, status })

test('times used counts chats; automated tasks done counts finished routine steps', () => {
  const shown = shownBotMetrics({
    title: 'Invoice Bot',
    slug: 'invoice-bot',
    now,
    log: [
      line('2026-10-20', '09:00', 'Invoice Bot', 'chat', 'done'),
      line('2026-10-20', '09:30', 'Invoice Bot', 'chat', 'failed'),
      line('2026-10-20', '09:45', 'Invoice Bot', 'chat', 'running'),
      line('2026-10-20', '10:00', 'Invoice Bot', 'Invoice arrives', 'running'),
      line('2026-10-20', '10:01', 'Invoice Bot', 'Invoice arrives', 'done'),
      line('2026-10-20', '10:02', 'Invoice Bot', 'Invoice arrives', 'skipped'),
      line('2026-10-20', '10:03', 'Someone else', 'chat', 'done'),
    ],
  })
  assert.equal(shown.usage, 2, 'two chats; a running line is not a second use')
  assert.equal(shown.tasks, 1, 'one routine step finished; a chat is not an automated task')
  assert.equal(shown.lastActive, local(20, 10, 2).toISOString(), 'the newest line of this bot')
})

test("Grok Bot's last active time no longer hides the log when Grok Bot reported no counts", () => {
  const shown = shownBotMetrics({
    title: 'Grok Bot',
    slug: 'grok-bot',
    lastActive: local(20, 18, 30).toISOString(),
    now,
    log: [line('2026-10-19', '18:50', 'Grok Bot', 'botseverywhere daily summary', 'done'), line('2026-10-20', '08:00', 'Grok Bot', 'chat', 'done')],
  })
  assert.equal(shown.tasks, 1, 'before the fix, a lastActive newer than every line made this 0')
  assert.equal(shown.usage, 1)
  assert.equal(shown.lastActive, local(20, 18, 30).toISOString())
})

test('counts Grok Bot reported are a baseline, and only newer lines add to them', () => {
  const shown = shownBotMetrics({
    title: 'Invoice Bot',
    slug: 'invoice-bot',
    lastActive: local(20, 12, 0).toISOString(),
    runs30d: 14,
    tasksDone30d: 9,
    now,
    log: [line('2026-10-20', '11:00', 'Invoice Bot', 'chat', 'done'), line('2026-10-20', '13:00', 'Invoice Bot', 'chat', 'done'), line('2026-10-20', '13:05', 'Invoice Bot', 'Invoice arrives', 'done')],
  })
  assert.equal(shown.usage, 15, '14 reported plus the chat after the report')
  assert.equal(shown.tasks, 10)
})

test("the Connector's own lines, signed Connector, count for its seat", () => {
  const shown = shownBotMetrics({
    title: 'Connector - BotsEverywhere (uft5)',
    slug: 'connector-botseverywhere-uft5',
    now,
    log: [line('2026-10-20', '18:17', 'Connector', 'botseverywhere-sync', 'done'), line('2026-10-20', '18:18', 'Connector - BotsEverywhere (uft5)', 'BotsEverywhere sync', 'done')],
  })
  assert.equal(shown.tasks, 2)
})

test('the Connector tells every bot to log each chat, and Performance names the two numbers', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/o' })
  assert.match(prompt, /7\. Tell each bot its two logging rules, and ask it to save them to its memory\./)
  assert.match(prompt, /b\. Every time someone uses the bot in a chat, append one line to that organization's log\/YYYY-MM-DD\.md/)
  assert.match(prompt, /- HH:MM \| its name \| chat \| what it was asked, in a few words \| done\|failed\|waiting \| note or -/)
  const page = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const drawer = readFileSync(new URL('../../src/components/SeatDrawer.tsx', import.meta.url), 'utf8')
  assert.match(page, /<th>Times used \(30d\)<\/th><th>Automated tasks done \(30d\)<\/th>/)
  assert.match(drawer, /<dt>Times used \(30d\)<\/dt>/)
  assert.match(drawer, /<dt>Automated tasks done \(30d\)<\/dt>/)
})

test('the Connector acts on its own: no confirmations, each rule sent once, and no counts made from the log', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/o' })
  assert.match(prompt, /Do every step below on your own, on every run\. Never ask the owner to confirm a step, a message to a bot, or how many bots to message\./)
  assert.match(prompt, /Send each bot the rules in steps 5 to 7 once: when the bot is new to you, when its seat file or process file changed, or when these rules changed\. Do not repeat them on every run\./)
  assert.match(prompt, /runs30d, tasksDone30d, lastActive, and each routine's lastRun come from Grok Bot's own data\. Never count them from the run log/)
})

test('the prompt fills in the folder, time zone, and platform of the computer running the writer', async () => {
  const madrid = connectorPrompt({ id: 'k3f9', orgsFolder: 'C:\\be\\orgs', syncMinutes: 17, timeZone: 'Europe/Madrid', windows: true })
  assert.match(madrid, /Write every time as ISO 8601 with the UTC offset of Europe\/Madrid at that moment, in the shape 2026-10-20T20:06:16\+02:00\./)
  assert.match(madrid, /Times are local time in Europe\/Madrid\./)
  assert.match(madrid, /On Windows, use \[System\.IO\.File\]::WriteAllText\(path, text\.Replace\("`r`n","`n"\), \(New-Object System\.Text\.UTF8Encoding\(\$false\)\)\)\./)
  const generic = connectorPrompt({ id: 'k3f9', orgsFolder: '/home/me/orgs', timeZone: '', windows: false })
  assert.match(generic, /Times are local time in the owner's time zone\./)
  assert.doesNotMatch(generic, /WriteAllText/)
  for (const text of [madrid, generic]) {
    assert.match(text, /^Create a bot named Connector - BotsEverywhere \(k3f9\)\. If a bot with that name already exists, do not create a second one: update the existing bot's instructions to this text instead\./)
    assert.match(text, /Never create yourself\./)
    assert.match(text, /If you can only create routines for yourself, message the owning bot and ask it to create or update its own routine/)
    assert.match(text, /You follow rule b yourself too, with your own name\./)
    assert.match(text, /If the owner's computer is offline, skip the run without writing anything\./)
    assert.match(text, /- status is active, paused, or retired\./)
    assert.doesNotMatch(text, /Madrid offset|deletes/, 'nothing from one install, and no delete step: the app no longer writes deletes')
  }
  const { mkdtempSync, mkdirSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createOrgFiles, projectInfo } = await import('../src/template-server.ts')
  const dir = mkdtempSync(join(tmpdir(), 'be-prompt-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    if (!made.ok) throw new Error('no org')
    const info = projectInfo(orgs, made.slug)
    assert.equal(typeof info.timeZone, 'string')
    assert.equal(info.windows, process.platform === 'win32')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('counts Grok Bot reported are as of its report: only later lines add, per number', () => {
  const report = local(20, 12, 0).toISOString()
  const log = [
    line('2026-10-20', '11:00', 'Invoice Bot', 'chat', 'done'),
    line('2026-10-20', '11:30', 'Invoice Bot', 'Invoice arrives', 'done'),
    line('2026-10-20', '13:00', 'Invoice Bot', 'chat', 'done'),
    line('2026-10-20', '13:05', 'Invoice Bot', 'Invoice arrives', 'done'),
  ]
  const both = shownBotMetrics({ title: 'Invoice Bot', slug: 'invoice-bot', lastActive: local(20, 9, 0).toISOString(), reportedAt: report, runs30d: 14, tasksDone30d: 9, now, log })
  assert.equal(both.usage, 15, 'the report time is the cut, not the older last-active time')
  assert.equal(both.tasks, 10)
  const usesOnly = shownBotMetrics({ title: 'Invoice Bot', slug: 'invoice-bot', reportedAt: report, runs30d: 14, now, log })
  assert.equal(usesOnly.usage, 15)
  assert.equal(usesOnly.tasks, 2, 'no task count reported, so every logged routine step counts')
})

test("the Connector does not read BotsEverywhere's number updates as a changed seat file", () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/o' })
  assert.match(prompt, /A seat file counts as changed only when its title, reportsTo, or its Owns, May, Needs approval, or Done when changed\./)
  assert.match(prompt, /Ignore the lines BotsEverywhere fills from your own report \(createdAt, lastActive, runs30d, tasksDone30d, routines, skills, publicUrl, botStatus, grokSync, grokSyncedAt, grokMissingSince, grokDeletedAt\): they change on every run\./)
})
