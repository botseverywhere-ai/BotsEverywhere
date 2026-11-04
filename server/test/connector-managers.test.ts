import assert from 'node:assert/strict'
import test from 'node:test'
import { connectorGuide } from '../src/connector-prompt.ts'
import { parseGrokData, rowsFromDump } from '../src/grok-data.ts'

const dump = {
  dumpedAt: '2026-10-29T14:00:00+01:00',
  copy: 'acn8',
  bots: [{ id: 's1', name: 'Security', description: 'Reviews secrets.', routinesVisible: false, reportsTo: 'Grok Bot', alsoReportsTo: ['Outer Loop'] }],
  skills: [],
  self: { id: 'c1', name: 'Connector - BotsEverywhere (acn8)', grokBotUrl: 'grokbot://app/v1/agent?id=c1' },
}

test("CONNECTOR.md asks for each bot's own-text managers and for the Connector itself", () => {
  const guide = connectorGuide({ id: 'acn8', orgsFolder: '/o' })
  assert.match(guide, /reportsTo and alsoReportsTo: who its own text, outside every "=== BotsEverywhere" block, says it reports to/)
  assert.match(guide, /"reportsTo": ""/)
  assert.match(guide, /"self": \{ "id": ""/)
})

test('the dump reads managers and self, and a dump without them still reads', () => {
  const parsed = parseGrokData(JSON.stringify(dump))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  assert.equal(parsed.data.bots[0]?.reportsTo, 'Grok Bot')
  assert.deepEqual(parsed.data.bots[0]?.alsoReportsTo, ['Outer Loop'])
  assert.equal(parsed.data.self?.id, 'c1')
  const older = parseGrokData(JSON.stringify({ ...dump, self: undefined, bots: [{ id: 's1', name: 'Security', description: 'x', routinesVisible: false }] }))
  assert.ok(older.ok)
  const bad = parseGrokData(JSON.stringify({ ...dump, self: 'me', bots: [{ ...dump.bots[0], reportsTo: 7, alsoReportsTo: 'Outer Loop' }] }))
  assert.ok(bad.ok, 'a malformed manager or self is dropped, never a refused dump')
  if (bad.ok) assert.equal(bad.data.bots[0]?.reportsTo, undefined)
})

test("rowsFromDump names the manager from the bot's text and adds the Connector", () => {
  const parsed = parseGrokData(JSON.stringify(dump))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  const rows = rowsFromDump(parsed.data, 'acn8', 'org-new')
  const security = rows.find((row) => row.name === 'Security')
  assert.equal(security?.reportsTo, 'Grok Bot')
  assert.deepEqual(security?.alsoReportsTo, ['Outer Loop'])
  const connector = rows.find((row) => row.name === 'Connector - BotsEverywhere (acn8)')
  assert.equal(connector?.grokBotUrl, 'grokbot://app/v1/agent?id=c1')
})
