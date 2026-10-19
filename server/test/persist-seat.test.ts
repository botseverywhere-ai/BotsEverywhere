import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serializeOrgMarkdown } from '../src/org-markdown.ts'
import type { OrgBundle, OrgDocument, OrgProfile } from '../src/org-files.ts'
import { createHiredSeat, createOrgFiles, readOrgDir, startTemplateServer, updateSeatCard } from '../src/template-server.ts'

const card = {
  owns: ['Match the invoice'],
  may: ['Read the bill'],
  mustAskBefore: ['Pay the vendor'],
  doneWhen: ['The match is recorded'],
}

test('the org page loads from the writer and autosaves the seat card', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  assert.equal(workspace.includes('Save files'), false)
  assert.match(workspace, /\/api\/orgs\/\$\{orgSlug\}\/seats/)
  assert.match(workspace, /kind: 'bot'/)
  assert.match(workspace, /message: 'Saved'/)
  assert.match(app, /useDiskOrg\(slug, fromFiles\)/)
})

test('an org with no seat files shows the founder from org.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-empty-org-'))
  const root = join(dir, 'empty-co')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'org.md'), founderOrg())
  const read = readOrgDir(root, 'empty-co')
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.deepEqual(read.bundle.seats.map((seat) => seat.slug), ['you'])
  assert.equal(read.bundle.seats[0]?.title, 'Ada')
  assert.equal(read.bundle.seats[0]?.role, 'Founder')
  assert.equal(read.bundle.seats[0]?.kind, 'human')
  rmSync(dir, { recursive: true, force: true })
})

test('hiring writes a seat file, refuses overwrite, and rejects traversal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-hire-seat-'))
  const created = createOrgFiles(dir, 'Alpha Co', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const first = createHiredSeat(root, created.slug, {
    name: 'Invoice Bot',
    kind: 'bot',
    directorySlug: 'invoice-bot',
    reportsTo: 'you',
    addToGrokBotUrl: '',
    ...card,
  })
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.slug, 'invoice-bot')
  assert.equal(first.file, `orgs/${created.slug}/seats/invoice-bot.md`)
  const file = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  assert.match(file, /^---\nname: Invoice Bot\nkind: bot\ndirectorySlug: invoice-bot\nreportsTo: you\naddToGrokBotUrl: ""\n---/)
  assert.match(file, /## Owns\nMatch the invoice/)
  assert.match(file, /## May\nRead the bill/)
  assert.match(file, /## Needs approval\nPay the vendor/)
  assert.match(file, /## Done when\nThe match is recorded/)
  const again = createHiredSeat(root, created.slug, {
    name: 'Invoice Bot',
    kind: 'bot',
    directorySlug: 'invoice-bot',
    reportsTo: 'you',
    ...card,
  })
  assert.equal(again.ok, true)
  if (!again.ok) return
  assert.equal(again.slug, 'invoice-bot-2')
  assert.equal(existsSync(join(root, 'seats', 'invoice-bot-2.md')), true)
  assert.match(readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8'), /Match the invoice/)
  const escaped = createHiredSeat(root, created.slug, {
    name: 'Nope',
    directorySlug: '../secret',
    reportsTo: 'you',
    ...card,
  })
  assert.equal(escaped.ok, false)
  assert.equal(existsSync(join(dir, 'secret.md')), false)
  assert.equal(existsSync(join(root, '..', 'secret.md')), false)
  const edited = updateSeatCard(root, created.slug, 'invoice-bot', {
    ...card,
    owns: ['Match the invoice', 'Flag a mismatch'],
  })
  assert.equal(edited.ok, true)
  const after = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  assert.match(after, /name: Invoice Bot/)
  assert.match(after, /directorySlug: invoice-bot/)
  assert.match(after, /Flag a mismatch/)
  const walked = updateSeatCard(root, created.slug, '../invoice-bot', card)
  assert.equal(walked.ok, false)
  rmSync(dir, { recursive: true, force: true })
})

test('hire, reload, and edit round-trip through the writer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-hire-http-'))
  const created = createOrgFiles(dir, 'Beta Co', 'Bea')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const hired = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Invoice Bot',
        kind: 'bot',
        directorySlug: 'invoice-bot',
        reportsTo: 'you',
        addToGrokBotUrl: '',
        ...card,
      }),
    })
    const hiredBody = await hired.json() as { ok?: boolean; slug?: string; file?: string; errors?: string[] }
    assert.equal(hired.status, 201, JSON.stringify(hiredBody))
    assert.equal(hiredBody.slug, 'invoice-bot')
    const seatPath = join(dir, created.slug, 'seats', 'invoice-bot.md')
    assert.equal(existsSync(seatPath), true)
    const loaded = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}`)
    const bundle = await loaded.json() as OrgBundle
    assert.equal(loaded.status, 200)
    assert.equal(bundle.seats.some((seat) => seat.slug === 'invoice-bot' && seat.kind === 'bot'), true)
    assert.equal(bundle.org.seats.some((seat) => seat.slug === 'invoice-bot' && seat.reportsTo === 'you'), true)
    const reloaded = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}`)
    const again = await reloaded.json() as OrgBundle
    assert.equal(again.seats.some((seat) => seat.slug === 'invoice-bot'), true)
    const edited = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats/invoice-bot`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...card, owns: ['Match the invoice', 'Flag a mismatch'] }),
    })
    assert.equal(edited.status, 200, JSON.stringify(await edited.clone().json()))
    const file = readFileSync(seatPath, 'utf8')
    assert.match(file, /name: Invoice Bot/)
    assert.match(file, /Flag a mismatch/)
    const blocked = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nope', directorySlug: '../../etc/passwd', reportsTo: 'you', ...card }),
    })
    assert.equal(blocked.status, 422)
    assert.equal(existsSync(join(dir, 'passwd.md')), false)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function founderOrg(): string {
  const org: OrgDocument = {
    company: { name: 'Empty Co', tagline: '', industry: '', mark: 'EC', markColor: '#111111' },
    departments: [{ id: 'general', name: 'General' }],
    people: [{ id: 'person-you', name: 'Ada', title: 'Founder', department: 'general' }],
    seats: [{ slug: 'you', reportsTo: null }],
  }
  const profile: OrgProfile = {
    name: 'Empty Co',
    description: '',
    purpose: 'A founder and no bots yet.',
    industry: '',
    size: '',
    people: 1,
    bots: 0,
  }
  return serializeOrgMarkdown(org, profile)
}
