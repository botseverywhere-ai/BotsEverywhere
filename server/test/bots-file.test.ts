import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BOTS_FILE_TEMPLATE, exportBotsFile, parseBotsFile } from '../src/bots-file.ts'
import { createExistingBot, createHiredSeat, createOrgFiles, importBotsFile, readOrgDir } from '../src/template-server.ts'

const card = {
  owns: ['Match the invoice'],
  may: ['Read the bill'],
  needsApproval: ['Pay the vendor'],
  doneWhen: 'The match is recorded',
}

test('Company Overview previews the bots file and confirms before writing', () => {
  const page = readFileSync(new URL('../../src/components/BotsFileImport.tsx', import.meta.url), 'utf8')
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  assert.match(page, /Import bots file/)
  assert.match(readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8'), /Export bots file/, 'Export sits in Step 2 once the organization has bots')
  assert.match(page, /Download bots file template/)
  assert.match(page, /GrokBotsPrompt/)
  assert.doesNotMatch(page, /mode/, 'the bots file is Option 2 only')
  const prompt = readFileSync(new URL('../../src/content/grok-bots-prompt.ts', import.meta.url), 'utf8')
  const docs = readFileSync(new URL('../../docs/bots-file.md', import.meta.url), 'utf8')
  const docsPage = readFileSync(new URL('../../src/pages/DocsPage.tsx', import.meta.url), 'utf8')
  const link = readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(prompt, /botseverywhere-bots\.json/)
  assert.match(docs, /botseverywhere-bots\.json/)
  assert.doesNotMatch(docs, /Paste this into Grok Bot/, 'Option 1 has no prompt and no file')
  assert.match(docs, /## Import from the Connector/)
  assert.doesNotMatch(docsPage, /GROK_BOTS_PROMPT|Bots file prompt/)
  assert.doesNotMatch(prompt, /List every bot I run in Grok Bot/, 'the Grok Bot prompt is gone')
  assert.match(link, /How to link your organization to BotsEverywhere/)
  assert.match(link, /Import from your Grok Bot/)
  assert.match(link, /title="Import from a template \.json" badge="build an organization from an interview with an LLM"/)
  assert.equal(link.includes('Add your organization manually'), false, 'for the demo, Step 2 has two ways in')
  assert.equal(link.includes('Import an existing organization'), false)
  assert.match(link, /option=\{1\} title="Import from your Grok Bot"/, 'each way in is numbered before its title')
  assert.match(link, /option=\{2\} title="Import from a template \.json"/)
  assert.match(link, /<span className="link-panel-option">Option \{option\}<\/span>\{title\}/)
  assert.match(link, /current === id \? null : id/)
  assert.equal(workspace.includes('LinkCompany'), false)
  assert.equal(workspace.includes('How to link your organization to BotsEverywhere'), false)
  assert.match(page, /Nothing is written until you confirm/)
  assert.match(page, /Imported \$\{count\} bots/)
  assert.match(page, /\$\{bots\} imported, \$\{noteLabel\}/)
  assert.match(page, /Skipped \$\{item\.name\}: \$\{item\.error\}/)
  assert.match(page, /const detail = \[\.\.\.changed, skipped\]\.filter\(Boolean\)\.join\(' '\)/, 'notes from the writer come before the skipped bots')
  assert.match(page, /\$\{summary\}\. \$\{detail\}/)
  assert.match(page, /className="bots-note"/)
  assert.match(page, /'Not imported'/)
  assert.match(overview, /<LinkCompany/)
  assert.match(overview, /id="backup-title">Backup/)
  assert.match(overview, /id="company-fields"/)
  const panel = readFileSync(new URL('../../src/components/GrokBotsPrompt.tsx', import.meta.url), 'utf8')
  const directory = readFileSync(new URL('../../src/pages/DirectoryPage.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  const files = readFileSync(new URL('../../src/components/OrgFiles.tsx', import.meta.url), 'utf8')
  assert.match(panel, /className="dir-prompt"/)
  assert.match(panel, /CopyPromptButton/)
  assert.match(panel, /className="dir-actions"/)
  assert.doesNotMatch(panel, /Paste this prompt into Grok Bot|Import the Grok Bot \.json file|grokBotsPrompt/, 'no Grok Bot prompt by default: Option 2 passes its own')
  assert.match(link, /<details/)
  assert.match(link, /className="grok-chevron"/)
  assert.equal(panel.includes('How to use this prompt'), false)
  assert.equal(panel.includes('dir-steps'), false)
  assert.equal(panel.includes('Show full prompt'), false)
  assert.equal(panel.includes('CodeBlock'), false)
  assert.match(css, /\.link-panel:not\(\[open\]\) > :not\(summary\) \{ display: none; \}/)
  assert.match(css, /\.grok-chevron \{[^}]*background-image:\s*var\(--select-chevron\)/)
  assert.match(css, /\.link-panel\[open\] \.grok-chevron \{[^}]*transform:\s*rotate\(180deg\)/)
  assert.match(files, /This replaces everything in this org/)
  assert.match(files, /Import zip/)
  assert.match(files, /Import folder/)
  assert.match(directory, /className="dir-prompt"/)
  assert.match(directory, /className="dir-actions"/)
  assert.match(directory, /How to use this prompt/)
  assert.match(overview, /useState\(false\)/)
  assert.equal(overview.includes('defaultOpen'), false)
  const linkAt = overview.indexOf('<LinkCompany')
  const fieldsAt = overview.indexOf('id="company-fields"')
  const backupAt = overview.indexOf('id="backup-title"')
  assert.ok(linkAt > 0 && fieldsAt > linkAt && backupAt > fieldsAt)
  assert.match(overview, /section === 'connect' && editable \? \(\s*<LinkCompany/, 'the link section is on Connect bots only')
  assert.match(overview, /section === 'overview' \? \(\s*<form id="company-fields"/, 'the fields are on Organization Overview only')
  assert.match(overview, /section === 'backup' && editable \? \(\s*<section className="org-backup"/, 'the backup is on Backup only')
})

test('an empty org chart renders the chart, not the link section', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  const work = readFileSync(new URL('../../src/components/ProcessChart.tsx', import.meta.url), 'utf8')
  const org = viewSource(workspace, 'org')
  assert.match(org, /<OrgChart/)
  assert.equal(org.includes('LinkCompany'), false)
  assert.equal(org.includes('How to link your organization to BotsEverywhere'), false)
  assert.match(org, /No bots yet\. Import them from <a href=\{hrefFor\(bundle\.id, sample, 'connect'\)\}>Connect bots<\/a>\./)
  assert.equal(viewSource(workspace, 'work').includes('How to link your organization to BotsEverywhere'), false)
  assert.equal(viewSource(workspace, 'performance').includes('How to link your organization to BotsEverywhere'), false)
  assert.equal(viewSource(workspace, 'log').includes('How to link your organization to BotsEverywhere'), false)
  assert.equal(work.includes('How to link your organization to BotsEverywhere'), false)
  assert.match(overview, /<LinkCompany/)
})

function viewSource(source: string, view: string): string {
  const start = source.indexOf(`{view === '${view}' ? (`)
  const end = source.indexOf(') : null}', start)
  return start === -1 || end === -1 ? '' : source.slice(start, end)
}

test('parse reads the bots file fields and defaults reportsTo to You', () => {
  const parsed = parseBotsFile(JSON.stringify({
    bots: [
      { name: 'Invoice Bot', grokBotUrl: 'https://x.ai/bot/abc', ...card },
      { name: '  Collections Bot  ', reportsTo: 'Invoice Bot', owns: ['Chase it'], may: ['Read invoices'], needsApproval: ['Send a notice'], doneWhen: 'Sent\nPaid' },
    ],
  }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows[0]?.reportsTo, 'You')
  assert.equal(parsed.rows[0]?.grokBotUrl, 'https://x.ai/bot/abc')
  assert.deepEqual(parsed.rows[0]?.needsApproval, ['Pay the vendor'])
  assert.deepEqual(parsed.rows[0]?.doneWhen, ['The match is recorded'])
  assert.equal(parsed.rows[1]?.name, 'Collections Bot')
  assert.deepEqual(parsed.rows[1]?.doneWhen, ['Sent', 'Paid'])
  assert.equal(parsed.rows[0]?.error, '')
  const bad = parseBotsFile('{')
  assert.equal(bad.ok, false)
  const link = parseBotsFile(JSON.stringify({ bots: [{ name: 'Invoice Bot', grokBotUrl: 'https://example.com/bot/x', ...card }] }))
  assert.equal(link.ok, true)
  if (link.ok) {
    assert.equal(link.rows[0]?.error, '')
    assert.equal(link.rows[0]?.grokBotUrl, 'https://example.com/bot/x')
  }
  const script = parseBotsFile(JSON.stringify({ bots: [{ name: 'Invoice Bot', grokBotUrl: 'javascript:alert(1)', ...card }] }))
  assert.equal(script.ok, true)
  if (script.ok) {
    assert.equal(script.rows[0]?.error, '')
    assert.equal(script.rows[0]?.grokBotUrl, '')
    assert.equal(script.rows[0]?.note, 'grokBotUrl was left out.')
  }
  const placeholder = parseBotsFile(JSON.stringify({
    bots: [{ name: 'Notes Bot', grokBotUrl: "the bot's Grok Bot link (grokbot://... is fine), or leave it out" }],
  }))
  assert.equal(placeholder.ok, true)
  if (placeholder.ok) {
    assert.equal(placeholder.rows[0]?.error, '')
    assert.equal(placeholder.rows[0]?.note, 'grokBotUrl was left out.')
    assert.equal(placeholder.rows[0]?.grokBotUrl, '')
    assert.deepEqual(placeholder.rows[0]?.owns, [])
    assert.equal(placeholder.rows[0]?.reportsTo, 'You')
  }
  const shipped = parseBotsFile(readFileSync(fileURLToPath(new URL('../../public/bots-file-template.json', import.meta.url)), 'utf8'))
  assert.equal(shipped.ok, true)
  assert.equal(parseBotsFile(BOTS_FILE_TEMPLATE).ok, true)
})

test('reportsTo resolves to another imported bot on the second pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-bots-'))
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const parsed = parseBotsFile(JSON.stringify({
    bots: [
      { name: 'Collections Bot', reportsTo: 'Invoice Bot', owns: ['Chase it'], may: ['Read invoices'], needsApproval: ['Send a notice'], doneWhen: 'The reminder is sent' },
      { name: 'Invoice Bot', grokBotUrl: 'https://example.com/grok/invoice', ...card },
    ],
  }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const result = importBotsFile(root, created.slug, parsed.rows)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.imported.map((item) => item.slug), ['collections-bot', 'invoice-bot'])
  const collections = readFileSync(join(root, 'seats', 'collections-bot.md'), 'utf8')
  const invoice = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  assert.match(invoice, /source: existing/)
  assert.match(invoice, /grokBotUrl: "https:\/\/example.com\/grok\/invoice"/)
  assert.match(invoice, /reportsTo: you/)
  assert.equal(invoice.includes('directorySlug'), false)
  assert.equal(invoice.includes('addToGrokBotUrl'), false)
  assert.match(collections, /source: existing/)
  assert.match(collections, /reportsTo: invoice-bot/)
  const loaded = readOrgDir(root, created.slug)
  assert.equal(loaded.ok, true)
  if (loaded.ok) {
    const chart = new Map(loaded.bundle.org.seats.map((seat) => [seat.slug, seat.reportsTo]))
    assert.equal(chart.get('invoice-bot'), 'you')
    assert.equal(chart.get('collections-bot'), 'invoice-bot')
    const seat = loaded.bundle.seats.find((item) => item.slug === 'invoice-bot')
    assert.equal(seat?.seatOrigin, 'existing')
    assert.equal(seat?.grokBotUrl, 'https://example.com/grok/invoice')
  }
  rmSync(dir, { recursive: true, force: true })
})

test('a bot name with a slash is saved under a slug and can be reportsTo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-bots-slash-'))
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const parsed = parseBotsFile(JSON.stringify({
    bots: [
      {
        name: 'UX/UI - botseverywhere',
        reportsTo: 'You',
        owns: ['The screen'],
        may: ['Read the spec'],
        needsApproval: ['Ship the layout'],
        doneWhen: 'The screen is reviewed',
      },
      {
        name: 'Copy Bot',
        reportsTo: 'UX/UI - botseverywhere',
        owns: ['The words'],
        may: ['Read the screen'],
        needsApproval: ['Publish'],
        doneWhen: 'The copy is filed',
      },
    ],
  }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const result = importBotsFile(root, created.slug, parsed.rows)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.imported.map((item) => item.slug), ['ux-ui-botseverywhere', 'copy-bot'])
  const file = join(root, 'seats', 'ux-ui-botseverywhere.md')
  assert.equal(existsSync(file), true)
  const source = readFileSync(file, 'utf8')
  assert.match(source, /^name: UX\/UI - botseverywhere$/m)
  assert.equal(source.includes('seats/ux/'), false)
  const loaded = readOrgDir(root, created.slug)
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const design = loaded.bundle.seats.find((seat) => seat.slug === 'ux-ui-botseverywhere')
  const copy = loaded.bundle.seats.find((seat) => seat.slug === 'copy-bot')
  assert.equal(design?.title, 'UX/UI - botseverywhere')
  assert.equal(copy?.reportsTo, 'ux-ui-botseverywhere')
  rmSync(dir, { recursive: true, force: true })
})

test('export then import into an empty company recreates the seats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-bots-round-'))
  const source = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(source.ok, true)
  if (!source.ok) return
  const sourceRoot = join(dir, source.slug)
  const hired = createHiredSeat(sourceRoot, source.slug, {
    name: 'Invoice Bot',
    kind: 'bot',
    directorySlug: 'invoice-bot',
    reportsTo: 'you',
    addToGrokBotUrl: 'https://x.ai/bot/invoice',
    owns: ['Match the invoice'],
    may: ['Read the bill'],
    mustAskBefore: ['Pay the vendor'],
    doneWhen: ['The match is recorded'],
  })
  assert.equal(hired.ok, true)
  const existing = createExistingBot(sourceRoot, source.slug, {
    name: 'Collections Bot',
    grokBotUrl: 'https://example.com/grok/collections',
    reportsTo: 'invoice-bot',
    owns: ['Chase the unpaid invoice'],
    may: ['Read the open invoices'],
    mustAskBefore: ['Send a legal notice'],
    doneWhen: ['The reminder is sent'],
  })
  assert.equal(existing.ok, true)
  const loaded = readOrgDir(sourceRoot, source.slug)
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const file = exportBotsFile(loaded.bundle.seats)
  const parsed = parseBotsFile(file)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.rows.map((row) => row.name).sort(), ['Collections Bot', 'Invoice Bot'])
  const invoice = parsed.rows.find((row) => row.name === 'Invoice Bot')
  const collections = parsed.rows.find((row) => row.name === 'Collections Bot')
  assert.equal(invoice?.grokBotUrl, 'https://x.ai/bot/invoice')
  assert.equal(invoice?.reportsTo, 'You')
  assert.equal(collections?.grokBotUrl, 'https://example.com/grok/collections')
  assert.equal(collections?.reportsTo, 'Invoice Bot')
  assert.equal(file.includes('"Ada"'), false)
  // Another copy of the app: within one, a bot already active in North office is not added to a second organization.
  const otherCopy = mkdtempSync(join(tmpdir(), 'be-bots-round-copy-'))
  const target = createOrgFiles(otherCopy, 'South office', 'You')
  assert.equal(target.ok, true)
  if (!target.ok) return
  const targetRoot = join(otherCopy, target.slug)
  const imported = importBotsFile(targetRoot, target.slug, parsed.rows)
  assert.deepEqual(imported.errors, [])
  const again = readOrgDir(targetRoot, target.slug)
  assert.equal(again.ok, true)
  if (!again.ok) return
  const byName = new Map(again.bundle.seats.map((seat) => [seat.title, seat]))
  const founder = again.bundle.seats.find((seat) => seat.kind === 'human')
  const nextInvoice = byName.get('Invoice Bot')
  const nextCollections = byName.get('Collections Bot')
  assert.equal(nextInvoice?.grokBotUrl, 'https://x.ai/bot/invoice')
  assert.deepEqual(nextInvoice?.owns, ['Match the invoice'])
  assert.deepEqual(nextInvoice?.may, ['Read the bill'])
  assert.deepEqual(nextInvoice?.mustAskBefore, ['Pay the vendor'])
  assert.deepEqual(nextInvoice?.doneWhen, ['The match is recorded'])
  assert.equal(nextInvoice?.reportsTo, founder?.slug)
  assert.equal(nextCollections?.grokBotUrl, 'https://example.com/grok/collections')
  assert.equal(nextCollections?.reportsTo, nextInvoice?.slug)
  assert.deepEqual(nextCollections?.owns, ['Chase the unpaid invoice'])
  const sparse = parseBotsFile(JSON.stringify({ bots: [{ name: 'Notes Bot', grokBotUrl: 'not a url' }] }))
  assert.equal(sparse.ok, true)
  if (!sparse.ok) return
  assert.equal(sparse.rows[0]?.note, 'grokBotUrl was left out.')
  assert.equal(sparse.rows[0]?.error, '')
  const added = importBotsFile(targetRoot, target.slug, sparse.rows)
  assert.deepEqual(added.errors, [])
  assert.equal(added.imported[0]?.slug, 'notes-bot')
  const notes = readFileSync(join(targetRoot, 'seats', 'notes-bot.md'), 'utf8')
  assert.match(notes, /grokBotUrl: ""/)
  rmSync(dir, { recursive: true, force: true })
  rmSync(otherCopy, { recursive: true, force: true })
})

