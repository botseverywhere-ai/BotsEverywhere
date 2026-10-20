import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { pickedSeatName } from '../../src/components/org-zoom.ts'

const NAMES = ['You', 'Invoice Bot', 'Invoice Bot · BotsEverywhere']

test('Find seat: a name picked from the list jumps right away; typing waits for Enter', () => {
  assert.equal(pickedSeatName('insertReplacementText', 'Invoice Bot', NAMES), true, 'Chrome and Firefox send a pick as one replacement')
  assert.equal(pickedSeatName(undefined, 'Invoice Bot', NAMES), true, 'a browser without inputType')
  assert.equal(pickedSeatName('insertText', 'Invoice Bot', NAMES), false, 'typing a name that is a prefix of another does not jump early')
  assert.equal(pickedSeatName('insertReplacementText', 'Invoice', NAMES), false, 'only a whole seat name')
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /pickedSeatName\(\(event\.nativeEvent as InputEvent\)\.inputType, event\.target\.value, seatNames\)/)
})

test('Find seat: the seat panel opening re-fits the chart, and the chart scrolls back to the found seat', () => {
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /focusRef\.current = match\.id\n {4}onSelect\(match\.id\)/)
  assert.match(chart, /viewport\.scrollTop = top\n {6}scrollToFocus\(\)\n {6}return/, 'a re-fit at the same zoom keeps the found seat in view')
  assert.match(chart, /anchorRef\.current = null\n {4}scrollToFocus\(\)\n {2}\}, \[scale\]\)/, 'and at a new zoom')
  assert.match(chart, /const clamped = clamp\(next, ZOOM_MIN, ZOOM_MAX\)\n {4}focusRef\.current = ''/, 'zooming by hand lets go of it')
  assert.match(chart, /focusRef\.current = ''\n {4}panRef\.current = /, 'and so does dragging')
})
