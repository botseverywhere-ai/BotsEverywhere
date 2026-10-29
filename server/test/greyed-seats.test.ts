import assert from 'node:assert/strict'
import test from 'node:test'
import { grokSeats, isGreyed, parseSeatMarkdown, serializeExistingSeat } from '../src/org-files.ts'

const empty = { owns: [], may: [], mustAskBefore: [], doneWhen: [] }

test('a greyed seat round-trips its link, waitsFor, and movedTo', () => {
  const parsed = parseSeatMarkdown('research', serializeExistingSeat({ name: 'Research', grokBotUrl: '', elsewhereUrl: 'grokbot://app/v1/agent?id=r1', waitsFor: 'grok-bot', movedTo: 'org-abcd2345', reportsTo: 'you', ...empty }))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  if (!parsed.ok) return
  assert.equal(parsed.seat.elsewhereUrl, 'grokbot://app/v1/agent?id=r1')
  assert.equal(parsed.seat.waitsFor, 'grok-bot')
  assert.equal(parsed.seat.movedTo, 'org-abcd2345')
  assert.equal(isGreyed(parsed.seat), true)
  const again = parseSeatMarkdown('research', parsed.seat.source)
  assert.ok(again.ok)
  if (again.ok) assert.equal(again.seat.elsewhereUrl, 'grokbot://app/v1/agent?id=r1', 'the fields survive a rewrite')
})

test('a seat with both links is not greyed, and grokSeats drops only greyed ones', () => {
  assert.equal(isGreyed({ elsewhereUrl: 'grokbot://app/v1/agent?id=r1', grokBotUrl: 'grokbot://app/v1/agent?id=r1' }), false)
  const greyed = parseSeatMarkdown('research', serializeExistingSeat({ name: 'Research', grokBotUrl: '', elsewhereUrl: 'grokbot://app/v1/agent?id=r1', reportsTo: 'you', ...empty }))
  const plain = parseSeatMarkdown('writer', serializeExistingSeat({ name: 'Writer', grokBotUrl: 'grokbot://app/v1/agent?id=w1', reportsTo: 'you', ...empty }))
  assert.ok(greyed.ok && plain.ok)
  if (!greyed.ok || !plain.ok) return
  assert.deepEqual(grokSeats([greyed.seat, plain.seat]).map((seat) => seat.slug), ['writer'])
})
