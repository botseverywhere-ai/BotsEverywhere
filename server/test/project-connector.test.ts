import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CONNECTOR_FILE, PROJECT_FILE, ensureProjectId, readConnector } from '../src/project.ts'
import { connectorName, connectorPrompt } from '../src/connector-prompt.ts'
import { orgChange } from '../src/live-hub.ts'
import { parseSnapshot, planSync } from '../src/grok-sync.ts'
import { accountBots, adoptUnassigned, clearFulfilledRequests, createOrgFiles, readOrgDir, requestGrokBot, syncStatus } from '../src/template-server.ts'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-project-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  return { dir, orgs, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function org(orgs: string, name: string): string {
  const made = createOrgFiles(orgs, name, 'Ada')
  assert.equal(made.ok, true)
  if (!made.ok) throw new Error('no org')
  return made.slug
}

function writeBot(orgs: string, slug: string, seat: string, title: string, extra = '') {
  writeFileSync(join(orgs, slug, 'seats', `${seat}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

test('the project id is made once, kept, and survives a BOM, CRLF, or a bad file', () => {
  const p = project()
  try {
    const first = ensureProjectId(p.orgs)
    assert.match(first, /^[a-hjkmnp-z2-9]{4}$/)
    assert.equal(ensureProjectId(p.orgs), first, 'the same id on the next start')
    assert.deepEqual(JSON.parse(readFileSync(join(p.orgs, PROJECT_FILE), 'utf8')), { id: first })
    writeFileSync(join(p.orgs, PROJECT_FILE), '\uFEFF{\r\n  "id": "k3f9"\r\n}\r\n')
    assert.equal(ensureProjectId(p.orgs), 'k3f9')
    writeFileSync(join(p.orgs, PROJECT_FILE), 'not json')
    const fresh = ensureProjectId(p.orgs)
    assert.match(fresh, /^[a-hjkmnp-z2-9]{4}$/)
    assert.equal(JSON.parse(readFileSync(join(p.orgs, PROJECT_FILE), 'utf8')).id, fresh, 'a bad file is replaced')
  } finally {
    p.done()
  }
})

test('the Connector file: missing, read with BOM and CRLF, or bad but still dated', () => {
  const p = project()
  try {
    assert.equal(readConnector(p.orgs), null)
    writeFileSync(join(p.orgs, CONNECTOR_FILE), '\uFEFF{\r\n"syncedAt": "2026-10-18T10:00:00.000Z",\r\n"unassigned": [{ "name": "Loose Bot" }]\r\n}\r\n')
    const read = readConnector(p.orgs)
    assert.equal(read?.error, '')
    assert.equal(read?.syncedAt, '2026-10-18T10:00:00.000Z')
    assert.deepEqual(read?.unassigned.map((bot) => bot.name), ['Loose Bot'])
    assert.match(read?.stamp ?? '', /^\d+:\d+$/)
    writeFileSync(join(p.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-18T11:00:00.000Z', unassigned: [] }))
    const none = readConnector(p.orgs)
    assert.equal(none?.error, '', 'no unassigned bots is a normal run, not a broken file')
    assert.deepEqual(none?.unassigned, [])
    writeFileSync(join(p.orgs, CONNECTOR_FILE), '{ broken')
    const bad = readConnector(p.orgs)
    assert.notEqual(bad?.error, '')
    assert.match(bad?.stamp ?? '', /^\d+:\d+$/, 'a bad file still proves the Connector ran')
    assert.deepEqual(bad?.unassigned, [])
  } finally {
    p.done()
  }
})

test('one Connector per project: named with the id, pointed at the orgs folder, every org in it', () => {
  assert.equal(connectorName('k3f9'), 'Connector - BotsEverywhere (k3f9)')
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: 'C:\\me\\be\\orgs' })
  assert.match(prompt, /^Create a bot named Connector - BotsEverywhere \(k3f9\)\./)
  assert.match(prompt, /C:\\me\\be\\orgs/)
  assert.match(prompt, /Every folder in C:\\me\\be\\orgs that contains an org\.md file is one organization/)
  assert.match(prompt, /Never read or write any file outside C:\\me\\be\\orgs/)
  assert.match(prompt, /<org>\/grok\/requests\.json/)
  assert.match(prompt, /<org>\/grok\/snapshot\.json/)
  assert.match(prompt, /C:\\me\\be\\orgs\/connector\.json/)
  assert.match(prompt, /"unassigned"/)
  assert.match(prompt, /at most one organization/)
  assert.match(prompt, /Title · Organization name/)
  assert.match(prompt, /Run this routine every 15 minutes\./)
  assert.match(prompt, /UTF-8 without a byte-order mark and with LF line endings/)
  assert.match(prompt, /Never edit org\.md, seats\/, processes\/, work-chart\.md, grok\/requests\.json, or project\.json/)
  assert.match(prompt, /The bot field on those lines is Connector\./)
  assert.match(prompt, /- HH:MM \| bot \| process \| step \| done\|failed\|skipped\|waiting\|running \| note or -/)
  assert.match(prompt, /Never estimate or invent numbers\./)
  assert.equal(/\bcompany\b/i.test(prompt), false)
})

test('the watcher tells every open org when the project Connector writes', () => {
  assert.deepEqual(orgChange('/x/orgs', 'connector.json'), { slug: '*', kind: 'grok' })
  assert.deepEqual(orgChange('C:/x/orgs', 'C:\\x\\orgs\\project.json'), { slug: '*', kind: 'grok' })
  assert.equal(orgChange('/x/orgs', 'notes.json'), null)
})

test('a bot name used by another org is requested as "Title · Org name" and matched back', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const ledger = org(p.orgs, 'Ledger Partners')
    writeBot(p.orgs, desk, 'invoice-bot', 'Invoice Bot')
    writeBot(p.orgs, ledger, 'invoice-bot', 'Invoice Bot')
    writeBot(p.orgs, ledger, 'payment-bot', 'Payment Bot')
    const asked = requestGrokBot(join(p.orgs, ledger), ledger, 'invoice-bot', p.orgs)
    assert.equal(asked.ok && asked.request.name, 'Invoice Bot · Ledger Partners')
    const plain = requestGrokBot(join(p.orgs, ledger), ledger, 'payment-bot', p.orgs)
    assert.equal(plain.ok && plain.request.name, 'Payment Bot', 'a unique name stays as it is')
    const status = syncStatus(join(p.orgs, ledger), ledger, p.orgs)
    assert.equal(status.ok && status.status.project?.renamed['invoice-bot'], 'Invoice Bot · Ledger Partners')
    const read = readOrgDir(join(p.orgs, ledger), ledger)
    assert.equal(read.ok, true)
    if (!read.ok) return
    const snap = parseSnapshot(JSON.stringify({ syncedAt: '2026-10-18T10:00:00.000Z', bots: [{ name: 'Invoice Bot · Ledger Partners' }] }), '')
    assert.equal(snap.ok, true)
    if (!snap.ok) return
    const plan = planSync(snap.snapshot, read.bundle.seats, [], 'Ledger Partners')
    assert.ok(plan.rows.some((row) => row.kind !== 'new' && 'slug' in row && row.slug === 'invoice-bot'), 'the renamed bot lands on its seat')
    assert.equal(plan.rows.some((row) => row.kind === 'new'), false)
  } finally {
    p.done()
  }
})

test('a seat whose bot is anywhere in the Grok Bot account is not missing', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const ledger = org(p.orgs, 'Ledger')
    const link = 'grokbot://app/v1/agent?id=invoice'
    writeBot(p.orgs, desk, 'invoice-bot', 'Invoice Bot', `grokBotUrl: "${link}"\ngrokSync: missing\n`)
    writeBot(p.orgs, desk, 'inbox-bot', 'Inbox Bot', 'grokBotUrl: "grokbot://app/v1/agent?id=inbox"\n')
    writeBot(p.orgs, desk, 'inbox-bot-2', 'Inbox Bot', 'grokBotUrl: "grokbot://app/v1/agent?id=inbox"\n')
    writeBot(p.orgs, desk, 'connector', connectorName(ensureProjectId(p.orgs)))
    writeBot(p.orgs, desk, 'gone-bot', 'Gone Bot')
    mkdirSync(join(p.orgs, ledger, 'grok'), { recursive: true })
    writeFileSync(join(p.orgs, ledger, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-18T10:00:00.000Z', bots: [{ name: 'Invoice Bot', grokBotUrl: link }] }))
    const read = readOrgDir(join(p.orgs, desk), desk)
    assert.equal(read.ok, true)
    if (!read.ok) return
    const snap = parseSnapshot(JSON.stringify({ syncedAt: '2026-10-18T10:00:00.000Z', bots: [{ name: 'Inbox Bot', grokBotUrl: 'grokbot://app/v1/agent?id=inbox' }] }), '')
    assert.equal(snap.ok, true)
    if (!snap.ok) return
    const plan = planSync(snap.snapshot, read.bundle.seats, [], 'Desk', accountBots(p.orgs, desk))
    const missing = plan.rows.filter((row) => row.kind === 'missing').map((row) => 'slug' in row ? row.slug : '')
    assert.deepEqual(missing, ['gone-bot'])
    const back = plan.rows.find((row) => row.kind === 'updated' && row.slug === 'invoice-bot')
    assert.equal(back?.kind === 'updated' && back.patch.grokSync, 'synced', 'a seat called missing before goes back to In Grok Bot')
  } finally {
    p.done()
  }
})

test('sync status carries the project: id, Connector, unassigned bots, and bots across every org', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const ledger = org(p.orgs, 'Ledger')
    writeBot(p.orgs, desk, 'a-bot', 'A Bot')
    writeBot(p.orgs, ledger, 'b-bot', 'B Bot')
    writeBot(p.orgs, ledger, 'c-bot', 'C Bot')
    writeFileSync(join(p.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-18T10:00:00.000Z', unassigned: [{ name: 'Loose Bot', owns: ['Rows'] }] }))
    const status = syncStatus(join(p.orgs, desk), desk, p.orgs)
    assert.equal(status.ok, true)
    if (!status.ok) return
    const info = status.status.project!
    assert.match(info.id, /^[a-hjkmnp-z2-9]{4}$/)
    assert.equal(info.connectorName, `Connector - BotsEverywhere (${info.id})`)
    assert.equal(info.orgsFolder, p.orgs)
    assert.equal(info.bots, 3)
    assert.deepEqual(info.unassigned, ['Loose Bot'])
    assert.equal(info.connector?.syncedAt, '2026-10-18T10:00:00.000Z')
    assert.ok(existsSync(join(p.orgs, PROJECT_FILE)))
  } finally {
    p.done()
  }
})

test('a confirmed sync logs one "Created in Grok Bot" line per bot the Connector made, and clears its request', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    writeBot(p.orgs, desk, 'payment-bot', 'Payment Bot')
    writeBot(p.orgs, desk, 'quote-bot', 'Quote Bot')
    assert.equal(requestGrokBot(root, desk, 'payment-bot', p.orgs).ok, true)
    assert.equal(requestGrokBot(root, desk, 'quote-bot', p.orgs).ok, true)
    // The snapshot found Payment Bot; Quote Bot is still waiting.
    clearFulfilledRequests(root, desk, { rows: [{ kind: 'unchanged', name: 'Payment Bot', slug: 'payment-bot' }] } as never)
    const requests = JSON.parse(readFileSync(join(root, 'grok', 'requests.json'), 'utf8')) as { requests: { seat: string }[] }
    assert.deepEqual(requests.requests.map((item) => item.seat), ['quote-bot'])
    const read = readOrgDir(root, desk)
    const created = read.ok ? read.bundle.activity.filter((event) => event.summary.startsWith('Created in Grok Bot')) : []
    assert.deepEqual(created.map((event) => [event.summary, event.subjectSeatId, event.grok]), [['Created in Grok Bot: Payment Bot', 'payment-bot', 'in']])
  } finally {
    p.done()
  }
})

test('a bot added from the no-organization list is not called missing by the snapshot written before it was added', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const at = '2026-10-18T16:21:39.000Z'
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: at, bots: [], processes: [] }))
    writeFileSync(join(p.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: at, unassigned: [{ name: 'Inbox Bot', grokBotUrl: 'grokbot://app/v1/agent?id=846848bd' }] }))
    const added = adoptUnassigned(p.orgs, root, desk, ['Inbox Bot'])
    assert.equal(added.ok && added.added.length, 1)
    const status = syncStatus(root, desk, p.orgs)
    assert.equal(status.ok, true)
    if (!status.ok) return
    assert.equal(status.status.plan?.rows.some((row) => row.kind === 'missing'), false, 'not missing: it was added after that snapshot')
    assert.equal(status.status.plan?.writes, 0, 'confirming must not tag it Not in Grok Bot')
  } finally {
    p.done()
  }
})

test('a seat that matches a bot in the no-organization list, by link or name, is in Grok Bot, not missing', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    writeBot(p.orgs, desk, 'inbox-bot', 'Inbox Bot')
    writeBot(p.orgs, desk, 'linked-bot', 'Linked Bot', 'grokBotUrl: "grokbot://app/v1/agent?id=abc"\n')
    writeBot(p.orgs, desk, 'gone-bot', 'Gone Bot')
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-18T16:21:39.000Z', bots: [], processes: [] }))
    writeFileSync(join(p.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-18T16:21:39.000Z', unassigned: [{ name: 'Inbox Bot' }, { name: 'Renamed In Grok', grokBotUrl: 'grokbot://app/v1/agent?id=abc' }] }))
    const status = syncStatus(root, desk, p.orgs)
    if (!status.ok) throw new Error('no status')
    const missing = status.status.plan!.rows.filter((row) => row.kind === 'missing').map((row) => row.name)
    assert.deepEqual(missing, ['Gone Bot'], 'only the bot Grok Bot really lacks')
  } finally {
    p.done()
  }
})

test('unassigned bots join the org they are added to, marked New, and are not added twice', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    writeFileSync(join(p.orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-18T10:00:00.000Z', unassigned: [{ name: 'Loose Bot', owns: ['Rows'] }, { name: 'Other Bot' }] }))
    const added = adoptUnassigned(p.orgs, join(p.orgs, desk), desk, ['Loose Bot', 'Nobody'])
    assert.equal(added.ok, true)
    if (!added.ok) return
    assert.deepEqual(added.added, ['Loose Bot'])
    const read = readOrgDir(join(p.orgs, desk), desk)
    const seat = read.ok ? read.bundle.seats.find((item) => item.title === 'Loose Bot') : undefined
    assert.equal(seat?.grokSync, 'new')
    const again = adoptUnassigned(p.orgs, join(p.orgs, desk), desk, ['Loose Bot'])
    assert.equal(again.ok && again.added.length, 0, 'a name already a seat here is skipped')
  } finally {
    p.done()
  }
})
