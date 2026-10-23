import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { isQuietOrgFile, quietOrgFiles } from '../../scripts/quiet-org-files.ts'

test('files the Connector, the bots, and the writer rewrite under orgs/ are quiet; org.md stays live', () => {
  const root = '/home/ada/app'
  for (const file of ['orgs/acme/log/2026-10-23.md', 'orgs/acme/log/connector-day-2026-10-23.md', 'orgs/acme/seats/invoice-bot.md', 'orgs/acme/work-chart.md', 'orgs/acme/processes/daily.md', 'orgs/acme/grok/snapshot.json', 'orgs/connector.json']) {
    assert.equal(isQuietOrgFile(root, `${root}/${file}`), true, file)
  }
  for (const file of ['orgs/acme/org.md', 'src/App.tsx', 'src/org/load.ts', 'orgs-old/acme/log/a.md', 'samples/harbor/seats/amina.md']) {
    assert.equal(isQuietOrgFile(root, `${root}/${file}`), false, file)
  }
  assert.equal(isQuietOrgFile('C:/Users/ada/app', 'C:/Users/ada/app/orgs/acme/log/2026-10-23.md'), true, 'Windows paths')
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
