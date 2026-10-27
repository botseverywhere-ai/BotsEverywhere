import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'

test('the Connector puts each bot it creates in the sidebar section named like its organization', () => {
  const prompt = connectorPrompt({ id: 'uft5', orgsFolder: 'C:\\me\\orgs' })
  const step1 = prompt.slice(prompt.indexOf('1. If <org>/'), prompt.indexOf('\n2. '))
  assert.match(step1, /When you create a bot, put it in the sidebar section whose name matches this organization's name \(from org\.md\), ignoring capital letters, or the section named in "section" when the request sets it\./, 'BotsEverywhere in org.md must find the section botseverywhere')
  assert.match(step1, /If no section matches, create the bot without a section and add "noSection": "<org name>" to the note of your sync line in that organization's log\./)
  assert.match(step1, /Never create a second bot just to move it into a section\./)
  const connect = readFileSync(new URL('../../src/components/ConnectGrok.tsx', import.meta.url), 'utf8')
  assert.match(connect, /The prompt changed: the Connector now reads its rules from CONNECTOR.md in this folder, which the app keeps up to date. It writes each bot's managers, team, skills, and logging rules into a block at the end of its instructions. New bots go in the Grok Bot sidebar section named like their organization, so make one section per organization there. It still leaves deleting bots to you. If your Connector already runs, paste this prompt into it once more./)
})
