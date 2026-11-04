import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadCompanies, orgsEndpoint, withCurrent, writerApiOrigin } from '../../src/org/company-list.ts'
import { newCompanyHref, orgSwitchHref } from '../../src/org/switch-org.ts'
import { createOrgFiles, listOrgSlugs, readOrgDir, startTemplateServer } from '../src/template-server.ts'

test('switching keeps the open tab and a new company opens the overview', () => {
  assert.equal(orgSwitchHref('acme', 'org-chart'), '#/org/acme/org-chart')
  assert.equal(orgSwitchHref('acme', 'work-chart'), '#/org/acme/work-chart')
  assert.equal(orgSwitchHref('acme', 'performance'), '#/org/acme/performance')
  assert.equal(orgSwitchHref('acme', 'logs'), '#/org/acme/logs')
  assert.equal(orgSwitchHref('acme', 'overview'), '#/org/acme/overview')
  assert.equal(newCompanyHref('new-company'), '#/org/new-company/overview')

  const workspace = readFileSyncUrl('../../src/pages/Workspace.tsx')
  const switcher = readFileSyncUrl('../../src/components/OrgSwitcher.tsx')
  const list = readFileSyncUrl('../../src/org/company-list.ts')
  const files = readFileSyncUrl('../../src/components/OrgFiles.tsx')
  const dev = readFileSyncUrl('../../scripts/dev-all.ts')
  const css = readFileSyncUrl('../../src/styles/app.css')
  const tokens = readFileSyncUrl('../../src/styles/tokens.css')
  assert.match(workspace, /APP_MODE === 'template' && !sample \? <OrgSwitcher slug=\{bundle\.id\} name=\{company\.org\.name\} tab=\{tabForView\(view\)\} \/>/)
  const switchAt = workspace.indexOf('<OrgSwitcher')
  const tabsAt = workspace.indexOf('<OrgTabs')
  assert.ok(switchAt > -1 && tabsAt > switchAt)
  assert.match(switcher, /aria-label="Organization"/)
  assert.match(switcher, /\+ New organization/)
  assert.match(switcher, /APP_MODE !== 'template'\) return null/)
  assert.match(switcher, /showPicker/)
  assert.match(switcher, /loadCompanies\(writerApiOrigin\(\)\)/)
  assert.match(switcher, /onMouseDown/)
  assert.match(list, /\/api\/orgs/)
  assert.match(list, /cache: 'no-store'/)
  assert.match(files, /companiesChanged\(\)/)
  assert.match(dev, /VITE_WRITER_PORT: String\(writerPort\)/)
  assert.equal(writerApiOrigin('8788'), 'http://127.0.0.1:8788')
  assert.equal(writerApiOrigin(''), '')
  assert.equal(orgsEndpoint('http://127.0.0.1:8788'), 'http://127.0.0.1:8788/api/orgs')
  assert.equal(orgsEndpoint(''), '/api/orgs')
  assert.equal(switcher.includes('samples/'), false)
  assert.match(switcher, /orgSwitchHref/)
  assert.match(switcher, /newCompanyHref/)
  assert.match(files, /This replaces everything in this org/)
  assert.match(files, /window\.confirm\('This replaces everything in this org'\)/)
  assert.match(css, /\.org-switch select \{[^}]*height: var\(--btn-height\)/)
  assert.match(css, /\.org-switch select \{[^}]*border-radius: var\(--control-radius\)/)
  assert.match(tokens, /--select-chevron:/)
  assert.match(tokens, /select \{[^}]*appearance:\s*none/)
  assert.match(tokens, /select \{[^}]*height:\s*var\(--btn-height\)/)
  assert.match(tokens, /select \{[^}]*background-image:\s*var\(--select-chevron\)/)
  assert.match(tokens, /select \{[^}]*background-size:\s*var\(--select-chevron-size\)/)
})

test('the company list is only folders under orgs, with the name from org.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-switch-'))
  const samples = join(dir, 'samples', 'harbor')
  mkdirSync(join(samples, 'seats'), { recursive: true })
  writeFileSync(join(samples, 'org.md'), '---\nname: Harbor\n---\n\n## Chart\n- you\n')
  const first = createOrgFiles(dir, 'North office', 'Ada')
  const second = createOrgFiles(dir, 'South office', 'Bea')
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  mkdirSync(join(dir, 'not-an-org'))
  const listed = listOrgSlugs(dir)
  assert.deepEqual(listed, [first.slug, second.slug].sort())
  assert.equal(listed.includes('harbor'), false)
  assert.equal(listed.includes('samples'), false)
  const north = readOrgDir(join(dir, first.slug), first.slug)
  assert.equal(north.ok, true)
  if (north.ok) assert.equal(north.bundle.org.company.name, 'North office')

  const sampleNames = readdirSync(new URL('../../samples', import.meta.url)).filter((name) => name !== 'README.md')
  for (const name of sampleNames) assert.equal(listed.includes(name), false)

  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs`)
    const body = await response.json() as { orgs: { slug: string; name: string }[] }
    assert.equal(response.status, 200)
    assert.deepEqual(body.orgs.map((item) => item.slug).sort(), listed)
    assert.equal(body.orgs.find((item) => item.slug === first.slug)?.name, 'North office')
    assert.equal(body.orgs.find((item) => item.slug === second.slug)?.name, 'South office')
    assert.equal(body.orgs.some((item) => item.slug === 'harbor'), false)
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the menu lists both orgs after reload and a third without one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-switch-live-'))
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  const origin = `http://127.0.0.1:${started.port}`
  try {
    const north = await createCompany(origin, 'North office')
    const south = await createCompany(origin, 'South office')
    const reloaded = await loadCompanies(origin)
    assert.deepEqual(reloaded.map((item) => item.name).sort(), ['North office', 'South office'])
    assert.deepEqual(reloaded.map((item) => item.slug).sort(), [north, south].sort())
    const east = await createCompany(origin, 'East office')
    const live = withCurrent(await loadCompanies(origin), { slug: east, name: 'East office' })
    assert.deepEqual(live.map((item) => item.name).sort(), ['East office', 'North office', 'South office'])
    const cors = await fetch(orgsEndpoint(origin), { headers: { origin: 'http://127.0.0.1:5199' } })
    assert.equal(cors.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5199')
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

async function createCompany(origin: string, name: string): Promise<string> {
  const response = await fetch(orgsEndpoint(origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, owner: 'You' }),
  })
  const body = (await response.json()) as { slug?: string; errors?: string[] }
  assert.equal(response.status, 201, body.errors?.join(' '))
  assert.ok(body.slug)
  return body.slug
}

function readFileSyncUrl(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}
