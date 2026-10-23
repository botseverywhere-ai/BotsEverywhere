import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isQuietOrgFile, orgFolders, quietOrgFiles } from '../../scripts/quiet-org-files.ts'

test('files the Connector, the bots, and the writer rewrite under orgs/ are quiet; org.md stays live', () => {
  const root = '/home/ada/app'
  const folders = [`${root}/orgs`]
  for (const file of ['orgs/acme/log/2026-10-23.md', 'orgs/acme/log/connector-day-2026-10-23.md', 'orgs/acme/seats/invoice-bot.md', 'orgs/acme/work-chart.md', 'orgs/acme/processes/daily.md', 'orgs/acme/grok/snapshot.json', 'orgs/connector.json', 'orgs/acme/seats/billing-org.md']) {
    assert.equal(isQuietOrgFile(folders, `${root}/${file}`), true, file)
  }
  for (const file of ['orgs/acme/org.md', 'src/App.tsx', 'src/org/load.ts', 'orgs-old/acme/log/a.md', 'samples/harbor/seats/amina.md']) {
    assert.equal(isQuietOrgFile(folders, `${root}/${file}`), false, file)
  }
  assert.equal(isQuietOrgFile(['C:/Users/ada/app/orgs'], 'C:/Users/ada/app/orgs/acme/log/2026-10-23.md'), true, 'Windows paths')
  assert.equal(isQuietOrgFile([`${root}/orgs`, '/mnt/sync/orgs'], '/mnt/sync/orgs/acme/log/a.md'), true, 'orgs/ kept as a link elsewhere')
})

test('orgs/ as a link counts by its real folder too, and a missing orgs/ is fine', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'be-quiet-')))
  try {
    const app = join(dir, 'app')
    const elsewhere = join(dir, 'synced-orgs')
    mkdirSync(app)
    assert.deepEqual(orgFolders(app), [join(app, 'orgs')], 'a fresh clone has no orgs/')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, join(app, 'orgs'), 'junction')
    assert.deepEqual(orgFolders(app), [join(app, 'orgs'), elsewhere])
    const plugin = quietOrgFiles()
    ;(plugin.configResolved as (config: { root: string }) => void)({ root: app })
    const hook = plugin.hotUpdate as { handler: (this: unknown, options: { type: string; file: string; modules: unknown[] }) => unknown }
    const context = { environment: { moduleGraph: { invalidateModule: () => undefined } } }
    assert.deepEqual(hook.handler.call(context, { type: 'update', file: join(elsewhere, 'acme', 'log', 'a.md').replace(/\\/g, '/'), modules: [] }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a quiet file sends no hot update, but marks its modules stale for the next page load', () => {
  const plugin = quietOrgFiles()
  assert.equal(plugin.apply, 'serve', 'the build never sees it')
  ;(plugin.configResolved as (config: { root: string }) => void)({ root: '/home/ada/app' })
  const hook = plugin.hotUpdate as { order: string; handler: (this: unknown, options: { type: string; file: string; modules: unknown[] }) => unknown }
  assert.equal(hook.order, 'post', 'after the glob plugin adds the importers of a new or deleted file')
  const stale: unknown[] = []
  const context = { environment: { moduleGraph: { invalidateModule: (mod: unknown) => stale.push(mod) } } }
  const modules = [{ id: '/home/ada/app/orgs/acme/log/new.md' }, { id: '/home/ada/app/src/org/load.ts' }]
  assert.deepEqual(hook.handler.call(context, { type: 'create', file: '/home/ada/app/orgs/acme/log/new.md', modules }), [])
  assert.deepEqual(stale, modules)
  stale.length = 0
  assert.equal(hook.handler.call(context, { type: 'update', file: '/home/ada/app/orgs/acme/org.md', modules }), undefined)
  assert.equal(hook.handler.call(context, { type: 'update', file: '/home/ada/app/src/App.tsx', modules }), undefined)
  assert.deepEqual(stale, [], 'other files keep their hot updates')
})

test('the dev server uses it', () => {
  const vite = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8')
  assert.match(vite, /plugins: \[contentIndexes\(\), quietOrgFiles\(\), react\(\)\]/)
})
