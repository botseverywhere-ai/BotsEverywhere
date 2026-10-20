import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { REQUESTS_PATH, addRequest, canRequest, dropRequests, fulfilledSeats, parseRequests, serializeRequests, type GrokRequest } from '../src/grok-requests.ts'
import { createOrgFiles, readRequests, startTemplateServer } from '../src/template-server.ts'

const AT = '2026-10-18T10:40:00.000Z'
const json = { 'content-type': 'application/json' }

function request(seat: string, extra: Partial<GrokRequest> = {}): GrokRequest {
  return { seat, name: seat, seatFile: `/o/seats/${seat}.md`, prompt: '', requestedAt: AT, ...extra }
}

test('the requests file reads a BOM, CRLF, and a bad file without throwing', () => {
  const text = serializeRequests([request('metric-change-bot', { name: 'Metric Change Bot' })])
  assert.match(text, /^\{\n {2}"requests": \[/)
  assert.ok(text.endsWith('\n'))
  const parsed = parseRequests(`﻿${text.replace(/\n/g, '\r\n')}`)
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.requests, [request('metric-change-bot', { name: 'Metric Change Bot' })])
  assert.deepEqual(parseRequests('not json'), { ok: false, error: 'grok/requests.json is not JSON.' })
  assert.deepEqual(parseRequests('{"requests": 4}'), { ok: true, requests: [] })
  const mixed = parseRequests(JSON.stringify({ requests: [{ seat: 'Bad Slug' }, { seat: 'ok-bot', name: 'Ok Bot', requestedAt: AT }, 7] }))
  assert.equal(mixed.ok, true)
  if (mixed.ok) assert.deepEqual(mixed.requests.map((item) => item.seat), ['ok-bot'], 'a bad entry is skipped')
})

test('a request replaces an older one for the same seat and drops when fulfilled', () => {
  const list = addRequest([request('a'), request('b')], request('a', { requestedAt: '2026-10-19T00:00:00.000Z' }))
  assert.deepEqual(list.map((item) => [item.seat, item.requestedAt]), [['b', AT], ['a', '2026-10-19T00:00:00.000Z']])
  assert.deepEqual(dropRequests(list, new Set(['a'])).map((item) => item.seat), ['b'])
  const seen = fulfilledSeats({
    rows: [
      { kind: 'updated', name: 'A', slug: 'a', renamed: false, changes: [], patch: { grokSync: 'synced' } },
      { kind: 'unchanged', name: 'B', slug: 'b' },
      { kind: 'missing', name: 'C', slug: 'c', write: false, patch: { grokSync: 'missing' } },
    ],
  })
  assert.deepEqual([...seen].sort(), ['a', 'b'], 'a seat the snapshot matched is in Grok Bot')
})

test('only an active bot that Grok Bot does not have can be requested', () => {
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokSync: 'missing', grokBotUrl: 'grokbot://x' }), false, 'a link means the bot exists, so asking again would make a duplicate')
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokSync: 'missing' }), true, 'missing with no link can be created')
  assert.equal(canRequest({ kind: 'bot', status: 'active' }), true, 'nothing known yet')
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokSync: 'synced' }), false)
  assert.equal(canRequest({ kind: 'bot', status: 'active', grokBotUrl: 'grokbot://x' }), false)
  assert.equal(canRequest({ kind: 'bot', status: 'retired', grokSync: 'missing' }), false)
  assert.equal(canRequest({ kind: 'human', status: 'active' }), false)
})

test('the Connector reads the requests file, creates each bot, and never edits it', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/home/me/orgs' })
  assert.match(prompt, /If <org>\/grok\/requests\.json exists, read it/)
  assert.match(prompt, /create that bot in Grok Bot named exactly as "name"/)
  assert.match(prompt, /When "prompt" is set, use it as the bot's prompt\./)
  assert.match(prompt, /Owns, May, Needs approval, and Done when/)
  assert.match(prompt, /That bot belongs to this organization\./)
  assert.match(prompt, /Never edit org\.md, seats\/, processes\/, work-chart\.md, grok\/requests\.json, or project\.json/)
})

function writeBot(root: string, slug: string, title: string, extra = '') {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ${slug}\n${extra}---\n\n## Owns\nFlagged rows\n\n## May\nRead the table\n\n## Needs approval\nPaging people\n\n## Done when\nEach row is listed\n`, 'utf8')
}

