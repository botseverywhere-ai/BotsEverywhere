import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { MockSeed, Seat } from '../../src/data/mock-companies.ts'
import { commitHire, commitRestore, commitRetire, EMPTY_SESSION, stepsNow } from '../../src/preview/staffing.ts'

const seed = JSON.parse(readFileSync(new URL('../../src/data/mock-companies.json', import.meta.url), 'utf8')) as MockSeed
const meridian = seed.companies.find((company) => company.org.id === 'meridian-ledger')
if (!meridian) throw new Error('Meridian is missing from the preview seed')

const nia = meridian.seats.find((seat) => seat.name === 'Purchase Order Bot')
const matchId = 'meridian-ledger-step-match'
if (!nia) throw new Error('Purchase Order Bot is missing from Meridian')

function matchStep(session: typeof EMPTY_SESSION) {
  const step = stepsNow(meridian!, session).find((item) => item.id === matchId)
  if (!step) throw new Error('Match to PO and vendor is missing')
  return step
}

function hireAda(session: typeof EMPTY_SESSION, at: string) {
  const seat: Seat = {
    id: 'meridian-ledger-hired-ada',
    orgId: meridian!.org.id,
    name: 'Ada Test',
    role: 'Matcher',
    type: 'bot',
    curated: true,
    status: 'active',
    card: {
      owns: ['Match the PO'],
      may: ['Read the invoice'],
      mustAskBefore: ['Sending mail'],
      doneWhen: ['A human can approve'],
    },
  }
  return commitHire(meridian!, session, seat, [matchId], 'meridian-ledger-helen', at)
}

describe('step staffing after retire', () => {
  it('retire then hire staffs the step with the new bot', () => {
    const retired = commitRetire(meridian!, EMPTY_SESSION, nia!, '', 'meridian-ledger-helen', '2026-10-15T06:00:00.000Z')
    assert.equal(matchStep(retired).staffing, 'unstaffed')
    const hired = hireAda(retired, '2026-10-15T06:01:00.000Z')
    const step = matchStep(hired)
    assert.equal(hired.extraLog[0]?.type, 'hire')
    assert.equal(hired.extraLog[0]?.summary, 'Hired Ada Test as Matcher.')
    assert.equal(step.staffing, 'staffed')
    assert.equal(step.executorSeatId, 'meridian-ledger-hired-ada')
  })

  it('retire then restore puts the original bot back on the step', () => {
    const retired = commitRetire(meridian!, EMPTY_SESSION, nia!, '', 'meridian-ledger-helen', '2026-10-15T06:00:00.000Z')
    const restored = commitRestore(meridian!, retired, { ...nia!, status: 'retired' })
    const step = matchStep(restored)
    assert.notEqual(step.staffing, 'unstaffed')
    assert.equal(step.executorSeatId, nia!.id)
  })

  it('retire then hire then restore keeps the newer hire on the step', () => {
    const retired = commitRetire(meridian!, EMPTY_SESSION, nia!, '', 'meridian-ledger-helen', '2026-10-15T06:00:00.000Z')
    const hired = hireAda(retired, '2026-10-15T06:01:00.000Z')
    const restored = commitRestore(meridian!, hired, { ...nia!, status: 'retired' })
    const step = matchStep(restored)
    assert.equal(step.staffing, 'staffed')
    assert.equal(step.executorSeatId, 'meridian-ledger-hired-ada')
  })
})
