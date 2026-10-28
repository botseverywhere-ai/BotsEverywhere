import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { connectorBootstrapPrompt, connectorGuide } from '../src/connector-prompt.ts'

const WIN = { id: '3s53', orgsFolder: 'C:\\Users\\me\\botseverywhere\\orgs' }

test('the prompt to paste is short, names the rules file, and has nothing a chat could mangle', () => {
  const prompt = connectorBootstrapPrompt(WIN)
  assert.match(prompt, /^Create a bot named Connector - BotsEverywhere \(3s53\)\./)
  assert.ok(prompt.includes('C:\\Users\\me\\botseverywhere\\orgs\\CONNECTOR.md'))
  assert.match(prompt, /Read C:\\Users\\me\\botseverywhere\\orgs\\CONNECTOR\.md with Shell and do THE RUN in it\./)
  assert.doesNotMatch(prompt, /`/)
  assert.ok(prompt.length < 1200, `${prompt.length} characters`)
  assert.ok(connectorBootstrapPrompt({ id: '3s53', orgsFolder: '/home/me/orgs' }).includes('/home/me/orgs/CONNECTOR.md'))
})

test('the prompt to paste names the interval, leaves later changes to CONNECTOR.md, and asks for the first run at once', () => {
  const prompt = connectorBootstrapPrompt(WIN)
  assert.match(prompt, /Keep exactly one routine, running every 15 minutes\. Its text is exactly this line:/)
  assert.match(connectorBootstrapPrompt({ ...WIN, syncMinutes: 120 }), /Keep exactly one routine, running every 2 hours\./)
  assert.match(prompt, /When CONNECTOR\.md names a different schedule, change the routine to that one\./)
  assert.match(prompt, /Right after this setup, do THE RUN once now in this chat, and then YOU, so the owner sees the Connector connect without waiting for its first scheduled run\./)
  assert.ok(connectorBootstrapPrompt({ ...WIN, syncMinutes: 10080 }).length < 1200)
})

test('after every run the Connector reports in its chat what it read and did, and says when there was nothing to change', () => {
  const guide = connectorGuide({ ...WIN, syncMinutes: 15, timeZone: 'Europe/Madrid', windows: true })
  assert.match(guide, /\n5\. Then, after every run and every time you act, reply in this chat with a short report, so the owner always knows what you did in Grok Bot:\n   BotsEverywhere sync at HH:MM\n   - Read from Grok Bot: <N> bots, <N> skills, <N> apps\n/)
  for (const line of ['Updated instructions: <bot names>', 'Created: <bot names>', 'Saved skills: <skill names>', 'Asked for a routine: <bot names>', 'Sent the one-time note: <bot names>', 'Routine confirmed: <bot names>', 'Skipped, changed in Grok Bot: <bot names>', 'Failed: <bot name>: <why>', 'Nothing to change.']) assert.ok(guide.includes(`\n   - ${line}\n`), line)
  assert.match(guide, /Leave out a line with nothing in it\. Write Nothing to change only when you carried out no item and added no confirmation\./)
  assert.doesNotMatch(guide, /added no confirmation, write nothing/, 'no run goes unreported')
  assert.match(guide, /\n6\. When several run messages arrive together, do this once, with one report\./)
  assert.match(guide, /Never ask the owner to confirm anything\./, 'a report tells; it never asks')
})

test('the rules keep the run to files, leave every decision to the app, and give the exact hash command', () => {
  const guide = connectorGuide({ ...WIN, syncMinutes: 15, timeZone: 'Europe/Madrid', windows: true })
  assert.match(guide, /THE RUN \(files only: never message, create, or change a bot, routine, skill, or memory\)/)
  assert.match(guide, /Never decide what to change in a bot: the app decides, you carry it out\./)
  assert.ok(guide.includes(`python3 -c "import json,hashlib,sys;print(hashlib.sha256(json.load(open(sys.argv[1]))['description'].encode('utf-8')).hexdigest())" /home/box/agent-data/agents/<botId>/profile.json`))
  assert.match(guide, /For each item whose key has no result in C:\\Users\\me\\botseverywhere\\orgs\\connector-results\.json/)
  assert.match(guide, /Never change any text yourself: send exactly what the item says\./)
  assert.match(guide, /Never write org\.md, seats\/, processes\/, work-chart\.md, requests\.json, snapshot\.json, connector-todo\.json, CONNECTOR\.md, or project\.json/)
})

test('the schedule follows Runs every, and Windows writing is named only on Windows', () => {
  assert.match(connectorGuide({ ...WIN, syncMinutes: 15, timeZone: '', windows: true }), /\nSchedule: every 15 minutes\. If your routine's schedule is different/)
  assert.match(connectorGuide({ ...WIN, syncMinutes: 120, timeZone: '', windows: true }), /\nSchedule: every 2 hours\./)
  assert.match(connectorGuide({ ...WIN, syncMinutes: 15, timeZone: '', windows: true }), /System\.IO\.File/)
  assert.doesNotMatch(connectorGuide({ id: '3s53', orgsFolder: '/home/me/orgs', syncMinutes: 15, timeZone: '', windows: false }), /System\.IO\.File/)
})

test('Connect bots and Docs show the short prompt; a new interval needs no paste', async () => {
  const connect = readFileSync(new URL('../../src/components/ConnectGrok.tsx', import.meta.url), 'utf8')
  const docs = readFileSync(new URL('../../src/pages/DocsPage.tsx', import.meta.url), 'utf8')
  assert.match(connect, /connectorBootstrapPrompt\(\{ id: project\?\.id \?\? '', orgsFolder: project\?\.orgsFolder \?\? '', syncMinutes: minutes \}\)/)
  assert.match(docs, /connectorBootstrapPrompt\(\{ id: '<id>', orgsFolder: '<project folder>\/orgs' \}\)/)
  assert.match(connect, /Saved\. The Connector switches to every \$\{everyLabel\(typed\)\} on its next run\./)
  const { intervalWarning } = await import('../../src/components/sync-copy.ts')
  assert.equal(intervalWarning({ syncMinutes: 17, connector: { syncedAt: '', stamp: '1:1', unassigned: [], error: '', syncMinutes: 15 } } as never), 'Grok Bot still runs the Connector every 15 minutes, not every 17 minutes. The Connector changes its schedule on its next run, from CONNECTOR.md.')
})

test('the Connector asks for profiles, keeps each one exactly as the bot sent it, and says so in its report', () => {
  const guide = connectorGuide({ ...WIN, syncMinutes: 15, timeZone: 'Europe/Madrid', windows: true })
  assert.match(guide, /YOU \(after each run, and when a bot sends you a line starting "BotsEverywhere routine saved:" or "BotsEverywhere profile:"\)/)
  assert.match(guide, /\n   - profile: SendToAgent to botId with priority true and exactly the item's message\.\n/)
  assert.match(guide, /When a bot sends you a message with a line starting "BotsEverywhere profile:" or "BotsEverywhere routines:", add it to confirmations too: line \(that line and every line after it, exactly\), from, and at\./)
  for (const line of ['Asked for profiles: <bot names>', 'Profiles received: <bot names>']) assert.ok(guide.includes(`\n   - ${line}\n`), line)
})