test('an existing seat file is not overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-bots-'))
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const first = createHiredSeat(root, created.slug, {
    name: 'Invoice Bot',
    kind: 'bot',
    slug: 'invoice-bot',
    reportsTo: 'you',
    owns: ['Keep the first file'],
    may: ['Read the bill'],
    mustAskBefore: ['Pay the vendor'],
    doneWhen: ['The first file stays'],
  })
  assert.equal(first.ok, true)
  const before = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  const parsed = parseBotsFile(JSON.stringify({ bots: [{ name: 'Invoice Bot', ...card }] }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const result = importBotsFile(root, created.slug, parsed.rows)
  assert.deepEqual(result.errors, [])
  assert.equal(result.imported[0]?.slug, 'invoice-bot-2')
  assert.equal(existsSync(join(root, 'seats', 'invoice-bot-2.md')), true)
  assert.equal(readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8'), before)
  assert.match(before, /Keep the first file/)
  assert.match(readFileSync(join(root, 'seats', 'invoice-bot-2.md'), 'utf8'), /source: existing/)
  rmSync(dir, { recursive: true, force: true })
})

test('a Grok Bot file with loose fields still imports', () => {
  const fixture = readFileSync(new URL('./fixtures/grok-bots-lenient.json', import.meta.url), 'utf8')
  const parsed = parseBotsFile(fixture)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const byName = new Map(parsed.rows.map((row) => [row.name, row]))
  const http = byName.get('Http Bot')
  const app = byName.get('App Bot')
  const plain = byName.get('Plain Bot')
  const sketch = byName.get('Sketch Bot')
  const mail = byName.get('Mail Bot')
  const ledger = byName.get('Ledger Bot')
  assert.equal(http?.error, '')
  assert.equal(http?.note, '')
  assert.equal(http?.grokBotUrl, 'https://example.com/grok/http-bot')
  assert.deepEqual(http?.owns, ['Match the invoice to the purchase order'])
  assert.deepEqual(http?.may, ['Read the bill', 'Read the purchase order'])
  assert.deepEqual(http?.needsApproval, ['Pay the vendor', 'Send a legal notice'])
  assert.deepEqual(http?.doneWhen, ['The match is recorded The vendor is paid'])
  assert.equal(app?.error, '')
  assert.equal(app?.note, '')
  assert.equal(app?.grokBotUrl, 'grokbot://app/v1/agent?id=abc123')
  assert.equal(app?.reportsTo, 'Http Bot')
  assert.deepEqual(app?.may, ['1', 'true'])
  assert.deepEqual(app?.needsApproval, [])
  assert.deepEqual(app?.owns, [])
  assert.deepEqual(app?.doneWhen, ['12'])
  assert.equal(plain?.error, '')
  assert.equal(plain?.note, 'grokBotUrl was left out.')
  assert.equal(plain?.grokBotUrl, '')
  assert.deepEqual(plain?.owns, [])
  assert.deepEqual(plain?.doneWhen, [])
  assert.equal(sketch?.note, 'grokBotUrl was left out.')
  assert.deepEqual(sketch?.owns, ['Chase the unpaid invoice', 'Record the reply'])
  assert.equal(mail?.note, 'grokBotUrl was left out.')
  assert.deepEqual(mail?.may, ['Read the inbox'])
  assert.equal(ledger?.error, '')
  assert.equal(ledger?.note, '')
  assert.equal(ledger?.reportsTo, 'App Bot')
  assert.equal(parsed.rows.filter((row) => row.note).length, 3)
  assert.equal(parsed.rows.every((row) => row.error === ''), true)

  const nameless = parseBotsFile(JSON.stringify({ bots: [{ grokBotUrl: 'https://example.com/bot' }, ...JSON.parse(fixture).bots] }))
  assert.equal(nameless.ok, true)
  if (!nameless.ok) return
  assert.equal(nameless.rows[0]?.error, 'Name is required.')
  const loose = parseBotsFile(JSON.stringify({
    bots: [{ name: 'Count Bot', grokBotUrl: 5, owns: [1, { keep: true }], doneWhen: 0, extra: true }],
  }))
  assert.equal(loose.ok, true)
  if (!loose.ok) return
  assert.equal(loose.rows[0]?.error, '')
  assert.equal(loose.rows[0]?.note, 'grokBotUrl was left out.')
  assert.deepEqual(loose.rows[0]?.owns, ['1', '{"keep":true}'])
  assert.deepEqual(loose.rows[0]?.doneWhen, ['0'])
  assert.equal(parseBotsFile('not json').ok, false)
  assert.equal(parseBotsFile('{"name":"Invoice Bot"}').ok, false)

  const dir = mkdtempSync(join(tmpdir(), 'be-bots-lenient-'))
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const result = importBotsFile(root, created.slug, parsed.rows)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.imported.map((item) => item.name), ['Http Bot', 'App Bot', 'Plain Bot', 'Sketch Bot', 'Mail Bot', 'Ledger Bot'])
  const loaded = readOrgDir(root, created.slug)
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const seats = new Map(loaded.bundle.seats.map((seat) => [seat.title, seat]))
  const appSeat = seats.get('App Bot')
  assert.equal(appSeat?.grokBotUrl, 'grokbot://app/v1/agent?id=abc123')
  assert.equal(appSeat?.reportsTo, seats.get('Http Bot')?.slug)
  assert.deepEqual(appSeat?.may, ['1', 'true'])
  assert.deepEqual(appSeat?.doneWhen, ['12'])
  assert.equal(seats.get('Plain Bot')?.grokBotUrl, '')
  assert.deepEqual(seats.get('Http Bot')?.mustAskBefore, ['Pay the vendor', 'Send a legal notice'])
  assert.equal(seats.get('Ledger Bot')?.reportsTo, appSeat?.slug)
  const again = parseBotsFile(exportBotsFile(loaded.bundle.seats))
  assert.equal(again.ok, true)
  if (again.ok) {
    assert.equal(again.rows.find((row) => row.name === 'App Bot')?.grokBotUrl, 'grokbot://app/v1/agent?id=abc123')
    assert.equal(again.rows.find((row) => row.name === 'Plain Bot')?.grokBotUrl, '')
    assert.equal(again.rows.find((row) => row.name === 'Plain Bot')?.note, '')
  }
  const skipped = importBotsFile(root, created.slug, nameless.rows)
  assert.equal(skipped.imported.some((item) => item.name === 'Bot 1'), false)
  assert.equal(skipped.errors.some((item) => item.error === 'Name is required.'), true)
  rmSync(dir, { recursive: true, force: true })
})

