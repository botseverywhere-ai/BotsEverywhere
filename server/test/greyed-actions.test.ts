import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseBotsFile } from '../src/bots-file.ts'
import { readMainBot } from '../src/project.ts'
import { createExistingBot, createOrgFiles, importBotsFile, markMainBot, moveBotHere, publishCopy, readRequests, removeGreyedSeat, requestGrokBot, setSeatManagers, startTemplateServer } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`

/** A runs Inner Loop (Security under it). B imported Inner Loop greyed and UX, which waits for it under You. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-greyed-actions-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const a = createOrgFiles(orgs, 'BotsEverywhere', 'You')
  const b = createOrgFiles(orgs, 'Alicante Tech Vibes', 'You')
  assert.ok(a.ok && b.ok)
  const rootA = join(orgs, a.slug)
  const rootB = join(orgs, b.slug)
  assert.ok(createExistingBot(rootA, a.slug, { name: 'Inner Loop', grokBotUrl: link('i1'), reportsTo: 'you', allowEmptyCard: true }).ok)
  assert.ok(createExistingBot(rootA, a.slug, { name: 'Security', grokBotUrl: link('s1'), reportsTo: 'inner-loop', allowEmptyCard: true }).ok)
  const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Inner Loop', grokBotUrl: link('i1') }, { name: 'UX', grokBotUrl: link('u1'), reportsTo: 'Inner Loop' }, { name: 'Research', grokBotUrl: link('s1') }] }))
  assert.ok(file.ok)
  if (file.ok) importBotsFile(rootB, b.slug, file.rows)
  const seat = (root: string, slug: string) => readFileSync(join(root, 'seats', `${slug}.md`), 'utf8')
  return { orgs, a: a.slug, b: b.slug, rootA, rootB, seat, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('Move it here retires the bot elsewhere, re-points its reports there, and pulls its waiting reports under it here', () => {
  const { orgs, a, b, rootA, rootB, seat, done } = project()
  try {
    assert.deepEqual(moveBotHere(orgs, b, 'inner-loop'), { ok: true })
    assert.match(seat(rootA, 'inner-loop'), /^status: retired$/m)
    assert.match(seat(rootA, 'inner-loop'), new RegExp(`^movedTo: "?${b}"?$`, 'm'))
    assert.match(seat(rootA, 'security'), /^reportsTo: you$/m, 'its reports there go under its old manager there')
    assert.match(seat(rootB, 'inner-loop'), /id=i1/)
    assert.doesNotMatch(seat(rootB, 'inner-loop'), /^elsewhereUrl:/m)
    assert.match(seat(rootB, 'ux'), /^reportsTo: inner-loop$/m)
    assert.doesNotMatch(seat(rootB, 'ux'), /^waitsFor:/m)
    assert.ok(a)
  } finally {
    done()
  }
})

test('a seat the owner moved stays where the owner put it', () => {
  const { orgs, b, rootB, seat, done } = project()
  try {
    assert.ok(createExistingBot(rootB, b, { name: 'Writer', grokBotUrl: link('w1'), reportsTo: 'you', allowEmptyCard: true }).ok)
    assert.ok(setSeatManagers(rootB, b, 'ux', 'writer', []).ok)
    assert.doesNotMatch(seat(rootB, 'ux'), /^waitsFor:/m, 'moving it by hand ends the wait')
    assert.deepEqual(moveBotHere(orgs, b, 'inner-loop'), { ok: true })
    assert.match(seat(rootB, 'ux'), /^reportsTo: writer$/m)
  } finally {
    done()
  }
})

test('Rename and publish renames the seat and asks the Connector to create it', () => {
  const { orgs, b, rootB, seat, done } = project()
  try {
    assert.deepEqual(publishCopy(orgs, b, 'research', 'Research - Alicante Tech Vibes'), { ok: true })
    assert.equal(readRequests(rootB).requests[0]?.name, 'Research - Alicante Tech Vibes')
    assert.doesNotMatch(seat(rootB, 'research'), /^elsewhereUrl:/m)
    assert.match(seat(rootB, 'research'), /^name: "?Research - Alicante Tech Vibes"?$/m)
  } finally {
    done()
  }
})

test("Rename and publish refuses the original's name and an empty name, and a greyed seat is never sent to Create in Grok Bot", () => {
  const { orgs, b, rootB, done } = project()
  try {
    assert.deepEqual(publishCopy(orgs, b, 'research', '  '), { ok: false, errors: ['Give the new bot a name.'] })
    assert.equal(publishCopy(orgs, b, 'research', 'research').ok, false, 'the same name would link the original bot')
    assert.equal(requestGrokBot(rootB, b, 'research', orgs).ok, false)
    assert.equal(readRequests(rootB).requests.length, 0)
  } finally {
    done()
  }
})

test('Remove deletes only the greyed seat', () => {
  const { orgs, b, rootA, rootB, seat, done } = project()
  try {
    assert.deepEqual(removeGreyedSeat(orgs, b, 'inner-loop'), { ok: true })
    assert.equal(existsSync(join(rootB, 'seats', 'inner-loop.md')), false)
    assert.doesNotMatch(readFileSync(join(rootB, 'org.md'), 'utf8'), /^- inner-loop\b/m)
    assert.doesNotMatch(seat(rootB, 'ux'), /^waitsFor:/m)
    assert.doesNotMatch(seat(rootA, 'inner-loop'), /^status: retired$/m, 'the bot stays where it works')
  } finally {
    done()
  }
})

test("It's my main bot saves the id and activates its greyed seats everywhere", () => {
  const { orgs, b, rootB, seat, done } = project()
  try {
    const c = createOrgFiles(orgs, 'techiewithmiguel', 'You')
    assert.ok(c.ok)
    if (!c.ok) return
    const rootC = join(orgs, c.slug)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Inner Loop', grokBotUrl: link('i1') }] }))
    assert.ok(file.ok)
    if (file.ok) importBotsFile(rootC, c.slug, file.rows)
    assert.deepEqual(markMainBot(orgs, b, 'inner-loop'), { ok: true })
    assert.equal(readMainBot(orgs), 'i1')
    assert.match(seat(rootB, 'inner-loop'), /id=i1/)
    assert.match(seat(rootC, 'inner-loop'), /id=i1/)
    assert.match(seat(rootB, 'ux'), /^reportsTo: inner-loop$/m)
  } finally {
    done()
  }
})

test('the routes: publish takes JSON, DELETE removes only a greyed seat, and another site is refused', async () => {
  const { orgs, b, rootB, done } = project()
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api/orgs/${b}/seats`
  try {
    assert.equal((await fetch(`${base}/inner-loop/move-here`, { method: 'POST', headers: { origin: 'https://example.com' } })).status, 403)
    const published = await fetch(`${base}/research/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Research - Alicante Tech Vibes' }) })
    assert.equal(published.status, 200, await published.clone().text())
    assert.equal((await fetch(`${base}/research`, { method: 'DELETE' })).status, 422, 'no longer greyed')
    assert.equal((await fetch(`${base}/inner-loop/main-bot`, { method: 'POST' })).status, 200)
    assert.match(readFileSync(join(rootB, 'seats', 'inner-loop.md'), 'utf8'), /id=i1/)
  } finally {
    await started.close()
    done()
  }
})

test('a second click is refused and changes nothing', () => {
  const { orgs, b, done } = project()
  try {
    assert.deepEqual(moveBotHere(orgs, b, 'inner-loop'), { ok: true })
    assert.deepEqual(moveBotHere(orgs, b, 'inner-loop'), { ok: false, errors: ['That seat is not greyed.'] })
    assert.deepEqual(removeGreyedSeat(orgs, b, 'inner-loop'), { ok: false, errors: ['That seat is not greyed.'] })
  } finally {
    done()
  }
})
