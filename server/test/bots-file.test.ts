import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BOTS_FILE_TEMPLATE, exportBotsFile, parseBotsFile } from '../src/bots-file.ts'
import { GROK_BOTS_PROMPT } from '../../src/content/grok-bots-prompt.ts'
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
  assert.match(page, /Export bots file/)
  assert.match(page, /Download bots file template/)
  assert.match(page, /GrokBotsPrompt/)
  assert.match(page, /mode === 'template'/)
  const prompt = readFileSync(new URL('../../src/content/grok-bots-prompt.ts', import.meta.url), 'utf8')
  const docs = readFileSync(new URL('../../docs/bots-file.md', import.meta.url), 'utf8')
  const docsPage = readFileSync(new URL('../../src/pages/DocsPage.tsx', import.meta.url), 'utf8')
  const link = readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(prompt, /botseverywhere-bots\.json/)
  assert.match(docs, /botseverywhere-bots\.json/)
  assert.match(docs, /Paste this into Grok Bot/)
  assert.equal(docs.includes(GROK_BOTS_PROMPT), true)
  assert.match(docsPage, /GROK_BOTS_PROMPT/)
  assert.match(link, /How to link your organization to BotsEverywhere/)
  assert.match(link, /Import from your Grok Bot/)
  assert.match(link, /Import from a template \.json/)
  assert.match(link, /Add your organization manually/)
  assert.match(link, /option=\{1\} title="Import from your Grok Bot"/, 'each way in is numbered before its title')
  assert.match(link, /option=\{2\} title="Import from a template \.json"/)
  assert.match(link, /option=\{3\} title="Add your organization manually"/)
  assert.match(link, /<span className="link-panel-option">Option \{option\}<\/span>\{title\}/)
  assert.match(link, /current === id \? null : id/)
  assert.equal(workspace.includes('LinkCompany'), false)
  assert.equal(workspace.includes('How to link your organization to BotsEverywhere'), false)
  assert.match(page, /Nothing is written until you confirm/)
  assert.match(page, /Imported \$\{count\} bots/)
  assert.match(page, /\$\{bots\} imported, \$\{noteLabel\}/)
  assert.match(page, /Skipped \$\{item\.name\}: \$\{item\.error\}/)
  assert.match(page, /\$\{summary\}\. \$\{skipped\}/)
  assert.match(page, /className="bots-note"/)
  assert.match(prompt, /grokbot:\/\/\.\.\. is fine/)
  assert.match(prompt, /owns, may, and needsApproval are lists of short strings/)
  assert.match(prompt, /doneWhen is one string/)
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
  assert.match(panel, /Step 1\. Paste this prompt into Grok Bot/)
  assert.match(panel, /Step 2\. Import the Grok Bot \.json file/)
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
  const target = createOrgFiles(dir, 'South office', 'You')
  assert.equal(target.ok, true)
  if (!target.ok) return
  const targetRoot = join(dir, target.slug)
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
  assert.match(GROK_BOTS_PROMPT, /For each bot, also include only what you can actually see: createdAt, lastActive, runs30d, tasksDone30d, routines \(name \+ schedule or trigger \+ last run\), and status \(active, paused, or retired\)\./)
  assert.match(GROK_BOTS_PROMPT, /If you do not know a value, leave the field out\. Never estimate or invent numbers\./)
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
  assert.equal(invoice?.routines[0]?.schedule, 'email')
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
  assert.equal(again?.routines[0]?.schedule, 'email')
  assert.equal(again?.routines[0]?.lastRun, '2026-10-17T19:32:00.000Z')
  const quietAgain = exported.rows.find((row) => row.name === 'Quiet Bot')
  assert.equal(quietAgain?.createdAt, '')
  assert.equal(quietAgain?.runs30d, undefined)
  assert.equal(exportBotsFile(loaded.bundle.seats).includes('"runs30d"'), true)
  assert.equal(exportBotsFile([loaded.bundle.seats.find((item) => item.title === 'Quiet Bot')!]).includes('runs30d'), false)
  rmSync(dir, { recursive: true, force: true })
})
