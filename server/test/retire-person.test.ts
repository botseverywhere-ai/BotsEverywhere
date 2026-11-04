import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bundleFromState, cardUnchanged, parseSeatMarkdown, serializeExistingSeat, serializeSeat, validateBundle } from '../src/org-files.ts'
import { createHiredSeat, createOrgFiles, readOrgDir } from '../src/template-server.ts'

test('a person can be retired while another person stays in the org', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-retire-'))
  try {
    const made = createOrgFiles(dir, 'North office', 'Ada')
    assert.equal(made.ok, true)
    if (!made.ok) return
    const root = join(dir, made.slug)
    const hired = createHiredSeat(root, made.slug, { name: 'Sam', kind: 'human', slug: 'sam', reportsTo: 'you', owns: ['Ops'], may: ['Read'], mustAskBefore: ['Pay'], doneWhen: ['Done'] })
    assert.equal(hired.ok, true)
    const read = readOrgDir(root, made.slug)
    assert.equal(read.ok, true)
    if (!read.ok) return
    const retire = (slug: string) => read.bundle.seats.map((seat) => (seat.slug === slug ? { ...seat, status: 'retired' as const, retiredAt: '2026-10-19T17:00:00.000Z' } : seat))

    const sam = retire('sam').find((seat) => seat.slug === 'sam')!
    const parsed = parseSeatMarkdown('sam', serializeSeat(sam))
    assert.equal(parsed.ok, true, 'a retired person seat file reads back')
    assert.deepEqual(validateBundle(bundleFromState(made.slug, read.bundle.org, retire('sam'), read.bundle.work)), [])

    const owner = read.bundle.seats.find((seat) => seat.kind === 'human' && seat.slug !== 'sam')!
    const none = read.bundle.seats.map((seat) => (seat.kind === 'human' ? { ...seat, status: 'retired' as const } : seat))
    assert.ok(validateBundle(bundleFromState(made.slug, read.bundle.org, none, read.bundle.work)).some((error) => /keep at least one person/.test(error)), `retiring ${owner.slug} too leaves no one`)
    assert.match(readFileSync(join(root, 'seats', 'sam.md'), 'utf8'), /kind: human/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a save checks only the cards that are new or changed', () => {
  const card = { status: 'active' as const, owns: ['Rows'], may: [], mustAskBefore: [], doneWhen: [] }
  assert.equal(cardUnchanged(card, { ...card }), true, 'an imported card left as it is passes')
  assert.equal(cardUnchanged({ ...card, may: ['Read'] }, card), false, 'an edited card is checked')
  assert.equal(cardUnchanged(card, undefined), false, 'a new seat is checked')
  assert.equal(cardUnchanged(card, { ...card, status: 'retired' }), false, 'a seat brought back is checked')
})

test('a retired imported bot stays retired in its file', () => {
  const source = serializeExistingSeat({ name: 'Inbox Bot', grokBotUrl: 'grokbot://app/v1/agent?id=inbox', reportsTo: 'you', owns: [], may: [], mustAskBefore: [], doneWhen: [] })
  const read = parseSeatMarkdown('inbox-bot', source)
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.seat.status, 'active')
  assert.doesNotMatch(source, /^status:/m, 'an active imported bot keeps the short file')
  const retired = parseSeatMarkdown('inbox-bot', serializeSeat({ ...read.seat, status: 'retired', retiredAt: '2026-10-19T18:11:46.235Z' }))
  assert.equal(retired.ok, true)
  if (!retired.ok) return
  assert.equal(retired.seat.status, 'retired')
  assert.equal(retired.seat.retiredAt, '2026-10-19T18:11:46.235Z')
  assert.equal(retired.seat.seatOrigin, 'existing')
})
