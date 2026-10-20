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
  assert.match(chart, /onPick=\{\(id\) => \{\s+setListed\(null\)\s+const seat = seats\.find\(\(item\) => item\.id === id\)\s+if \(seat\) focusOn\(seat\)/)
  assert.match(workspace, /legendLists=\{editable\}/)
})

test('retired seats of one bot are one row and count once', async () => {
  const { retiredGroups } = await import('../../src/components/sync-copy.ts')
  const link = 'grokbot://inbox'
  const seat = (slug: string, retiredAt: string, extra: object = {}) => ({ slug, kind: 'bot' as const, status: 'retired' as const, grokBotUrl: link, retiredAt, ...extra })
  const groups = retiredGroups([
    seat('inbox-bot', '2026-10-19T18:25:00.000Z'),
    seat('inbox-bot-2', '2026-10-20T13:03:00.000Z'),
    seat('request-bot', '2026-10-20T14:06:00.000Z', { grokBotUrl: 'grokbot://request' }),
    seat('person', '2026-10-19T18:10:00.000Z', { kind: 'human', grokBotUrl: '' }),
    seat('active-bot', '', { status: 'active' }),
  ])
  assert.deepEqual(groups.map((group) => group.map((item) => item.slug)), [['request-bot'], ['inbox-bot-2', 'inbox-bot'], ['person']], 'newest first; an active seat is not retired')
})

test('Overview has a Retired box, every box opens its list, and a name opens the chart on that seat', () => {
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  for (const box of ["countBox('People', counts.human, 'human')", "countBox('Bots', counts.bot, 'bot')", "countBox('In Grok Bot', counts.inGrok, 'in-grok')", "countBox('Not in Grok Bot', counts.offGrok, 'off-grok')", "countBox('System', counts.system, 'system')", "countBox('Retired', retiredGroups(retired).length, 'retired')"]) {
    assert.ok(overview.includes(box), box)
  }
  assert.match(overview, /onPick=\{\(id\) => \{ window\.location\.hash = `\$\{chartHref\}\?seat=\$\{encodeURIComponent\(id\)\}` \}\}/)
  assert.match(overview, /<RetiredDrawer seats=\{retired\}/)
  assert.match(chart, /if \(!focusId \|\| focusedRef\.current === focusId\) return/, 'the chart finds ?seat= once')
  assert.match(workspace, /focusId=\{view === 'org' \? focusSeat : ''\}/)
  assert.match(workspace, /count: retiredGroups\(retired\)\.length/)
})
