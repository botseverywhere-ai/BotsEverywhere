import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { OrgBundle } from '../src/org-files.ts'
import { parseProcessMarkdown } from '../src/processes.ts'
import { createOrgFiles, readOrgDir } from '../src/template-server.ts'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

async function withOrg(run: (bundle: OrgBundle) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'be-chart-png-'))
  try {
    const created = createOrgFiles(dir, 'Acme Studio', 'Ana Ruiz')
    assert.ok(created.ok)
    const read = readOrgDir(resolve(dir, created.slug), created.slug)
    assert.ok(read.ok)
    await run(read.bundle)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const WEEKLY = parseProcessMarkdown('weekly-brief', `---
name: Weekly brief
trigger: schedule
schedule: 0 9 * * 1
description: ""
doneWhen: The brief is sent
---

## Steps

- you | Write the brief

## Notes
`)

test('the PNG is named after the organization, never its folder', async () => {
  const { pngFileName } = await import('../../src/components/chart-png.ts')
  assert.equal(pngFileName('BotsEverywhere', 'org'), 'BotsEverywhere org chart.png')
  assert.equal(pngFileName('BotsEverywhere', 'work'), 'BotsEverywhere work chart.png')
  assert.equal(pngFileName('Acme / R&D: "Ops"', 'org'), 'Acme R&D Ops org chart.png', 'characters a file name cannot hold are dropped')
  assert.equal(pngFileName('   ', 'work'), 'Organization work chart.png')
})

test('Download PNG stays after Retired only while it fits before Find seat; otherwise it joins the Add a seat row', async () => {
  const { legendHasRoom } = await import('../../src/components/chart-png.ts')
  // Measured at 1440px: the legend ends at 610 and the button is 134 wide. 12px before the button and 12px after it.
  assert.equal(legendHasRoom({ floating: true, legendRight: 610, buttonWidth: 134, toolbarLeft: 1045 }), true, 'a wide chart')
  assert.equal(legendHasRoom({ floating: true, legendRight: 610, buttonWidth: 134, toolbarLeft: 665 }), false, 'the seat panel is open')
  assert.equal(legendHasRoom({ floating: true, legendRight: 610, buttonWidth: 134, toolbarLeft: 768 }), true, 'just fits')
  assert.equal(legendHasRoom({ floating: true, legendRight: 610, buttonWidth: 134, toolbarLeft: 767 }), false, 'one pixel short')
  assert.equal(legendHasRoom({ floating: false, legendRight: 610, buttonWidth: 134, toolbarLeft: 1045 }), false, 'phones: the legend sits above the chart')
})

test('your own org chart has Download PNG right after Retired on the legend; templates have none', async () => {
  const { OrgChart } = await import('../../src/components/OrgChart.tsx')
  const { companyFromBundle } = await import('../../src/org/company.ts')
  await withOrg(async (bundle) => {
    const base = { seats: companyFromBundle(bundle).seats, selectedId: '', onSelect: () => undefined }
    const own = await render(OrgChart, { ...base, retired: { count: 0, onOpen: () => undefined }, png: { orgName: 'Acme Studio' } })
    const legend = /<ul class="org-legend">[\s\S]*?<\/ul>/.exec(own)?.[0] ?? ''
    assert.match(legend, /Retired[\s\S]*?<\/li><li class="org-legend-png"><button[^>]*>Download PNG<\/button>/)
    assert.doesNotMatch(await render(OrgChart, base), /Download PNG/)
  })
})

test('your own work chart has Download PNG right next to the Work Chart title, once there is a process to draw', async () => {
  const { ProcessChart } = await import('../../src/components/ProcessChart.tsx')
  assert.ok(WEEKLY.ok)
  await withOrg(async (bundle) => {
    const base = { orgId: bundle.id, editable: true, seats: bundle.seats, processes: [WEEKLY.process], onSeat: () => undefined, onReload: async () => undefined }
    const png = { orgName: 'Acme Studio' }
    const own = await render(ProcessChart, { ...base, png })
    assert.match(own, /<div class="process-title"><h1>Work Chart<\/h1><button[^>]*>Download PNG<\/button><\/div>/, 'beside the title, outside the heading')
    assert.match(own, /<p class="process-fallback">Unmatched work uses triage, owned by You\.<\/p>/, 'the line under the title is text again')
    assert.doesNotMatch(await render(ProcessChart, base), /Download PNG/, 'templates have none')
    assert.doesNotMatch(await render(ProcessChart, { ...base, processes: [], png }), /Download PNG/, 'nothing to draw yet')
  })
})

test('only your own orgs get the button: Workspace passes the organization name when the org is editable', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.equal(workspace.match(/png=\{editable \? \{ orgName: company\.org\.name \} : undefined\}/g)?.length, 2, 'on the org chart and the work chart')
})