test('the writer records a request, names the prompt file, and a sync clears it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-requests-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(join(dir, 'directory'))
  writeFileSync(join(dir, 'directory', 'metric-change-bot.md'), '---\nname: Metric Change Bot\n---\n\nYou flag rows.\n', 'utf8')
  mkdirSync(orgs)
  const created = createOrgFiles(orgs, 'Desk', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(orgs, created.slug)
  writeBot(root, 'metric-change-bot', 'Metric Change Bot', 'grokSync: missing\ngrokMissingSince: "2026-10-17T22:12:17.000Z"\n')
  writeBot(root, 'linked-bot', 'Linked Bot', 'grokSync: synced\n')
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api/orgs/${created.slug}`
  try {
    const made = await fetch(`${base}/grok/requests`, { method: 'POST', headers: json, body: JSON.stringify({ seat: 'metric-change-bot' }) })
    assert.equal(made.status, 200)
    const file = JSON.parse(readFileSync(join(root, REQUESTS_PATH), 'utf8')) as { requests: GrokRequest[] }
    assert.equal(file.requests.length, 1)
    assert.equal(file.requests[0]!.name, 'Metric Change Bot')
    assert.equal(file.requests[0]!.seatFile, join(root, 'seats', 'metric-change-bot.md'))
    assert.equal(file.requests[0]!.prompt, 'You flag rows.', 'the directory prompt is copied in, since the Connector never reads outside the orgs folder')
    assert.match(readFileSync(join(root, 'seats', 'metric-change-bot.md'), 'utf8'), /grokSync: missing/, 'the seat file is untouched')

    const status = (await (await fetch(`${base}/sync`)).json()) as { requests: GrokRequest[] }
    assert.deepEqual(status.requests.map((item) => item.seat), ['metric-change-bot'], 'the sync status carries the requests')

    assert.equal((await fetch(`${base}/grok/requests`, { method: 'POST', headers: json, body: JSON.stringify({ seat: 'linked-bot' }) })).status, 422, 'a bot already in Grok Bot is refused')
    assert.equal((await fetch(`${base}/grok/requests`, { method: 'POST', headers: json, body: JSON.stringify({ seat: 'nobody' }) })).status, 422)
    assert.equal((await fetch(`${base}/grok/requests`, { method: 'POST', headers: json, body: 'nope' })).status, 422)
    assert.equal((await fetch(`${base}/grok/requests`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ seat: 'metric-change-bot' }) })).status, 415, 'a simple cross-site POST is refused')
    assert.equal((await fetch(`${base}/grok/requests`, { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body: JSON.stringify({ seat: 'metric-change-bot' }) })).status, 403, 'another site is refused')

    writeFileSync(join(root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-18T11:00:00Z', bots: [{ name: 'Metric Change Bot', grokBotUrl: 'grokbot://app/v1/agent?id=new' }, { name: 'Linked Bot' }] }), 'utf8')
    const fresh = (await (await fetch(`${base}/sync`)).json()) as { snapshot: { stamp: string } }
    const applied = await fetch(`${base}/sync/apply`, { method: 'POST', body: JSON.stringify({ source: 'file', stamp: fresh.snapshot.stamp }) })
    assert.equal(applied.status, 200)
    assert.deepEqual(readRequests(root).requests, [], 'the sync that found the bot clears its request')
    assert.match(readFileSync(join(root, 'seats', 'metric-change-bot.md'), 'utf8'), /grokSync: synced/)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bad requests file does not break the sync status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-requests-bad-'))
  const created = createOrgFiles(dir, 'Desk', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  mkdirSync(join(root, 'grok'), { recursive: true })
  writeFileSync(join(root, REQUESTS_PATH), '{broken', 'utf8')
  assert.deepEqual(readRequests(root), { requests: [], error: 'grok/requests.json is not JSON.' })
  assert.equal(existsSync(join(root, REQUESTS_PATH)), true)
  rmSync(dir, { recursive: true, force: true })
})

test('a bot not in Grok Bot gets Create in Grok Bot in the seat panel, then says it is waiting', async () => {
  const { grokRequestLine } = await import('../../src/components/sync-copy.ts')
  assert.equal(grokRequestLine('2026-10-18T10:40:00.000Z'), `Asked ${(await import('../src/bot-metrics.ts')).formatShortDate('2026-10-18T10:40:00.000Z')}. The Connector creates it on its next run and links it here by itself.`)
  const drawer = readFileSync(new URL('../../src/components/SeatDrawer.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(drawer, /Create in Grok Bot/)
  assert.match(drawer, /grokSyncClass\(seat\) !== 'is-in-grok'/, 'only a bot Grok Bot does not have')
  assert.match(drawer, /<p className="grok-create-state be-connecting"><i className="be-pulse" aria-hidden="true" \/><strong>Connecting to Grok Bot<\/strong><\/p>\s+<p className="auth-note">\{grokRequestLine\(grokRequestedAt\)\}<\/p>/, 'a requested bot pulses as connecting under its Not in Grok Bot line, with the explanation below')
  assert.match(drawer, /grokSyncLine\(seat\)\.toLowerCase\(\) === grokSyncTag\(seat\)\.toLowerCase\(\) \? null/, 'the status line is not repeated when it only echoes the tag')
  assert.match(drawer, /<dd>\{grokRequestedAt \? 'connecting' : grokSyncLine\(seat\)\}<\/dd>/)
  assert.match(workspace, /\/api\/orgs\/\$\{bundle\.id\}\/grok\/requests/)
  assert.match(workspace, /onCreateInGrok=\{editable && chartSeat\.type === 'bot'/)
  assert.match(workspace, /grokRequestedAt=\{sync\?\.requests\?\.find/)
})
