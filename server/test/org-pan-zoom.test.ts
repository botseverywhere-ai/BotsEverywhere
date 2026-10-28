import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { anchoredScroll } from '../../src/components/org-zoom.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('zooming keeps the content under the pointer in place', () => {
  const viewport = { scrollLeft: 100, scrollTop: 50 }
  assert.deepEqual(anchoredScroll(viewport, { x: 200, y: 100 }, 2), { left: 400, top: 200 })
  assert.deepEqual(anchoredScroll(viewport, { x: 200, y: 100 }, 1), { left: 100, top: 50 })
  // Zooming out from here asks for a negative scroll; the browser clamps that to 0.
  assert.deepEqual(anchoredScroll(viewport, { x: 200, y: 100 }, 0.5), { left: -50, top: -25 })
  assert.deepEqual(anchoredScroll({ scrollLeft: 400, scrollTop: 200 }, { x: 200, y: 100 }, 0.5), { left: 100, top: 50 })
  assert.deepEqual(anchoredScroll({ scrollLeft: 0, scrollTop: 0 }, { x: 0, y: 0 }, 3), { left: 0, top: 0 })
})

test('the org chart pans by dragging and zooms on the plain wheel, with the buttons kept', () => {
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  assert.equal(chart.includes('if (!event.ctrlKey && !event.metaKey) return'), false, 'the plain wheel zooms')
  assert.match(chart, /anchoredScroll\(viewport, point, /, 'wheel zoom is anchored at the pointer')
  assert.match(chart, /event\.clientX - rect\.left/)
  assert.match(chart, /if \(event\.pointerType !== 'mouse' \|\| event\.button !== 0\) return/, 'touch keeps native scroll and pinch')
  assert.match(chart, /closest\('button, a, input, select, textarea, \[role="tab"\]'\)/, 'a drag never starts on a card or a control')
  assert.match(chart, /viewport\.setPointerCapture\(event\.pointerId\)/, 'the drag follows the mouse outside the window and ends when it is released')
  assert.match(chart, /onLostPointerCapture=\{endPan\}/)
  assert.match(chart, /onPointerCancel=\{endPan\}/)
  assert.match(chart, /'org-viewport is-panning' : 'org-viewport'/)
  assert.match(chart, /aria-label="Zoom out"/)
  assert.match(chart, /aria-label="Zoom in"/)
  assert.match(chart, />\s*Fit\s*</)
  assert.equal(chart.includes('style='), false)
  const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  assert.match(css, /\.org-viewport \{[^}]*cursor: grab;/)
  assert.match(css, /\.org-viewport\.is-panning \{ cursor: grabbing; \}/)
})

test('the viewport keeps its own height so zooming cannot grow it and trigger Fit', () => {
  const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  const rule = /\.org-viewport \{([^}]*)\}/.exec(css)?.[1] ?? ''
  // With flex: 1 inside an auto-height column, the viewport took the height of the zoomed tree.
  // Every zoom then resized it, the resize observer called fit(), and the zoom snapped back.
  assert.match(rule, /flex: 0 0 auto;/, 'the viewport is not a growing flex item')
  assert.doesNotMatch(rule, /flex: 1;/)
  assert.match(rule, /min-height: 720px;\s*height: calc\(100vh - 140px\);/, 'a tall canvas: the page scrolls past it, not the panel beside it')
  assert.match(rule, /overflow: auto;/)
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  // Scrollbars appearing or vanishing change the content box by their width; that must not count as a resize.
  assert.match(chart, /observer\.observe\(viewport, \{ box: 'border-box' \}\)/, 'Fit runs on a real viewport resize, not on scrollbars toggling')
})
