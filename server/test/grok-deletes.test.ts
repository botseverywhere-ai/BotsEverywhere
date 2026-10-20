import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { recordConnectorRun } from '../src/connector-log.ts'
import { REQUESTS_PATH, canDelete, deleteFor, parseRequests, serializeRequests, stillInGrok, type GrokDelete } from '../src/grok-requests.ts'
import { parseLogMarkdown } from '../src/org-markdown.ts'
import { parseSeatMarkdown, type FileActivity } from '../src/org-files.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, readRequests, requestGrokDelete, startTemplateServer } from '../src/template-server.ts'

const AT = '2026-10-20T13:03:00.000Z'
const INBOX = 'grokbot://app/v1/agent?id=inbox'
const json = { 'content-type': 'application/json' }

function removal(extra: Partial<GrokDelete> = {}): GrokDelete {
  return { grokBotUrl: INBOX, name: 'Inbox Bot', seats: ['inbox-bot'], requestedAt: AT, ...extra }
}

test('deletes sit under their own key, and a file of creates reads and writes as before', () => {
  assert.doesNotMatch(serializeRequests([]), /deletes/, 'no deletes, no key')
  const text = serializeRequests([], [removal()])
  assert.match(text, /"deletes": \[/)
  const parsed = parseRequests(`﻿${text.replace(/\n/g, '\r\n')}`)
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.deletes, [removal()])
  const old = parseRequests(JSON.stringify({ requests: [{ seat: 'a-bot', name: 'A Bot' }] }))
  assert.equal(old.ok && old.deletes.length, 0)
  const mixed = parseRequests(JSON.stringify({ requests: [], deletes: [{ name: 'No Link' }, { grokBotUrl: INBOX, seats: ['inbox-bot', 'Bad Slug', 4] }, 7] }))
  assert.equal(mixed.ok, true)
  if (mixed.ok) assert.deepEqual(mixed.deletes, [{ grokBotUrl: INBOX, name: INBOX, seats: ['inbox-bot'], requestedAt: '' }], 'an entry without a link is skipped')
})

test('only a retired bot with a link and not yet deleted can be deleted in Grok Bot', () => {
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: INBOX }), true)
  assert.equal(canDelete({ kind: 'bot', status: 'active', grokBotUrl: INBOX }), false, 'retire it first')
  assert.equal(canDelete({ kind: 'bot', status: 'retired' }), false, 'no link, no safe way to find it')
  assert.equal(canDelete({ kind: 'human', status: 'retired', grokBotUrl: INBOX }), false)
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: INBOX, grokDeletedAt: AT }), false, 'already gone')
  assert.equal(deleteFor([removal()], { slug: 'inbox-bot-2', grokBotUrl: INBOX })?.grokBotUrl, INBOX, 'a seat with the same link shares the request')
  assert.equal(deleteFor([removal()], { slug: 'inbox-bot', grokBotUrl: '' })?.grokBotUrl, INBOX)
  assert.equal(deleteFor([removal()], { slug: 'other-bot', grokBotUrl: '' }), undefined)
})

test('a bot counts as still in Grok Bot by its link, or by its name when the entry has no link', () => {
  assert.equal(stillInGrok(removal(), [{ name: 'Other', grokBotUrl: INBOX }]), true)
  assert.equal(stillInGrok(removal(), [{ name: 'Inbox Bot', grokBotUrl: '' }]), true, 'same name, no link: still there')
  assert.equal(stillInGrok(removal(), [{ name: 'Inbox Bot · Desk', grokBotUrl: '' }]), true)
  assert.equal(stillInGrok(removal(), [{ name: 'Inbox Bot', grokBotUrl: 'grokbot://app/v1/agent?id=other' }]), false, 'a different bot with the same name is not this one')
  assert.equal(stillInGrok(removal(), []), false)
})

test('the Connector deletes by link only and never deletes itself', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/home/me/orgs' })
  assert.match(prompt, /For each entry in "deletes", delete the bot in Grok Bot whose link is exactly "grokBotUrl"/)
  assert.match(prompt, /Never delete a bot by its name alone, and never delete yourself\./)
})

