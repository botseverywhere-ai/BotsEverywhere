import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { orgFilesIn, showcaseWithoutOrgs, withoutOrgGlobs } from '../../scripts/showcase-orgs.ts'

type Hooks = {
  configResolved: (config: { root: string; command: string; env: Record<string, string> }) => void
  transform: (this: unknown, code: string, id: string) => { code: string } | null | undefined
  buildEnd: (this: { getModuleIds: () => Iterable<string>; error: (message: string) => never }) => void
}

function plugin(mode: string | undefined, command = 'build'): Hooks {
  const made = showcaseWithoutOrgs() as unknown as Hooks
  made.configResolved({ root: '/home/ada/app', command, env: mode === undefined ? {} : { VITE_APP_MODE: mode } })
  return made
}

function bundleOf(ids: string[]) {
  return {
    getModuleIds: () => ids,
    error: (message: string): never => {
      throw new Error(message)
    },
  }
}

const ORG_GLOBS = [
  "const a = import.meta.glob('../../orgs/*/org.md', { eager: true, query: '?raw', import: 'default' })",
  'const b = import.meta.glob("../../orgs/*/seats/*.md", { eager: true })',
  "const c = import.meta.glob(['../../orgs/*/log/*.md', '../../orgs/*/activity.jsonl'], { eager: true })",
].join('\n')

test('a glob over orgs/ is taken out, so no file under orgs/ is asked for', () => {
  const out = withoutOrgGlobs(ORG_GLOBS)
  assert.equal(out.includes('import.meta.glob'), false)
  assert.deepEqual(out.split('\n').map((line) => line.slice(0, 10)), ['const a = ', 'const b = ', 'const c = '], 'each line still sets its name')
})

test('globs over other folders are left as they are', () => {
  const others = [
    "const samples = import.meta.glob('../../samples/*/org.md', { query: '?raw', import: 'default' })",
    "const directory = import.meta.glob('../../directory/*.md', { query: '?raw', import: 'default' })",
    "const old = import.meta.glob('../../orgs-old/*/org.md', { eager: true })",
    "const mine = import.meta.glob('../../my-orgs/*/org.md', { eager: true })",
  ].join('\n')
  assert.equal(withoutOrgGlobs(others), others)
})

test('after the change no file of the app still globs orgs/', () => {
  const src = fileURLToPath(new URL('../../src', import.meta.url))
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((name) => /\.tsx?$/.test(name))
  const orgGlobLines = (code: string) => code.split('\n').filter((line) => line.includes('import.meta.glob') && line.includes('orgs/'))
  let before = 0
  const left: string[] = []
  for (const name of files) {
    const code = readFileSync(join(src, name), 'utf8')
    before += orgGlobLines(code).length
    if (orgGlobLines(withoutOrgGlobs(code)).length) left.push(name)
  }
  assert.ok(before > 0, 'the app does glob orgs/ for the local build')
  assert.deepEqual(left, [])
})

test('a file from orgs/ in a bundle is found by its path, whatever the query', () => {
  const folders = ['/home/ada/app/orgs']
  const ids = [
    '/home/ada/app/src/org/load.ts',
    '/home/ada/app/orgs/acme/seats/invoice-bot.md?raw',
    '/home/ada/app/orgs/acme/org.md?raw',
    '/home/ada/app/orgs/acme/org.json',
    '/home/ada/app/samples/harbor/org.md?raw',
    '/home/ada/app/orgs-old/acme/org.md?raw',
    '\0vite/preload-helper.js',
  ]
  assert.deepEqual(orgFilesIn(ids, folders), ['orgs/acme/org.json', 'orgs/acme/org.md', 'orgs/acme/seats/invoice-bot.md'])
  assert.deepEqual(orgFilesIn(['C:/Users/ada/app/orgs/acme/log/2026-10-23.md?raw'], ['C:/Users/ada/app/orgs']), ['orgs/acme/log/2026-10-23.md'], 'Windows paths')
  assert.deepEqual(orgFilesIn(['/mnt/sync/orgs/acme/org.md?raw'], ['/home/ada/app/orgs', '/mnt/sync/orgs']), ['orgs/acme/org.md'], 'orgs/ kept as a link elsewhere')
})

test('the showcase build takes the globs over orgs/ out; the local build keeps them', () => {
  const showcase = plugin('showcase').transform.call({}, ORG_GLOBS, '/home/ada/app/src/org/load.ts')
  assert.equal(showcase?.code.includes('import.meta.glob'), false)
  assert.equal(plugin('showcase', 'serve').transform.call({}, ORG_GLOBS, '/home/ada/app/src/org/load.ts')?.code.includes('import.meta.glob'), false, 'the showcase dev site too')
  for (const mode of [undefined, 'template', 'Showcase']) {
    assert.equal(plugin(mode).transform.call({}, ORG_GLOBS, '/home/ada/app/src/org/load.ts') ?? null, null, `mode ${mode}`)
  }
})

test('a showcase build that still holds a file from orgs/ stops, and names the file', () => {
  const withOrg = ['/home/ada/app/src/main.tsx', '/home/ada/app/orgs/acme/org.md?raw']
  assert.throws(() => plugin('showcase').buildEnd.call(bundleOf(withOrg)), /orgs\/acme\/org\.md/)
  assert.doesNotThrow(() => plugin('showcase').buildEnd.call(bundleOf(['/home/ada/app/src/main.tsx', '/home/ada/app/samples/harbor/org.md?raw'])))
})

test('the local build may hold orgs/: an organization can serve its own built copy', () => {
  const withOrg = ['/home/ada/app/src/main.tsx', '/home/ada/app/orgs/acme/org.md?raw']
  assert.doesNotThrow(() => plugin(undefined).buildEnd.call(bundleOf(withOrg)))
  assert.doesNotThrow(() => plugin('template').buildEnd.call(bundleOf(withOrg)))
})

test('the site build uses it', async () => {
  const config = (await import('../../vite.config.ts')).default as { plugins?: unknown[] }
  const names = (config.plugins ?? []).flat(Infinity).map((item) => (item as { name?: string } | null)?.name)
  assert.equal(names.includes('showcase-without-orgs'), true)
})
