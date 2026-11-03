import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import type { OrgBundle } from '../src/org-files.ts'
import type { ProcessFile } from '../src/processes.ts'
import { createOrgFiles, readOrgDir } from '../src/template-server.ts'
import { processesFolder } from '../../src/org/folder-path.ts'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

async function withOrg(run: (bundle: OrgBundle) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'be-import-status-'))
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

const flow = (name: string): ProcessFile => ({
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  trigger: { type: 'schedule', schedule: '0 9 * * 1', source: '', description: '' },
  steps: [{ seat: 'you', action: 'Read the week' }],
  doneWhen: '',
  next: '',
  notes: '',
})

/** The Work Chart's Import processes from Grok Bot panel, for an organization of your own with these processes. */
async function importPanel(bundle: OrgBundle, processes: ProcessFile[]): Promise<{ summary: string; body: string }> {
  const { ProcessChart } = await import('../../src/components/ProcessChart.tsx')
  const html = await render(ProcessChart, { orgId: bundle.id, editable: true, seats: bundle.seats, processes, onSeat: () => undefined, onReload: async () => undefined })
  const panel = /<details class="link-panel"[^>]*>[\s\S]*?<\/details>/.exec(html)?.[0] ?? ''
  assert.match(panel, /Import processes from Grok Bot/, 'the panel is on the page')
  return { summary: /<summary>[\s\S]*?<\/summary>/.exec(panel)?.[0] ?? '', body: panel.replace(/<summary>[\s\S]*?<\/summary>/, '') }
}

test('the Import processes panel says Not imported on its title line until the organization has a process, then Imported in green', async () => {
  await withOrg(async (bundle) => {
    const before = await importPanel(bundle, [])
    assert.match(before.summary, /<span class="connect-badge[^"]*"><i aria-hidden="true"><\/i>Not imported<\/span>/, 'seen while the panel is closed')
    assert.doesNotMatch(before.summary, /is-connected/, 'not green before an import')
    const after = await importPanel(bundle, [flow('Weekly brief')])
    assert.match(after.summary, /<span class="connect-badge[^"]*\bis-connected\b[^"]*"><i aria-hidden="true"><\/i>Imported<\/span>/)
    assert.doesNotMatch(after.summary, /Not imported/)
  })
})

test('the panel says how many processes the organization has, as Step 2 says how many bots', async () => {
  await withOrg(async (bundle) => {
    const status = async (processes: ProcessFile[]) => /<dt>Status<\/dt><dd class="connect-status">[\s\S]*?<span class="connect-status-detail">([^<]*)<\/span>/.exec((await importPanel(bundle, processes)).body)?.[1]
    assert.equal(await status([]), 'No processes in this organization yet')
    assert.equal(await status([flow('Weekly brief')]), '1 process in this organization')
    assert.equal(await status([flow('Weekly brief'), flow('Invoice arrives')]), '2 processes in this organization')
  })
})

test("the panel names the organization's process files and where they sit, as Step 2 names the bot files", async () => {
  await withOrg(async (bundle) => {
    const { body } = await importPanel(bundle, [flow('Weekly brief')])
    const path = `orgs/${bundle.id}/processes`
    assert.match(body, new RegExp(`<dt>Process files</dt><dd class="connect-file"><code title="${path}">processes/</code><span>The work: what starts it and each step</span><span class="connect-file-fact">${path}</span></dd>`))
  })
})

test('an imported Work Chart can still copy the prompt and import a file again: a second import replaces processes of the same name', async () => {
  await withOrg(async (bundle) => {
    const { body } = await importPanel(bundle, [flow('Weekly brief')])
    assert.match(body, />Copy prompt<\/button>/)
    assert.match(body, />Import processes file<\/button>/)
  })
})

test("the processes folder keeps the separator of the organization's own path", () => {
  assert.equal(processesFolder('C:\\Users\\migue\\botseverywhere-v7\\orgs\\org-trav3fcs'), 'C:\\Users\\migue\\botseverywhere-v7\\orgs\\org-trav3fcs\\processes')
  assert.equal(processesFolder('/home/ana/botseverywhere/orgs/org-abcd2345/'), '/home/ana/botseverywhere/orgs/org-abcd2345/processes')
  assert.equal(processesFolder('orgs/org-abcd2345'), 'orgs/org-abcd2345/processes')
})
