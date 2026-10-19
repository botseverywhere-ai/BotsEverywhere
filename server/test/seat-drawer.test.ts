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
  assert.match(drawer, /Usage \(30d\)/)
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
