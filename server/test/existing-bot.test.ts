import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { OrgBundle } from '../src/org-files.ts'
import { createExistingBot, createOrgFiles, readOrgDir, startTemplateServer } from '../src/template-server.ts'

const card = {
  owns: ['The inbox'],
  may: ['Draft a reply'],
  mustAskBefore: ['Send the reply'],
  doneWhen: ['The draft is in the folder'],
}

const link = 'https://example.com/grok/invoice-bot'

test('Add existing bot is off on the org chart and Connect bots for now; its drawer stays, and the seat card opens the link', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const drawer = readFileSync(new URL('../../src/components/ExistingBotDrawer.tsx', import.meta.url), 'utf8')
  const seat = readFileSync(new URL('../../src/components/SeatDrawer.tsx', import.meta.url), 'utf8')
  const link = readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8')
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(workspace, />Add existing bot</, 'no button on the org chart')
  assert.doesNotMatch(link, /Add existing bot|onAddExisting/, 'no button in Step 2')
  assert.doesNotMatch(overview, /onAddExisting/)
  assert.match(workspace, /function SeatActions\(\{ onAdd \}: \{ onAdd: \(\) => void \}\) \{\s*return \(\s*<>\s*<Button variant="primary" type="button" onClick=\{onAdd\}>Add a seat<\/Button>\s*<Button variant="secondary" href="#directory">Hire from the directory<\/Button>\s*<\/>/)
  assert.match(workspace, /<ExistingBotDrawer /, 'the drawer stays for when it comes back')
  assert.match(workspace, /\/api\/orgs\/\$\{bundle\.id\}\/seats\/existing/)
  assert.match(workspace, /Bot added/)
  assert.match(drawer, /Bot name/)
  assert.match(drawer, /Grok Bot link/)
  assert.match(drawer, /Reports to/)
  assert.match(drawer, /'Owns'/)
  assert.match(drawer, /'May'/)
  assert.match(drawer, /Needs approval/)
  assert.match(drawer, /Done when/)
  assert.match(seat, /Open in Grok Bot/)
})

test('the writer creates an existing-bot seat, refuses overwrite, and the chart shows it after reload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-existing-bot-'))
  const created = createOrgFiles(dir, 'Gamma Co', 'You')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const first = createExistingBot(root, created.slug, {
    name: 'Invoice Bot',
    grokBotUrl: link,
    reportsTo: 'you',
    ...card,
  })
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.slug, 'invoice-bot')
  assert.equal(first.file, `orgs/${created.slug}/seats/invoice-bot.md`)
  const file = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  assert.match(file, /^---\nname: Invoice Bot\nkind: bot\nsource: existing\ngrokBotUrl: "https:\/\/example.com\/grok\/invoice-bot"\nreportsTo: you\n---/)
  assert.match(file, /## Owns\nThe inbox/)
  assert.match(file, /## May\nDraft a reply/)
  assert.match(file, /## Needs approval\nSend the reply/)
  assert.match(file, /## Done when\nThe draft is in the folder/)
  assert.equal(file.includes('directorySlug'), false)
  assert.equal(file.includes('addToGrokBotUrl'), false)
  const loaded = readOrgDir(root, created.slug)
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const seat = loaded.bundle.seats.find((item) => item.slug === 'invoice-bot')
  assert.equal(seat?.kind, 'bot')
  assert.equal(seat?.seatOrigin, 'existing')
  assert.equal(seat?.grokBotUrl, link)
  assert.equal(seat?.reportsTo, 'you')
  assert.equal(loaded.bundle.org.seats.some((item) => item.slug === 'invoice-bot' && item.reportsTo === 'you'), true)
  const again = createExistingBot(root, created.slug, {
    name: 'Invoice Bot',
    grokBotUrl: 'https://notes.example/bots/invoice',
    reportsTo: 'you',
    ...card,
  })
  assert.equal(again.ok, true)
  if (!again.ok) return
  assert.equal(again.slug, 'invoice-bot-2')
  assert.equal(readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8'), file)
  const reloaded = readOrgDir(root, created.slug)
  assert.equal(reloaded.ok, true)
  if (!reloaded.ok) return
  assert.equal(reloaded.bundle.seats.some((item) => item.slug === 'invoice-bot'), true)
  assert.equal(reloaded.bundle.seats.some((item) => item.slug === 'invoice-bot-2'), true)
  assert.equal(reloaded.bundle.org.seats.some((item) => item.slug === 'invoice-bot-2'), true)
  const badLink = createExistingBot(root, created.slug, {
    name: 'Script Bot',
    grokBotUrl: 'javascript:alert(1)',
    reportsTo: 'you',
    ...card,
  })
  assert.equal(badLink.ok, false)
  const emptyCard = createExistingBot(root, created.slug, {
    name: 'Empty Bot',
    grokBotUrl: '',
    reportsTo: 'you',
    owns: ['One line'],
    may: [],
    mustAskBefore: ['Ask'],
    doneWhen: ['Done'],
  })
  assert.equal(emptyCard.ok, false)
  rmSync(dir, { recursive: true, force: true })
})

test('POST /seats/existing reloads onto the chart and does not overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-existing-http-'))
  const created = createOrgFiles(dir, 'Delta Co', 'You')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const added = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats/existing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Invoice Bot', grokBotUrl: link, reportsTo: 'you', ...card }),
    })
    const addedBody = await added.json() as { ok?: boolean; slug?: string; errors?: string[] }
    assert.equal(added.status, 201, JSON.stringify(addedBody))
    assert.equal(addedBody.slug, 'invoice-bot')
    const loaded = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}`)
    const bundle = await loaded.json() as OrgBundle
    assert.equal(loaded.status, 200)
    const seat = bundle.seats.find((item) => item.slug === 'invoice-bot')
    assert.equal(seat?.grokBotUrl, link)
    assert.equal(seat?.seatOrigin, 'existing')
    assert.equal(bundle.org.seats.some((item) => item.slug === 'invoice-bot' && item.reportsTo === 'you'), true)
    const second = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${created.slug}/seats/existing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Invoice Bot', grokBotUrl: '', reportsTo: 'you', ...card }),
    })
    const secondBody = await second.json() as { slug?: string; errors?: string[] }
    assert.equal(second.status, 201, JSON.stringify(secondBody))
    assert.equal(secondBody.slug, 'invoice-bot-2')
    const original = readFileSync(join(dir, created.slug, 'seats', 'invoice-bot.md'), 'utf8')
    assert.match(original, /source: existing/)
    assert.match(original, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
