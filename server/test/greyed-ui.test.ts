import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { connectorImportLine, elsewhereTag, greyedLine } from '../../src/components/sync-copy.ts'

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
