import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CONNECTOR_FILES_NOTE, connectorFiles, lastRunShort } from '../../src/components/sync-copy.ts'
import { FILE_WHAT, connectorStatusFile } from '../../src/components/file-guide-copy.ts'

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

test('Status file names connector.json in the orgs folder and tells it the way Your files does', () => {
  const now = Date.parse('2026-10-21T13:30:00.000Z')
  const written = Date.parse('2026-10-21T12:56:00.000Z')
  const project = (orgsFolder: string, connector: { stamp: string; syncedAt: string; error: string } | null) => ({ project: { orgsFolder, connector } })
  const ran = connectorStatusFile(project('C:\\Users\\miguel\\app\\orgs', { stamp: `${written}:120`, syncedAt: '2026-10-21T12:50:00.000Z', error: '' }), now)
  assert.deepEqual(ran, {
    name: 'connector.json',
    path: 'C:\\Users\\miguel\\app\\orgs\\connector.json',
    what: 'When the Connector last ran',
    fact: `Last run ${lastRunShort(written, now)}`,
  }, 'the time is the file time the Status line reads, not the date inside the file')
  assert.notEqual(FILE_WHAT.connector, 'When the Connector last ran', 'Overview keeps its own wording')
  assert.equal(connectorStatusFile(project('/home/ada/app/orgs', null), now).path, '/home/ada/app/orgs/connector.json')
  assert.equal(connectorStatusFile(project('/home/ada/app/orgs', null), now).fact, 'The Connector has not run yet')
  const loading = connectorStatusFile(null, now)
  assert.equal(loading.path, 'orgs/connector.json')
  assert.equal(loading.fact, '', 'nothing is said about the file until the writer answers')
})

test('Step 1 shows the Status file between Folder it uses and Status', () => {
  const step = readFileSync(fileURLToPath(new URL('../../src/components/ConnectGrok.tsx', import.meta.url)), 'utf8')
  assert.match(step, /connectorStatusFile\(status\)/)
  const folder = step.indexOf('<dt>Folder it uses</dt>')
  const file = step.indexOf('<dt>Status file</dt>')
  const status = step.indexOf('<dt>Status</dt>')
  assert.ok(folder !== -1 && folder < file && file < status, 'under Folder it uses, above Status')
  assert.match(step, /<code title=\{statusFile\.path\}>\{statusFile\.name\}<\/code>/, 'the full path on hover, as on Overview')
})
