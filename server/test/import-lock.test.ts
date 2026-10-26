import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { IMPORT_LOCKED, importLocked } from '../src/bots-file.ts'
import { createOrgFiles, readOrgDir, startTemplateServer } from '../src/template-server.ts'

const TEMPLATE = readFileSync(new URL('../../public/bots-file-template.json', import.meta.url), 'utf8')

test('an organization with bots is locked for import; You alone, or only the Connector, is not', () => {
  assert.equal(importLocked([{ kind: 'human', title: 'You' }]), false)
  assert.equal(importLocked([{ kind: 'human', title: 'You' }, { kind: 'bot', title: 'Connector - BotsEverywhere (uft5)' }]), false, 'the Connector only syncs files')
  assert.equal(importLocked([{ kind: 'human', title: 'You' }, { kind: 'bot', title: 'Invoice Bot' }]), true)
  assert.match(IMPORT_LOCKED, /already has bots, so importing again is off/)
})

test('the writer imports a bots file into an empty organization once, then refuses a second copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-import-lock-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const post = () => fetch(`http://127.0.0.1:${started.port}/api/orgs/${made.slug}/bots-file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: TEMPLATE })
    assert.equal((await post()).status, 200)
    const again = await post()
    assert.equal(again.status, 409)
    assert.equal(((await again.json()) as { error?: string }).error, IMPORT_LOCKED)
    const read = readOrgDir(join(orgs, made.slug), made.slug)
    assert.ok(read.ok)
    assert.deepEqual(read.bundle.seats.filter((seat) => seat.kind === 'bot').map((seat) => seat.slug).sort(), ['collections-bot', 'invoice-bot'], 'no second copy')
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Connect bots shows Step 2 in a box like Step 1 once the organization has bots: status, where the bot files are, and Export', async () => {
  const link = readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8')
  assert.match(link, /<section className=\{locked \? 'link-company connect-grok' : 'link-company dir-page'\}/)
  assert.match(link, /\{locked \? \(/)
  assert.match(link, /<p>\{IMPORT_LOCKED\}<\/p>\s*<dl className="connect-facts">/)
  assert.match(link, /<span className="connect-badge is-connected"><i aria-hidden="true" \/>Linked<\/span>\s*<span className="connect-status-detail">\{botsLine\(seats\)\}<\/span>/)
  assert.match(link, /<code title=\{seatsAt\}>\{FILE_NAMES\.seats\}<\/code>\s*<span>\{FILE_WHAT\.seats\}<\/span>\s*<span className="connect-file-fact">\{seatsAt\}<\/span>/)
  assert.match(link, /<Button variant="secondary" type="button" onClick=\{\(\) => downloadBotsFile\(seats\)\}>Export bots file<\/Button>/)
  assert.match(link, /<div className="dir-actions">\s*<Button variant="primary" type="button" onClick=\{onAddSeat\}>Add a seat<\/Button>\s*<Button variant="secondary" href="#\/directory">Bot directory<\/Button>/, 'Add a seat for a person or a bot, as on the org chart')
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  assert.match(overview, /onAddSeat=\{onAddSeat\}/)
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /onAddSeat=\{\(\) => setAdding\(true\)\}/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.link-company\.connect-grok \.dir-actions \{ margin-top: 0; \}/)
  const { seatsFolder } = await import('../../src/org/folder-path.ts')
  assert.equal(seatsFolder('C:\\Users\\migue\\app\\orgs\\your-company'), 'C:\\Users\\migue\\app\\orgs\\your-company\\seats')
  assert.equal(seatsFolder('/home/ana/app/orgs/desk'), '/home/ana/app/orgs/desk/seats')
  const { botsLine } = await import('../../src/components/file-guide-copy.ts')
  const bot = (title: string, status = 'active') => ({ kind: 'bot' as const, title, status })
  assert.equal(botsLine([bot('Invoice Bot'), bot('Old Bot', 'retired'), bot('Connector - BotsEverywhere (uft5)'), { kind: 'human' as const, title: 'You', status: 'active' }]), '1 bot in this organization')
  assert.equal(botsLine([bot('A'), bot('B')]), '2 bots in this organization')
  const docs = readFileSync(new URL('../../src/pages/DocsPage.tsx', import.meta.url), 'utf8')
  assert.match(docs, /These three options are for an organization with no bots yet\./)
})

test('adding a seat says so, with a link to the org chart, wherever it was added from', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /applyLoaded\(\(await loaded\.json\(\)\) as OrgBundle\)\s*setAdding\(false\)\s*setError\(''\)\s*setWriter\('up'\)\s*tell\(saveNotice\(true, `\$\{seat\.title\} was added`\), orgChartLink\)/)
})
