import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fitScale, ORG_CARD_TEXT_PX, ORG_TEXT_FLOOR_PX } from '../../src/components/org-zoom.ts'
import { PRINCIPLE_SEPARATOR } from '../../src/content/principles.ts'
import type { Seat, Step } from '../../src/data/mock-companies.ts'
import { isOpenSeatId, openOrgSeats, stepIdFromOpenSeat } from '../../src/org/open-seats.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('+ Hire is a real button and is not nested in the step button', () => {
  const cue = readFileSync(path.join(root, 'src/components/SeatCardCue.tsx'), 'utf8')
  assert.match(cue, /<button type="button" className="be-hire-link"/)
  assert.match(cue, /\+ Hire/)
  assert.equal(cue.includes('role="link"'), false)
  assert.equal(cue.includes('tabIndex'), false)
  assert.match(cue, /UNSTAFFED_LINE/)
  assert.match(cue, /\{hire \?/)
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  let index = 0
  let found = 0
  while ((index = chart.indexOf('<SeatCardCue', index)) !== -1) {
    found += 1
    const before = chart.slice(Math.max(0, index - 280), index)
    const opened = before.lastIndexOf('<button')
    const closed = before.lastIndexOf('</button>')
    assert.ok(opened === -1 || closed > opened, 'SeatCardCue is nested in a button')
    index += 1
  }
  assert.equal(found, 1)
})

test('hiring-rule separators keep a space on each side of the dot', () => {
  assert.equal(PRINCIPLE_SEPARATOR, ' · ')
  const strip = readFileSync(path.join(root, 'src/components/PrinciplesStrip.tsx'), 'utf8')
  assert.match(strip, /PRINCIPLE_SEPARATOR/)
})

test('Fit zoom stays at or above 12px card text', () => {
  assert.equal(ORG_TEXT_FLOOR_PX, 12)
  assert.equal(ORG_CARD_TEXT_PX, 14)
  assert.equal(fitScale(0.4), 12 / 14)
  assert.equal(fitScale(0.9), 0.9)
  assert.equal(fitScale(2), 1)
  assert.ok(fitScale(0.4) * ORG_CARD_TEXT_PX >= ORG_TEXT_FLOOR_PX)
})

test('empty org-chart seats carry the seat-card line', () => {
  const human = seat('you', 'You', 'human')
  const retired = seat('invoice-bot', 'Invoice Bot', 'bot', 'retired')
  const steps = [step('step-define', 'Define the seats', 'invoice-bot'), step('step-live', 'Live step', 'you')]
  const open = openOrgSeats(steps, [human, retired], 'your-company')
  assert.equal(open.length, 1)
  assert.equal(open[0]?.role, 'Define the seats')
  assert.equal(open[0]?.reportsTo, 'you')
  assert.equal(isOpenSeatId(open[0]!.id), true)
  assert.equal(stepIdFromOpenSeat(open[0]!.id), 'step-define')
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  assert.match(chart, /SeatCardCue/)
  assert.match(chart, /is-empty/)
})

function seat(id: string, name: string, type: Seat['type'], status?: Seat['status']): Seat {
  return {
    id,
    orgId: 'your-company',
    name,
    role: name,
    type,
    curated: true,
    status,
    card: { owns: ['a'], may: ['b'], mustAskBefore: ['c'], doneWhen: ['d'] },
  }
}

function step(id: string, name: string, executorSeatId: string): Step {
  return { id, workstreamId: 'ws', name, level: 2, executorSeatId, inputs: [], outputs: [] }
}
