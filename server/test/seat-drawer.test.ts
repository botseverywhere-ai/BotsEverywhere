import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { shownSeatTab } from '../../src/components/seat-drawer-tab.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('seat drawer tabs switch the panel content', () => {
  assert.equal(shownSeatTab('invoice-bot', { id: '', tab: 'card' }), 'card')
  assert.equal(shownSeatTab('invoice-bot', { id: 'research-bot', tab: 'profile' }), 'card')
  assert.equal(shownSeatTab('invoice-bot', { id: 'invoice-bot', tab: 'card' }), 'card')
  assert.equal(shownSeatTab('invoice-bot', { id: 'invoice-bot', tab: 'performance' }), 'performance')
  assert.equal(shownSeatTab('invoice-bot', { id: 'invoice-bot', tab: 'profile' }), 'profile')

  const drawer = readFileSync(path.join(root, 'src/components/SeatDrawer.tsx'), 'utf8')
  assert.match(drawer, /onClick=\{\(\) => onTab\(item\)\}/)
  assert.match(drawer, /tab === 'performance'/)
  assert.match(drawer, /Times used \(30d\)/)
  assert.match(drawer, /tab === 'profile' && seat\.type === 'bot'/)
  assert.match(drawer, /profile\.prompt/)
  assert.match(drawer, /aria-label="Close"/)
  assert.match(drawer, /className="drawer-close"/)
  assert.equal(drawer.includes('>Close<'), false)

  const workspace = readFileSync(path.join(root, 'src/pages/Workspace.tsx'), 'utf8')
  assert.equal(workspace.includes('onTab={() => undefined}'), false)
  assert.match(workspace, /onTab=\{\(tab\) => setSeatTab\(\{ id: chartSeat\.id, tab \}\)\}/)
  assert.match(workspace, /tab=\{shownSeatTab\(chartSeat\.id, seatTab\)\}/)

  const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  assert.match(css, /\.drawer-head \.btn\.drawer-close \{[^}]*width: var\(--btn-height\)/)
  assert.match(css, /\.drawer-head \.btn\.drawer-close \{[^}]*height: var\(--btn-height\)/)
  assert.match(css, /\.drawer-head \.btn\.drawer-close \{[^}]*margin: 0/)
  assert.match(drawer, /Empty\. Add what this bot must ask before doing\./)
  assert.match(drawer, /className="field-hint"/)
  assert.match(drawer, /className="text-input card-owns"/)
  assert.equal(drawer.includes('is empty.'), false)
  assert.match(css, /\.card-field \.field-hint/)
  assert.match(css, /\.card-owns \{[^}]*overflow: hidden/)
  assert.match(css, /\.org-blurb/)
  assert.match(css, /-webkit-line-clamp: 2/)
})

test('Also reports to lists active seats other than itself and its main manager; one that would make a loop is disabled with why', async () => {
  const { alsoChoices, managerChoices } = await import('../../src/org/manager-choices.ts')
  const seats = [
    { slug: 'you', title: 'You', reportsTo: '', status: 'active' },
    { slug: 'inner', title: 'Inner Loop', reportsTo: 'you', status: 'active' },
    { slug: 'outer', title: 'Outer Loop', reportsTo: 'you', status: 'active' },
    { slug: 'security', title: 'Security', reportsTo: 'inner', status: 'active' },
    { slug: 'scan', title: 'Scanner', reportsTo: 'outer', alsoReportsTo: ['security'], status: 'active' },
    { slug: 'old', title: 'Old', reportsTo: 'you', status: 'retired' },
  ]
  assert.deepEqual(alsoChoices(seats, 'security'), [
    { slug: 'you', title: 'You' },
    { slug: 'outer', title: 'Outer Loop' },
    { slug: 'scan', title: 'Scanner', disabled: 'Scanner already reports to Security, so this would make a loop.' },
  ])
  assert.deepEqual(alsoChoices([...seats.slice(0, 3), { ...seats[3]!, alsoReportsTo: ['old'] }, seats[5]!], 'security').at(-1), { slug: 'old', title: 'Old (retired)' }, 'a retired extra manager stays listed so it can be unticked')
  assert.equal(managerChoices(seats, 'security').some((item) => item.slug === 'scan'), false, 'a dotted-line report is not offered as the main manager either')

  const drawer = readFileSync(path.join(root, 'src/components/SeatDrawer.tsx'), 'utf8')
  assert.match(drawer, /<legend className="field-label">Also reports to<\/legend>/)
  assert.match(drawer, /<AlsoReportsTo key=\{`also-\$\{seat\.id\}`\} choices=\{alsoManagers\} value=\{seat\.alsoReportsTo \?\? \[\]\} onChange=\{onAlsoReportsTo\} \/>/, 'one dropdown per extra manager instead of a box per seat; its key never matches Profile\'s, which sits beside it')
  assert.match(drawer, /<select key=\{`\$\{index\}-\$\{slug\}`\} className="text-input"/, 'each one is a native select, like Reports to')
  assert.match(drawer, /<option value="">\*\*\* None \*\*\*<\/option>/, '*** None *** takes an extra manager away, easy to find at the top of the list')
  assert.match(drawer, /disabled=\{Boolean\(item\.disabled\) \|\| \(item\.slug !== slug && value\.includes\(item\.slug\)\)\}/, 'a loop, or a manager already picked in another dropdown, cannot be picked')
  assert.match(drawer, /\{item\.disabled \? `\$\{item\.title\} \(would make a loop\)` : item\.title\}/)
  assert.match(drawer, /className="also-add".*>\+ Add another manager<\/Button>/, 'a button under the dropdowns says what it adds')
  assert.equal(drawer.includes('className="also-choice"'), false)
  const styles = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  assert.match(styles, /\.also-reports \.btn\.also-add \{ justify-self: start; width: auto; margin: 0; \}/, 'as wide as its words under the dropdowns, not a full-width bar')
  const workspace = readFileSync(path.join(root, 'src/pages/Workspace.tsx'), 'utf8')
  assert.match(workspace, /alsoManagers=\{editable \? alsoChoices\(seats, chartSeat\.id\) : undefined\}/)
  assert.match(workspace, /body: JSON\.stringify\(\{ reportsTo, alsoReportsTo \}\)/)
})
