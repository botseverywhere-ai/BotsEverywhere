import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { legendCounts, legendGroup, LEGEND_TITLES } from '../../src/components/sync-copy.ts'

const seats = [
  { id: 'you', type: 'human' as const },
  { id: 'synced', type: 'bot' as const, grokSync: 'synced' as const },
  { id: 'linked', type: 'bot' as const, grokBotUrl: 'grokbot://x' },
  { id: 'missing', type: 'bot' as const, grokSync: 'missing' as const },
  { id: 'unknown', type: 'bot' as const },
  { id: 'crm', type: 'system' as const },
  { id: 'open-seat', type: 'bot' as const },
]

test('each legend number lists exactly the seats it counts', () => {
  const empty = ['open-seat']
  const counts = legendCounts(seats, empty)
  const ids = (group: Parameters<typeof legendGroup>[1]) => legendGroup(seats, group, empty).map((seat) => seat.id)
  assert.deepEqual(ids('human'), ['you'])
  assert.deepEqual(ids('bot'), ['synced', 'linked', 'missing', 'unknown'], 'an open seat is not counted')
  assert.deepEqual(ids('system'), ['crm'])
  assert.deepEqual(ids('in-grok'), ['synced', 'linked'])
  assert.deepEqual(ids('off-grok'), ['missing'], 'a bot nothing is known about is in neither Grok Bot list')
  assert.deepEqual([ids('human').length, ids('bot').length, ids('system').length, ids('in-grok').length, ids('off-grok').length], [counts.human, counts.bot, counts.system, counts.inGrok, counts.offGrok])
  assert.equal(LEGEND_TITLES['off-grok'], 'Not in Grok Bot')
})

test('on an org of your own the legend numbers are buttons that open the list, and a row finds the seat', () => {
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(chart, /if \(!legendLists\) return <li>\{body\}<\/li>/, 'templates and samples keep a plain legend')
  assert.match(chart, /className="legend-button" disabled=\{count === 0\} onClick=\{\(\) => setListed\(group\)\}/)
  assert.match(chart, /onClick=\{\(\) => \{ setListed\(null\); focusOn\(seat\) \}\}/)
  assert.match(workspace, /legendLists=\{editable\}/)
})
