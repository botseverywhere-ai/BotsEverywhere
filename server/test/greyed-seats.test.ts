import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runConnectorCycle } from '../src/connector-cycle.ts'
import { GROK_DATA_FILE, TODO_FILE } from '../src/connector-files.ts'
import { canDelete } from '../src/grok-requests.ts'
import { grokSeats, isGreyed, parseSeatMarkdown, serializeExistingSeat } from '../src/org-files.ts'
import { createExistingBot, createOrgFiles, syncStatus } from '../src/template-server.ts'

const empty = { owns: [], may: [], mustAskBefore: [], doneWhen: [] }
const link = (id: string) => `grokbot://app/v1/agent?id=${id}`

/** Two organizations: A runs Security; B holds a greyed Security seat for the same bot. */
export function greyedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'be-greyed-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const a = createOrgFiles(orgs, 'BotsEverywhere', 'You')
  const b = createOrgFiles(orgs, 'Alicante Tech Vibes', 'You')
  assert.ok(a.ok && b.ok)
  assert.ok(createExistingBot(join(orgs, a.slug), a.slug, { name: 'Security', grokBotUrl: link('s1'), reportsTo: 'you', allowEmptyCard: true }).ok)
  assert.ok(createExistingBot(join(orgs, b.slug), b.slug, { name: 'Security', grokBotUrl: '', reportsTo: 'you', allowEmptyCard: true }).ok)
  const seat = join(orgs, b.slug, 'seats', 'security.md')
  writeFileSync(seat, readFileSync(seat, 'utf8').replace(/^reportsTo: .*$/m, (line) => `${line}\nelsewhereUrl: "${link('s1')}"`))
  return { orgs, a: a.slug, b: b.slug, done: () => rmSync(dir, { recursive: true, force: true }) }
}

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

test('a greyed seat gets no block, no snapshot row, and no sync match', () => {
  const { orgs, b, done } = greyedProject()
  try {
    writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', bots: [{ id: 's1', name: 'Security', grokBotUrl: link('s1'), description: 'Security works.', routinesVisible: false }], skills: [] }))
    const ran = runConnectorCycle(orgs, 'acn8')
    assert.ok(ran.ok)
    const todo = JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as { items: { description?: string }[] }
    assert.equal(todo.items.some((item) => (item.description ?? '').includes(`=== BotsEverywhere acn8 ${b} ===`)), false, 'no block for the organization where it is greyed')
    const snapshot = JSON.parse(readFileSync(join(orgs, b, 'grok', 'snapshot.json'), 'utf8')) as { bots: { name: string }[] }
    assert.equal(snapshot.bots.some((bot) => bot.name === 'Security'), false)
    const status = syncStatus(join(orgs, b), b, orgs)
    assert.ok(status.ok)
    if (status.ok) assert.equal(JSON.stringify(status.status.plan ?? {}).includes('Security'), false)
  } finally {
    done()
  }
})

test('the sync status names the organizations of a greyed bot by their current name, and the main bot', () => {
  const { orgs, a, b, done } = greyedProject()
  try {
    const orgFile = join(orgs, a, 'org.md')
    writeFileSync(orgFile, readFileSync(orgFile, 'utf8').replace(/^name: .*$/m, 'name: Renamed Org'))
    writeFileSync(join(orgs, 'project.json'), JSON.stringify({ id: 'acn8', mainBot: 'g1' }))
    const status = syncStatus(join(orgs, b), b, orgs)
    assert.ok(status.ok)
    if (!status.ok) return
    assert.deepEqual(status.status.elsewhere, { security: ['Renamed Org'] })
    assert.equal(status.status.mainBot, 'g1')
  } finally {
    done()
  }
})

test("a moved bot's retired seat offers no Delete in Grok Bot", () => {
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: link('s1'), movedTo: 'org-abcd2345' }), false)
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: link('s1') }), true)
})