test('performance fields are optional, lenient, and round-trip through the seat file', () => {
  const parsed = parseBotsFile(JSON.stringify({
    bots: [{
      name: 'Invoice Bot',
      reportsTo: 'You',
      owns: ['Match the invoice'],
      createdAt: '2026-03-02',
      lastActive: '2026-10-17T19:32:00Z',
      runs30d: '14',
      tasksDone30d: 9,
      status: 'paused',
      routines: [
        { name: 'Invoice arrives', trigger: 'email', lastRun: '2026-10-17T19:32:00Z' },
        { schedule: 'weekly' },
        { name: 'Bad run', lastRun: 'nope' },
      ],
    }, {
      name: 'Quiet Bot',
      runs30d: 'many',
      tasksDone30d: -1,
      createdAt: 'yesterday',
      lastActive: 5,
      status: 'asleep',
      routines: 'none',
    }],
  }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const invoice = parsed.rows.find((row) => row.name === 'Invoice Bot')
  const quiet = parsed.rows.find((row) => row.name === 'Quiet Bot')
  assert.equal(invoice?.createdAt, '2026-03-02')
  assert.equal(invoice?.lastActive, '2026-10-17T19:32:00.000Z')
  assert.equal(invoice?.runs30d, 14)
  assert.equal(invoice?.tasksDone30d, 9)
  assert.equal(invoice?.botStatus, 'paused')
  assert.equal(invoice?.routines.length, 2)
  assert.equal(invoice?.routines[0]?.schedule, '', 'email is how it starts, not a schedule')
  assert.equal(invoice?.routines[0]?.trigger, 'email')
  assert.match(invoice?.note ?? '', /routines: some entries were left out/)
  assert.equal(invoice?.error, '')
  assert.equal(quiet?.runs30d, undefined)
  assert.equal(quiet?.tasksDone30d, undefined)
  assert.equal(quiet?.createdAt, '')
  assert.equal(quiet?.lastActive, '')
  assert.equal(quiet?.botStatus, '')
  assert.deepEqual(quiet?.routines, [])
  assert.match(quiet?.note ?? '', /runs30d was left out/)
  assert.match(quiet?.note ?? '', /tasksDone30d was left out/)
  assert.match(quiet?.note ?? '', /createdAt was left out/)
  assert.match(quiet?.note ?? '', /lastActive was left out/)
  assert.match(quiet?.note ?? '', /status was left out/)
  assert.match(quiet?.note ?? '', /routines was left out/)
  assert.equal(quiet?.error, '')

  const dir = mkdtempSync(join(tmpdir(), 'be-bots-perf-'))
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  const imported = importBotsFile(root, created.slug, parsed.rows)
  assert.deepEqual(imported.errors, [])
  const loaded = readOrgDir(root, created.slug)
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const seat = loaded.bundle.seats.find((item) => item.title === 'Invoice Bot')
  assert.equal(seat?.createdAt, '2026-03-02')
  assert.equal(seat?.lastActive, '2026-10-17T19:32:00.000Z')
  assert.equal(seat?.runs30d, 14)
  assert.equal(seat?.tasksDone30d, 9)
  assert.equal(seat?.botStatus, 'paused')
  assert.equal(seat?.status, 'active')
  assert.equal(seat?.routines?.[0]?.name, 'Invoice arrives')
  const file = readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8')
  assert.match(file, /createdAt: 2026-03-02/)
  assert.match(file, /runs30d: 14/)
  assert.match(file, /botStatus: paused/)
  const exported = parseBotsFile(exportBotsFile(loaded.bundle.seats))
  assert.equal(exported.ok, true)
  if (!exported.ok) return
  const again = exported.rows.find((row) => row.name === 'Invoice Bot')
  assert.equal(again?.createdAt, '2026-03-02')
  assert.equal(again?.lastActive, '2026-10-17T19:32:00.000Z')
  assert.equal(again?.runs30d, 14)
  assert.equal(again?.tasksDone30d, 9)
  assert.equal(again?.botStatus, 'paused')
  assert.equal(again?.routines[0]?.schedule, '')
  assert.equal(again?.routines[0]?.trigger, 'email', 'Export keeps how a routine starts')
  assert.equal(again?.routines[0]?.lastRun, '2026-10-17T19:32:00.000Z')
  const quietAgain = exported.rows.find((row) => row.name === 'Quiet Bot')
  assert.equal(quietAgain?.createdAt, '')
  assert.equal(quietAgain?.runs30d, undefined)
  assert.equal(exportBotsFile(loaded.bundle.seats).includes('"runs30d"'), true)
  assert.equal(exportBotsFile([loaded.bundle.seats.find((item) => item.title === 'Quiet Bot')!]).includes('runs30d'), false)
  rmSync(dir, { recursive: true, force: true })
})

test('a bots file may name each bot\'s sidebar section, and it imports without a note', () => {
  const parsed = parseBotsFile(JSON.stringify({ bots: [{ name: 'Clip Bot', section: 'aurafarming' }] }))
  assert.ok(parsed.ok)
  assert.equal(parsed.rows[0]!.error, '')
  assert.equal(parsed.rows[0]!.note, '', 'a section imports without a note')
})

test('the bots file template explains itself to a person or any AI, covers every field, and imports clean', () => {
  const text = readFileSync(fileURLToPath(new URL('../../public/bots-file-template.json', import.meta.url)), 'utf8')
  const file = JSON.parse(text) as { readme?: unknown; fields?: Record<string, string>; bots?: Record<string, unknown>[] }
  assert.ok(Array.isArray(file.readme) && file.readme.every((line) => typeof line === 'string'), 'readme is a list of lines')
  assert.match((file.readme as string[]).join(' '), /any AI/)
  assert.match((file.readme as string[]).join(' '), /reportsTo is You or another bot in this file\./)
  // Every field a bots file can carry, as the import reads it.
  const promptFields = ['name', 'grokBotUrl', 'section', 'reportsTo', 'alsoReportsTo', 'owns', 'may', 'needsApproval', 'doneWhen', 'createdAt', 'lastActive', 'runs30d', 'tasksDone30d', 'routines', 'skills', 'publicUrl', 'status']
  assert.deepEqual(Object.keys(file.fields ?? {}), promptFields, 'the field guide matches the Grok Bot import prompt, field for field')
  const bots = file.bots ?? []
  assert.ok(bots.length >= 3)
  for (const bot of bots) {
    for (const key of ['name', 'reportsTo', 'owns', 'may', 'needsApproval', 'doneWhen']) assert.ok(key in bot, `${String(bot.name)} has ${key}`)
    for (const key of ['createdAt', 'lastActive', 'runs30d', 'tasksDone30d', 'grokBotUrl', 'publicUrl', 'status']) assert.equal(key in bot, false, `${String(bot.name)} invents no ${key}`)
    assert.match(String(bot.name), /^Northwind /, 'example names cannot match a real bot by accident')
  }
  const routines = bots.flatMap((bot) => (Array.isArray(bot.routines) ? bot.routines as Record<string, unknown>[] : []))
  assert.ok(routines.some((item) => item.trigger === 'schedule' && typeof item.schedule === 'string'), 'a scheduled routine')
  assert.ok(routines.some((item) => item.trigger !== 'schedule' && typeof item.event === 'string'), 'an event routine')
  assert.ok(bots.some((bot) => Array.isArray(bot.skills) && bot.skills.length > 0), 'a skill')
  const parsed = parseBotsFile(text)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.rows.map((row) => row.error), bots.map(() => ''))
  const dir = mkdtempSync(join(tmpdir(), 'be-template-'))
  try {
    const made = createOrgFiles(dir, 'Northwind', 'You')
    assert.ok(made.ok)
    const result = importBotsFile(join(dir, made.slug), made.slug, parsed.rows)
    assert.deepEqual(result.errors, [], 'every manager resolves: You or a bot in the file')
    assert.equal(result.imported.length, bots.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Option 2 gives a prompt for any AI with the template, then imports the file it writes; Export lives in Step 2 once the organization has bots', () => {
  const page = readFileSync(new URL('../../src/components/BotsFileImport.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /Export bots file/, 'an empty organization has nothing to export')
  assert.match(page, /prompt=\{botsFilePrompt\(localTimeZone\(\)\)\}/)
  assert.match(page, /pasteTitle="Step 1\. Paste this prompt into any AI, with the template"/)
  assert.match(page, /copyActions=\{<Button variant="secondary" href="\/bots-file-template\.json" download="bots\.json">Download bots file template<\/Button>\}/)
  assert.match(page, /importTitle="Step 2\. Import the \.json file it writes"/)
  const steps = readFileSync(new URL('../../src/components/GrokBotsPrompt.tsx', import.meta.url), 'utf8')
  assert.match(steps, /prompt: string\n  pasteTitle: string\n  importTitle: string/, 'every caller passes its own prompt and titles')
})

test('the prompt for any AI interviews the owner and waits for a yes before it writes the bots file', async () => {
  const { BOTS_FILE_PROMPT, botsFilePrompt } = await import('../../src/content/bots-file-prompt.ts')
  assert.match(BOTS_FILE_PROMPT, /Before you write anything, interview me with the questions below, as you would to set up a real organization\. Ask them in order, a few at a time, and wait for my answers\. Ask a follow-up question when an answer is vague, and skip any question I already answered\./)
  const questions = BOTS_FILE_PROMPT.split('\n').filter((line) => /^\d+\. /.test(line))
  assert.ok(questions.length >= 14, `real questions, not topics: ${questions.length}`)
  for (const line of questions) assert.match(line, /\?$/, `asked as a question: ${line}`)
  for (const asked of ['What is your organization called?', 'What must a bot never do without your OK, such as spending money, signing or changing a contract, sharing personal data, sending a message to a client, or publishing anything?', 'For each job a bot takes, what does done look like?', 'How many bots do you want to start with?']) {
    assert.ok(questions.some((line) => line.endsWith(asked)), `asks: ${asked}`)
  }
  assert.match(BOTS_FILE_PROMPT, /Then show me the bots you propose as a short list: name, what it owns, and who it reports to\. Wait for my OK or my changes\. Don't write the file until I confirm\./)
  assert.match(BOTS_FILE_PROMPT, /Put your assumptions and notes in your reply, not in the file\./)
  assert.doesNotMatch(BOTS_FILE_PROMPT, /10 or fewer/, 'the owner decides how many bots')
  assert.match(BOTS_FILE_PROMPT, /on an event from email, slack, github, webhook, microsoftTeams, linear, sentry, or pagerduty\. Nothing else\./, 'only starts the app keeps')
  assert.match(BOTS_FILE_PROMPT, /with a cron line and my IANA time zone as timeZone/)
  assert.match(botsFilePrompt('Europe/Madrid'), /with a cron line and timeZone "Europe\/Madrid"/)
  assert.doesNotMatch(BOTS_FILE_PROMPT, /\bcompany\b/i)
  const docs = readFileSync(new URL('../../docs/bots-file.md', import.meta.url), 'utf8')
  assert.equal(docs.includes(BOTS_FILE_PROMPT), true, 'docs/bots-file.md carries the same prompt')
})

test('the template tells an AI to ask first, to leave status out for new bots, and why names start with the organization', () => {
  const file = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/bots-file-template.json', import.meta.url)), 'utf8')) as { readme: string[]; fields: Record<string, string> }
  assert.equal(file.readme[0], 'If you are an AI reading this file: follow instructions, the next list in this file, step by step. Interview the owner, show the bots you propose, and write nothing until the owner confirms.')
  assert.ok(file.readme.includes('Put your assumptions and notes in your reply, not in this file.'))
  assert.match(file.fields.status!, /Leave it out for a new bot: Grok Bot creates it active\. To start a routine paused, set its enabled to false\./)
  assert.match(file.fields.name!, /Start it with a short form of the organization's name, like the Northwind examples, so it cannot match a bot you already run in Grok Bot\./)
})

test('a bots file from any AI imports: a byte-order mark, Windows line endings, or a reply with one json code block', () => {
  const file = JSON.stringify({ bots: [{ name: 'Acme Lead Bot', reportsTo: 'You', owns: ['New leads'] }] }, null, 2)
  const marked = parseBotsFile(`﻿${file.replace(/\n/g, '\r\n')}\r\n`)
  assert.ok(marked.ok, 'a byte-order mark and CRLF are fine')
  if (marked.ok) assert.equal(marked.rows[0]!.name, 'Acme Lead Bot')
  const reply = `Here is your file. I assumed sales only.\n\n\`\`\`json\n${file}\n\`\`\`\n\nImport it on Connect bots.`
  const fenced = parseBotsFile(reply)
  assert.ok(fenced.ok, 'the json block inside an AI reply')
  if (fenced.ok) assert.equal(fenced.rows[0]!.name, 'Acme Lead Bot')
  const prose = parseBotsFile('Sorry, I cannot write that file.')
  assert.equal(prose.ok, false)
  if (!prose.ok) assert.deepEqual(prose.errors, ['This file is not JSON.'])
})

test('the prompt and template work with any AI: the template attached or pasted, the file back as a file or one code block', async () => {
  const { BOTS_FILE_PROMPT } = await import('../../src/content/bots-file-prompt.ts')
  assert.match(BOTS_FILE_PROMPT, /^I want to set up my organization in BotsEverywhere, an open source tool that runs a team of bots in Grok Bot\. These instructions come with the BotsEverywhere bots file template \(bots\.json\): attached, pasted, or the file you are reading\. Read its readme and fields: they are the rules for the file\./)
  assert.match(BOTS_FILE_PROMPT, /- Put your assumptions and notes in your reply, not in the file\. Write them first, then the file: as a file named botseverywhere-bots\.json if you can, otherwise the JSON alone in one code block\.$/)
  assert.equal(BOTS_FILE_PROMPT.split('assumptions and notes').length, 2, 'said once')
  assert.doesNotMatch(BOTS_FILE_PROMPT, /Return only the JSON/, 'no clash with notes in the reply')
  const file = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/bots-file-template.json', import.meta.url)), 'utf8')) as { readme: string[] }
  assert.ok(file.readme.some((line) => /any AI \(Claude, ChatGPT, Gemini, Codex, Grok Bot, or another\)/.test(line)))
})

test('the template carries the whole prompt, so any AI given only the file interviews the owner and writes it', async () => {
  const { BOTS_FILE_PROMPT } = await import('../../src/content/bots-file-prompt.ts')
  const file = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/bots-file-template.json', import.meta.url)), 'utf8')) as Record<string, unknown>
  assert.deepEqual(Object.keys(file), ['readme', 'instructions', 'fields', 'bots'], 'readme first, then the instructions an AI follows')
  assert.ok(Array.isArray(file.instructions) && file.instructions.every((line) => typeof line === 'string'))
  assert.equal((file.instructions as string[]).join('\n'), BOTS_FILE_PROMPT, 'the same words as Copy prompt, line for line')
  assert.ok((file.readme as string[]).includes('Only the bots list is imported. readme, instructions, and fields are for you and the AI, and the import skips them.'))
  const parsed = parseBotsFile(JSON.stringify(file))
  assert.ok(parsed.ok, 'the import still reads only bots')
})

test('an event routine keeps an empty schedule; an old file that wrote the schedule in trigger still loads', () => {
  const parsed = parseBotsFile(JSON.stringify({ bots: [{ name: 'Acme Inquiry Bot', routines: [
    { name: 'Answer an inquiry', trigger: 'email', event: 'A new inquiry arrives by email', enabled: true },
    { name: 'Morning sweep', trigger: 'schedule', schedule: '0 8 * * 1-5', timeZone: 'Europe/Madrid' },
    { name: 'Old weekly', trigger: 'Mondays 09:00' },
  ] }] }))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  const [event, scheduled, old] = parsed.rows[0]!.routines
  assert.equal(event!.schedule, '', 'email is how it starts, not when')
  assert.equal(event!.trigger, 'email')
  assert.equal(event!.event, 'A new inquiry arrives by email')
  assert.equal(scheduled!.schedule, '0 8 * * 1-5')
  assert.equal(old!.schedule, 'Mondays 09:00', 'an older file\'s schedule in words still loads')
})

test('Export writes every routine detail, so export then import gives back the same routines', () => {
  const routines = [
    { name: 'Morning sweep', schedule: '0 8 * * 1-5', description: 'Sweeps new leads', trigger: 'schedule' as const, timeZone: 'Europe/Madrid', lastRun: '2026-10-26T08:00:00.000Z' },
    { name: 'Answer an inquiry', schedule: '', description: 'Replies to email', trigger: 'email' as const, event: 'A new inquiry arrives by email', enabled: false },
  ]
  const seat = { slug: 'acme-bot', title: 'Acme Bot', kind: 'bot', status: 'active', reportsTo: 'you', grokBotUrl: '', owns: ['a'], may: [], mustAskBefore: [], doneWhen: [], routines }
  const back = parseBotsFile(exportBotsFile([seat as never]))
  assert.ok(back.ok)
  if (back.ok) assert.deepEqual(back.rows[0]!.routines, routines)
})

test('a list item with a semicolon stays one line; a single string is still split on "; "', () => {
  const parsed = parseBotsFile(JSON.stringify({ bots: [
    { name: 'CTV2 Captación Alicante', owns: ['Crear una línea base en la primera ejecución; en ejecuciones posteriores identificar anuncios nuevos.'], may: 'Read the inbox; flag a mismatch' },
  ] }))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  assert.deepEqual(parsed.rows[0]!.owns, ['Crear una línea base en la primera ejecución; en ejecuciones posteriores identificar anuncios nuevos.'])
  assert.deepEqual(parsed.rows[0]!.may, ['Read the inbox', 'flag a mismatch'])
})

test('Step 2 shows the LLM ways in as a badge after the title, not in parentheses', async () => {
  // tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global.
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { LinkCompany } = await import('../../src/components/LinkCompany.tsx')
  const html = renderToStaticMarkup(React.createElement(LinkCompany, {
    slug: 'org-test',
    seats: [],
    onImported: async () => undefined,
    onAddSeat: () => undefined,
    onAddExisting: () => undefined,
    onCompanyFields: () => undefined,
  }))
  const summary = (id: string) => new RegExp(String.raw`<details[^>]*id="${id}"[^>]*><summary>([\s\S]*?)</summary>`).exec(html)?.[1] ?? ''
  assert.match(summary('import-from-template'), /Option 2<\/span>Import from a template \.json<span class="dir-pill link-panel-badge">build an organization from an interview with an LLM<\/span>/)
  assert.doesNotMatch(summary('import-from-template'), /[()]/, 'no parentheses')
  assert.doesNotMatch(summary('import-from-grok'), /link-panel-badge/, 'no empty badge')
  assert.deepEqual([...html.matchAll(/<details[^>]*id="([^"]+)"/g)].map((match) => match[1]), ['import-from-grok', 'import-from-template'], 'Options 1 and 2 only')
})
