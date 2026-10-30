import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MAIN_BOT_LINE, MAIN_BOT_QUESTION, connectorImportLine, elsewhereTag, greyedLine, mainBotChoices } from '../../src/components/sync-copy.ts'

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('greyed copy', () => {
  assert.equal(elsewhereTag(['BotsEverywhere']), 'In BotsEverywhere')
  assert.equal(elsewhereTag(['A', 'B']), 'In A and B')
  assert.equal(elsewhereTag(['A', 'B', 'C']), 'In A, B, and C')
  assert.equal(elsewhereTag([]), 'In another organization', 'before the writer names it')
  assert.equal(greyedLine('Research', ['BotsEverywhere']), 'Research is used in BotsEverywhere. A bot works for one organization.')
  assert.equal(connectorImportLine(19, 4), '19 bots added. 4 are greyed: they work in another organization.')
  assert.equal(connectorImportLine(3, 0), '3 bots added.')
})

test('the seat panel shows the four choices and the chart greys the card', () => {
  const box = source('src/components/GreyedSeatBox.tsx')
  for (const label of ['Move it here', 'Rename and publish in Grok Bot', 'Remove', "It's my main bot"]) assert.match(box, new RegExp(`>${label}</Button>`), label)
  assert.match(box, /Takes this seat off the chart\. The bot stays in \{names\}\./)
  assert.match(box, /\{canMarkMain \? \(/, "It's my main bot shows only while no main bot is saved")
  assert.match(source('src/components/SeatDrawer.tsx'), /\{greyed \? \(/, 'a greyed seat shows the choices instead of the tabs')
  assert.match(source('src/components/OrgChart.tsx'), /is-elsewhere/)
  const workspace = source('src/pages/Workspace.tsx')
  assert.match(workspace, /\/seats\/\$\{slug\}\/\$\{action\}/)
  assert.match(workspace, /'move-here'/)
  assert.match(workspace, /canMarkMain: !sync\?\.mainBot/)
  assert.match(source('src/components/LinkCompany.tsx'), />Import from the Connector</)
  assert.match(source('src/styles/app.css'), /\.org-card-hit\.is-elsewhere \{/)
})

test('the main bot question offers the greyed bots, the one most seats report to first', () => {
  const seats = [
    { id: 'you', name: 'You', type: 'human' as const },
    { id: 'overheard', name: 'Overheard', type: 'bot' as const, reportsTo: 'you', elsewhere: [] },
    { id: 'grok-bot', name: 'Grok Bot', type: 'bot' as const, reportsTo: 'you', elsewhere: [] },
    { id: 'brand', name: 'Brand', type: 'bot' as const, reportsTo: 'grok-bot', elsewhere: [] },
    { id: 'research', name: 'Research', type: 'bot' as const, reportsTo: 'grok-bot', elsewhere: [] },
    { id: 'demo', name: 'Demo', type: 'bot' as const, reportsTo: 'brand', elsewhere: [] },
    { id: 'connector', name: 'Connector - BotsEverywhere (acn8)', type: 'bot' as const, reportsTo: 'you' },
    { id: 'old', name: 'Old', type: 'bot' as const, reportsTo: 'you', elsewhere: [], status: 'retired' as const },
  ]
  assert.deepEqual(mainBotChoices(seats, '').map((seat) => seat.id), ['grok-bot', 'brand', 'demo', 'overheard', 'research'])
  assert.deepEqual(mainBotChoices(seats, 'g1'), [], 'a main bot is saved')
  assert.deepEqual(mainBotChoices(seats, undefined), [], 'the writer has not said yet')
  assert.deepEqual(mainBotChoices(seats.filter((seat) => !seat.elsewhere), ''), [], 'nothing here is greyed')
  assert.equal(MAIN_BOT_QUESTION, 'Which bot is your main bot?')
  assert.equal(MAIN_BOT_LINE, 'Your main bot works in every organization, so it is never greyed. You pick it once.')
})

test('the org chart asks for the main bot until one is saved', () => {
  const bar = source('src/components/MainBotBar.tsx')
  assert.match(bar, /<select/, 'a native select')
  assert.match(bar, />It's my main bot<\/Button>/)
  assert.match(bar, />Not now<\/Button>/)
  assert.match(bar, /localStorage/, 'Not now is remembered in this browser')
  const workspace = source('src/pages/Workspace.tsx')
  assert.match(workspace, /mainBotChoices\(active, sync\?\.mainBot\)/)
  assert.match(workspace, /<MainBotBar[\s\S]*?greyedAction\(id, 'main-bot'\)/)
  assert.match(source('src/styles/app.css'), /\.main-bot-bar \{/)
})
