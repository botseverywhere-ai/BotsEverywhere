import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Seat } from '../../src/data/mock-companies.ts'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

function seat(id: string, name: string, reportsTo?: string, alsoReportsTo?: string[]): Seat {
  return { id, orgId: 'desk', name, role: name, type: 'bot', reportsTo, ...(alsoReportsTo ? { alsoReportsTo } : {}), grokShareUrl: null, addToGrokBotUrl: null, grokBotUrl: null, prompt: '', curated: true, status: 'active', card: { owns: [], may: [], mustAskBefore: [], doneWhen: [] } } as unknown as Seat
}

const TEAM = [
  { ...seat('you', 'You'), type: 'human' } as Seat,
  seat('inner', 'Inner Loop', 'you'),
  seat('outer', 'Outer Loop', 'you'),
  seat('security', 'Security', 'inner', ['outer']),
]

test('a card with extra managers shows "Also reports to …"', async () => {
  const { OrgChart } = await import('../../src/components/OrgChart.tsx')
  const html = await render(OrgChart, { seats: TEAM, selectedId: '', onSelect: () => undefined })
  const card = /<button[^>]*data-seat-id="security"[\s\S]*?<\/button>/.exec(html)?.[0] ?? ''
  assert.match(card, /<span class="org-also" title="Also reports to Outer Loop">Also reports to Outer Loop<\/span>/)
  const inner = /<button[^>]*data-seat-id="inner"[\s\S]*?<\/button>/.exec(html)?.[0] ?? ''
  assert.doesNotMatch(inner, /org-also/)
})

test("alsoLinePath goes from the manager's bottom center to the report's top center", async () => {
  const { alsoLinePath } = await import('../../src/components/AlsoReportsLines.tsx')
  const path = alsoLinePath({ x: 100, y: 20, w: 200, h: 80 }, { x: 400, y: 300, w: 200, h: 80 })
  assert.match(path, /^M 200 100 /, 'starts at the bottom center of the manager card')
  assert.match(path, / 500 300$/, 'ends at the top center of the report card')
})

test('the legend shows a dotted line item only when some seat has an extra manager', async () => {
  const { OrgChart } = await import('../../src/components/OrgChart.tsx')
  const legend = (html: string) => /<ul class="org-legend">[\s\S]*?<\/ul>/.exec(html)?.[0] ?? ''
  const withAlso = await render(OrgChart, { seats: TEAM, selectedId: '', onSelect: () => undefined })
  assert.match(legend(withAlso), /<li><i class="swatch swatch-also"><\/i> Also reports to<\/li>/)
  const without = await render(OrgChart, { seats: TEAM.map((item) => ({ ...item, alsoReportsTo: undefined })), selectedId: '', onSelect: () => undefined })
  assert.doesNotMatch(legend(without), /swatch-also/)
})

test('the dotted lines sit inside the chart tree, so pan, zoom, and Download PNG carry them', () => {
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /<AlsoReportsLines treeRef=\{treeRef\}/)
  const png = readFileSync(new URL('../../src/components/chart-png.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(/PNG_SKIP = '([^']*)'/.exec(png)?.[1] ?? '', /also/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.org-also-lines \{[^}]*pointer-events: none/)
  assert.match(css, /\.org-also-lines path \{[^}]*stroke-dasharray/)
  // The layer is an element beside the top seats, so the tree's connector rules count list items only.
  assert.match(css, /\.org-tree li:only-of-type::before/)
  assert.doesNotMatch(css, /\.org-tree li:(?:only|first|last)-child/)
})

test('a legend that would run under Find seat sits above the chart instead, measured at its full width', async () => {
  const { legendFits } = await import('../../src/components/chart-png.ts')
  // Seven items, 12px apart, inside 10px padding and a 1px border, then 12px before Find seat.
  const items = [60, 50, 70, 100, 120, 130, 80]
  assert.equal(legendFits({ legendLeft: 34, itemWidths: items, toolbarLeft: 1045 }), true, 'a wide chart')
  assert.equal(legendFits({ legendLeft: 34, itemWidths: items, toolbarLeft: 750 }), true, 'just fits: 34 + 610 + 72 + 22 + 12')
  assert.equal(legendFits({ legendLeft: 34, itemWidths: items, toolbarLeft: 749 }), false, 'one pixel short')
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /legendStacked \? ' legend-stacked' : ''/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.org-chart\.legend-stacked \.org-legend \{[^}]*position: static/)
})
