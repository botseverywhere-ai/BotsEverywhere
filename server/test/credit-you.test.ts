import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { clearHandledUpdates, createExistingBot, createHiredSeat, createOrgFiles, readOrgDir, readRequests, requestGrokBot, requestGrokUpdate, setSeatManager, updateSeatProfile } from '../src/template-server.ts'

const card = { owns: ['Owns it'], may: ['May do it'], mustAskBefore: ['Ask first'], doneWhen: ['Done'] }

test('a change is credited to You, even when another person comes first by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-credit-'))
  try {
    const orgs = join(dir, 'orgs')
    mkdirSync(orgs)
    const made = createOrgFiles(orgs, 'Desk', 'You')
    assert.ok(made.ok)
    const root = join(orgs, made.slug)
    // angel sorts before you, which is how Grok Bot was told Angel made a change.
    assert.ok(createHiredSeat(root, made.slug, { name: 'Angel Rodriguez', kind: 'human', slug: 'angel', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', ...card }).ok)
    const brand = createExistingBot(root, made.slug, { name: 'Brand Bot', grokBotUrl: 'grokbot://app/v1/agent?id=brand', reportsTo: 'you', allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-26T10:00:00.000Z' })
    assert.ok(brand.ok)
    assert.ok(createHiredSeat(root, made.slug, { name: 'New Bot', kind: 'bot', slug: 'new-bot', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', ...card }).ok)
    assert.ok(requestGrokBot(root, made.slug, 'new-bot').ok)
    assert.ok(updateSeatProfile(root, made.slug, brand.slug, { skills: [{ name: 'Lead sort' }] }).ok)
    assert.ok(requestGrokUpdate(root, made.slug, brand.slug).ok)
    assert.ok(setSeatManager(root, made.slug, brand.slug, 'angel').ok)
    const waiting = readRequests(root).requests.find((item) => item.seat === brand.slug)
    assert.ok(waiting)
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-26T13:15:00.000Z', bots: [], processes: [], updated: [{ seat: brand.slug, requestedAt: waiting.requestedAt }] }))
    clearHandledUpdates(root, made.slug)

    const read = readOrgDir(root, made.slug)
    assert.ok(read.ok)
    const byPeople = read.bundle.activity.filter((event) => event.actorType === 'human')
    for (const summary of [
      'Asked the Connector to create New Bot in Grok Bot',
      'Asked the Connector to update Brand Bot in Grok Bot',
      'Moved Brand Bot under Angel Rodriguez',
      'Updated in Grok Bot: Brand Bot',
    ]) {
      const event = byPeople.find((item) => item.summary === summary)
      assert.ok(event, `logged: ${summary}`)
      assert.equal(event.actorSeatId, 'you', `${summary} is credited to You`)
    }
    assert.deepEqual(byPeople.filter((event) => event.actorSeatId !== 'you').map((event) => event.summary), [], 'nothing is credited to Angel')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no change in the writer is credited to the first person in name order', () => {
  const source = readFileSync(new URL('../src/template-server.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /bundle\.seats\.find\(\((seat|item)\) => \1\.kind === 'human'/, 'use managerSeat: You first, then the first person')
})
