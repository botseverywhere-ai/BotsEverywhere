import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { MockSeed } from '../../src/data/mock-companies.ts'
import { validateMockCompanies } from '../../src/data/validate-mock-companies.ts'

const seed = JSON.parse(readFileSync(new URL('../../src/data/mock-companies.json', import.meta.url), 'utf8')) as MockSeed

test('every template is one person managing bots: the founder alone on top, and every approval and workstream is theirs', () => {
  for (const company of seed.companies) {
    const people = company.seats.filter((seat) => seat.type === 'human')
    assert.equal(people.length, 1, `${company.org.id} has one person`)
    const founder = people[0]!
    assert.equal(founder.reportsTo ?? '', '', `${company.org.id}: the founder is at the top`)
    const ids = new Set(company.seats.map((seat) => seat.id))
    for (const seat of company.seats) if (seat.reportsTo) assert.ok(ids.has(seat.reportsTo), `${seat.id} reports to a seat that exists`)
    for (const checkpoint of company.checkpoints) assert.equal(checkpoint.approverSeatId, founder.id, `${checkpoint.id} is approved by the founder`)
    for (const stream of company.workstreams) assert.equal(stream.ownerSeatId, founder.id, `${stream.id} belongs to the founder`)
    for (const event of company.log) if (event.actorType === 'human') assert.equal(event.actorSeatId, founder.id, `${event.id} is the founder's`)
    const names = new Set(company.seats.filter((seat) => seat.type === 'bot').map((seat) => seat.name))
    assert.equal(names.size, company.seats.filter((seat) => seat.type === 'bot').length, `${company.org.id}: every bot has its own name`)
  }
})

test('a converted template still passes the template rules, with bots that manage bots', () => {
  assert.deepEqual(validateMockCompanies(seed), [])
  const rowan = seed.companies.find((company) => company.org.id === 'rowan-accountants')!
  const seat = (id: string) => rowan.seats.find((item) => item.id === `rowan-accountants-${id}`)!
  assert.deepEqual([seat('david').name, seat('david').type, seat('david').reportsTo], ['Assurance Bot', 'bot', 'rowan-accountants-owner'])
  assert.equal(seat('tie-out-bot').reportsTo, 'rowan-accountants-david', 'the five bots still report to the bot that leads them')
  assert.match(seat('david').card.owns[0]!, /hands each step to the right bot on its team/)
  assert.equal(JSON.stringify(rowan).includes('David Chen'), false, 'no trace of the person it replaced')
})
