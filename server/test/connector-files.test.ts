import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CONNECTOR_FILES_NOTE, connectorFiles } from '../../src/components/sync-copy.ts'

test('Files the Connector uses names each real file, who writes it, and what it holds', () => {
  const rows = connectorFiles('C:\\Users\\miguel\\app\\orgs', 'C:\\Users\\miguel\\app\\orgs\\your-company', 'uft5')
  assert.deepEqual(rows.map((row) => row.path), [
    'C:\\Users\\miguel\\app\\orgs\\connector.json',
    'C:\\Users\\miguel\\app\\orgs\\your-company\\grok\\snapshot.json',
    'C:\\Users\\miguel\\app\\orgs\\your-company\\log\\',
    'C:\\Users\\miguel\\app\\orgs\\project.json',
    'C:\\Users\\miguel\\app\\orgs\\your-company\\grok\\requests.json',
    'C:\\Users\\miguel\\app\\orgs\\connector-log.json',
  ])
  assert.deepEqual(rows.map((row) => row.writer), [
    'The Connector, last on every run',
    'The Connector, every run',
    'The Connector and your bots',
    'This app',
    'This app',
    'This app',
  ])
  assert.match(rows[0]!.holds, /status above comes from this file/)
  assert.match(rows[2]!.holds, /lines say Connector/)
  assert.match(rows[3]!.holds, /uft5/, 'the id in the Connector name')
  for (const row of rows) assert.doesNotMatch(row.holds, /\bcompan(y|ies)\b/i)
})

test('Mac and Linux paths keep forward slashes, and paths read relative until the writer answers', () => {
  const rows = connectorFiles('/home/ada/app/orgs', '/home/ada/app/orgs/org-k3f9x2ma', 'k3f9')
  assert.equal(rows[1]!.path, '/home/ada/app/orgs/org-k3f9x2ma/grok/snapshot.json')
  assert.equal(rows[2]!.path, '/home/ada/app/orgs/org-k3f9x2ma/log/')
  const waiting = connectorFiles('', '', '')
  assert.equal(waiting[0]!.path, 'orgs/connector.json')
  assert.equal(waiting[1]!.path, 'orgs/<org>/grok/snapshot.json')
})

test('Step 1 folds the file list away under Files the Connector uses, and says the prompt is not a file', () => {
  assert.equal(CONNECTOR_FILES_NOTE, 'The Connector is the bot in Grok Bot, and the prompt above is its instructions. No file on this computer holds it.')
  const step = readFileSync(fileURLToPath(new URL('../../src/components/ConnectGrok.tsx', import.meta.url)), 'utf8')
  assert.match(step, /Files the Connector uses/)
  assert.match(step, /connectorFiles\(project\?\.orgsFolder \?\? '', status\?\.folder \?\? '', project\?\.id \?\? ''\)/)
  assert.match(step, /\{CONNECTOR_FILES_NOTE\}/)
  assert.ok(step.indexOf('Files the Connector uses') > step.indexOf('Show the prompt'), 'below the prompt')
})