function seat(root: string, slug: string, title: string, extra: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-deletes-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const make = (name: string) => {
    const made = createOrgFiles(orgs, name, 'Ada')
    if (!made.ok) throw new Error('no org')
    return made.slug
  }
  return { orgs, make, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const retired = (link: string) => `status: retired\nretiredAt: "${AT}"\ngrokBotUrl: "${link}"\n`

test('the writer asks for a delete, warns about another organization, and can cancel it', async () => {
  const { orgs, make, done } = project()
  const desk = make('Desk')
  const ledger = make('Ledger')
  const root = join(orgs, desk)
  seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
  seat(root, 'inbox-bot-2', 'Inbox Bot', retired(INBOX))
  seat(root, 'live-bot', 'Live Bot', `status: active\ngrokBotUrl: "grokbot://live"\n`)
  seat(join(orgs, ledger), 'inbox-bot', 'Inbox Bot', `status: active\ngrokBotUrl: "${INBOX}"\n`)
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${started.port}/api/orgs/${desk}`
  try {
    const check = (await (await fetch(`${base}/grok/deletes?seat=inbox-bot`)).json()) as { activeIn: string[] }
    assert.deepEqual(check.activeIn, ['Ledger'], 'the warning names the organization that still uses it')

    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'POST', headers: json, body: JSON.stringify({ seat: 'live-bot' }) })).status, 422, 'an active bot is refused')
    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ seat: 'inbox-bot' }) })).status, 415)
    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'POST', headers: { ...json, origin: 'https://evil.example' }, body: JSON.stringify({ seat: 'inbox-bot' }) })).status, 403)

    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'POST', headers: json, body: JSON.stringify({ seat: 'inbox-bot-2' }) })).status, 200)
    const file = readRequests(root)
    assert.equal(file.deletes.length, 1)
    assert.deepEqual(file.deletes[0]!.seats, ['inbox-bot', 'inbox-bot-2'], 'one request per link, for every retired seat with it')
    const status = (await (await fetch(`${base}/sync`)).json()) as { deletes: GrokDelete[] }
    assert.equal(status.deletes.length, 1, 'the sync status carries the deletes')

    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'DELETE', headers: json, body: JSON.stringify({ seat: 'inbox-bot' }) })).status, 200)
    assert.deepEqual(readRequests(root).deletes, [])
    assert.equal((await fetch(`${base}/grok/deletes`, { method: 'DELETE', headers: json, body: JSON.stringify({ seat: 'inbox-bot' }) })).status, 422, 'nothing left to cancel')
    const summaries = readdirSync(join(root, 'log')).map((name) => readFileSync(join(root, 'log', name), 'utf8')).join('\n')
    assert.match(summaries, /Asked the Connector to delete Inbox Bot in Grok Bot/)
    assert.match(summaries, /Cancelled the request to delete Inbox Bot in Grok Bot/)
  } finally {
    await started.close()
    done()
  }
})

/** One Connector run at a file time: each org's snapshot, then connector.json. */
function run(orgs: string, at: Date, perOrg: Record<string, { name: string; grokBotUrl?: string }[]>, unassigned: { name: string; grokBotUrl?: string }[] = []) {
  for (const [slug, bots] of Object.entries(perOrg)) {
    mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
    const path = join(orgs, slug, 'grok', 'snapshot.json')
    writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), bots, processes: [] }))
    utimesSync(path, at, at)
  }
  const path = join(orgs, CONNECTOR_FILE)
  writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), unassigned }))
  utimesSync(path, at, at)
}

function events(root: string): FileActivity[] {
  return readdirSync(join(root, 'log')).flatMap((name) => {
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return []
    const parsed = parseLogMarkdown(readFileSync(join(root, 'log', name), 'utf8'), name)
    return parsed.ok ? [parsed.event] : []
  })
}

const deletedAt = (root: string, slug: string) => {
  const parsed = parseSeatMarkdown(slug, readFileSync(join(root, 'seats', `${slug}.md`), 'utf8'))
  return parsed.ok ? parsed.seat.grokDeletedAt ?? '' : 'bad'
}

test('a delete clears only on a newer run that no longer reports the bot anywhere', () => {
  const { orgs, make, done } = project()
  try {
    const desk = make('Desk')
    const ledger = make('Ledger')
    const root = join(orgs, desk)
    seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
    seat(root, 'inbox-bot-2', 'Inbox Bot', retired(INBOX))
    const inbox = { name: 'Inbox Bot', grokBotUrl: INBOX }
    const minute = (n: number) => new Date(Date.now() + n * 60_000)

    run(orgs, minute(-10), { [desk]: [inbox], [ledger]: [] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(requestGrokDelete(root, desk, 'inbox-bot').ok, true)

    run(orgs, minute(-5), { [desk]: [], [ledger]: [] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRequests(root).deletes.length, 1, 'a run from before the request does not count')

    run(orgs, minute(1), { [desk]: [], [ledger]: [inbox] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRequests(root).deletes.length, 1, 'still in another organization')

    run(orgs, minute(2), { [desk]: [], [ledger]: [] }, [{ name: 'Inbox Bot' }])
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRequests(root).deletes.length, 1, 'the same name with no link counts as still there')

    run(orgs, minute(3), { [desk]: [], [ledger]: [] })
    writeFileSync(join(orgs, ledger, 'grok', 'snapshot.json'), '{broken', 'utf8')
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRequests(root).deletes.length, 1, 'an unreadable snapshot counts as still there')

    const last = minute(4)
    run(orgs, last, { [desk]: [], [ledger]: [] })
    recordConnectorRun(orgs, 'Connector')
    assert.deepEqual(readRequests(root).deletes, [], 'gone everywhere: cleared')
    assert.ok(Math.abs(Date.parse(deletedAt(root, 'inbox-bot')) - last.getTime()) < 2000, 'the seat records the run')
    assert.equal(deletedAt(root, 'inbox-bot'), deletedAt(root, 'inbox-bot-2'), 'both seats with the link are marked')
    const log = events(root)
    assert.equal(log.filter((item) => item.kind === 'deleted').length, 1)
    assert.match(log.find((item) => item.kind === 'deleted')!.summary, /Deleted in Grok Bot: Inbox Bot/)
    const after = parseSeatMarkdown('inbox-bot', readFileSync(join(root, 'seats', 'inbox-bot.md'), 'utf8'))
    assert.equal(after.ok && after.seat.status, 'retired', 'the seat stays retired')
    assert.equal(after.ok && canDelete(after.seat), false, 'no second delete')
  } finally {
    done()
  }
})

test('the run that confirms a delete logs Deleted, not also Bot left', () => {
  const { orgs, make, done } = project()
  try {
    const desk = make('Desk')
    const root = join(orgs, desk)
    seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
    run(orgs, new Date(Date.now() - 60_000), { [desk]: [{ name: 'Inbox Bot', grokBotUrl: INBOX }] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(requestGrokDelete(root, desk, 'inbox-bot').ok, true)
    run(orgs, new Date(Date.now() + 60_000), { [desk]: [] })
    recordConnectorRun(orgs, 'Connector')
    const log = events(root)
    assert.equal(log.filter((item) => item.kind === 'deleted').length, 1)
    assert.equal(log.filter((item) => item.kind === 'bot-disconnected').length, 0)
  } finally {
    done()
  }
})

test('a bad requests file is skipped by the run and refused by a delete, never a crash', () => {
  const { orgs, make, done } = project()
  try {
    const desk = make('Desk')
    const root = join(orgs, desk)
    seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, REQUESTS_PATH), '{broken', 'utf8')
    assert.deepEqual(readRequests(root), { requests: [], deletes: [], error: 'grok/requests.json is not JSON.' })
    const made = requestGrokDelete(root, desk, 'inbox-bot')
    assert.equal(made.ok, false, 'a bad file is not overwritten by a delete')
    run(orgs, new Date(Date.now() + 60_000), { [desk]: [] })
    assert.doesNotThrow(() => recordConnectorRun(orgs, 'Connector'))
    assert.equal(readFileSync(join(root, REQUESTS_PATH), 'utf8'), '{broken')
  } finally {
    done()
  }
})
