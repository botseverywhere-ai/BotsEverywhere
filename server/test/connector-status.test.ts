import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { connectorChangeNotice, connectorState, CONNECTOR_STALE_MINUTES, headerBadgeLabel, connectorRanAt, lastRunShort } from '../../src/components/sync-copy.ts'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const at = (minutesAgo: number) => `${NOW - minutesAgo * 60_000}:812`
const status = (snapshot: { stamp: string; syncedAt: string } | null, error = '') => ({ snapshot, error, plan: null, lastConfirmed: '', folder: 'C:\\orgs\\desk' })

test('connector status: the snapshot file time says when the Connector last ran', () => {
  assert.equal(CONNECTOR_STALE_MINUTES, 45)
  assert.deepEqual(connectorState(status({ stamp: at(4), syncedAt: '2026-10-01T00:00:00.000Z' }), NOW), { state: 'connected', line: 'Connected · last run 4 min ago' })
  assert.deepEqual(connectorState(status({ stamp: at(0.2), syncedAt: '' }), NOW), { state: 'connected', line: 'Connected · last run just now' })
  assert.deepEqual(connectorState(status({ stamp: at(35), syncedAt: '' }), NOW), { state: 'connected', line: 'Connected · last run 35 min ago' }, 'a late run is not a stop')
  assert.deepEqual(connectorState(status({ stamp: at(45), syncedAt: '' }), NOW), { state: 'connected', line: 'Connected · last run 45 min ago' })
  assert.deepEqual(connectorState(status({ stamp: at(46), syncedAt: '' }), NOW), { state: 'stale', line: 'Connector stopped · last run 46 min ago' })
  assert.deepEqual(connectorState(status({ stamp: at(180), syncedAt: '' }), NOW), { state: 'stale', line: 'Connector stopped · last run 3 h ago' })
})

test('connector status: no snapshot means never connected; a writer that is down is unknown', () => {
  assert.deepEqual(connectorState(status(null), NOW), { state: 'never', line: 'Not connected · the Connector has never written to this folder' })
  assert.deepEqual(connectorState(null, NOW), { state: 'checking', line: 'Checking the Connector…' })
  assert.deepEqual(connectorState(status(null, 'Saving is off.'), NOW), { state: 'unknown', line: 'Connector status unknown · Saving is off.' })
})

test('connector status: a broken snapshot still proves a run, and says so', () => {
  assert.deepEqual(connectorState(status({ stamp: at(5), syncedAt: '' }, 'bots is not a list.'), NOW), { state: 'broken', line: 'Connector ran 5 min ago, but its snapshot could not be read: bots is not a list.' })
})

test('connector status: without a file time the snapshot date is used', () => {
  assert.deepEqual(connectorState(status({ stamp: '', syncedAt: '2026-10-18T11:50:00.000Z' }), NOW), { state: 'connected', line: 'Connected · last run 10 min ago' })
})

const project = (connector: { stamp: string; syncedAt: string; error: string } | null) => ({ id: 'k3f9', connectorName: 'Connector - BotsEverywhere (k3f9)', orgsFolder: 'C:\\be\\orgs', connector, unassigned: [], bots: 0, renamed: {} })

test('connector status: the project Connector file wins over an org snapshot', () => {
  const withProject = (connector: Parameters<typeof project>[0], snapshot: { stamp: string; syncedAt: string } | null = null) => ({ ...status(snapshot), project: project(connector) })
  assert.deepEqual(connectorState(withProject({ stamp: at(3), syncedAt: '', error: '' }, { stamp: at(300), syncedAt: '' }), NOW), { state: 'connected', line: 'Connected · last run 3 min ago' })
  assert.deepEqual(connectorState(withProject(null), NOW), { state: 'never', line: 'Not connected · no Connector has written to this project yet' })
  assert.deepEqual(connectorState(withProject(null, { stamp: at(6), syncedAt: '' }), NOW), { state: 'connected', line: 'Connected · last run 6 min ago' }, 'an older per-org Connector still counts')
  assert.deepEqual(connectorState(withProject({ stamp: at(2), syncedAt: '', error: 'connector.json is not JSON.' }), NOW), { state: 'broken', line: 'Connector ran 2 min ago, but its snapshot could not be read: connector.json is not JSON.' })
})

test('alert cards fire on a change of connection, never on the first look', () => {
  const name = 'Connector - BotsEverywhere (k3f9)'
  assert.equal(connectorChangeNotice(null, 'never', name, 'desk'), null, 'the first state seen is not a change')
  assert.equal(connectorChangeNotice('checking', 'connected', name, 'desk'), null, 'loading is not a change')
  assert.equal(connectorChangeNotice('connected', 'connected', name, 'desk'), null)
  assert.deepEqual(connectorChangeNotice('never', 'connected', name, 'desk'), {
    kind: 'ok', live: true, message: `Connected to Grok Bot. ${name} just ran.`, link: { label: 'Review the sync', openSync: 'desk' },
  })
  assert.equal(connectorChangeNotice('stale', 'connected', name, 'desk')?.message, `Connected to Grok Bot again. ${name} just ran.`)
  assert.deepEqual(connectorChangeNotice('connected', 'stale', name, 'desk'), {
    kind: 'warn', live: true, message: `${name} stopped. It missed its last two runs. Check it in Grok Bot.`, link: { label: 'Set up the Connector', href: '#/org/desk/connect-bots' },
  })
  assert.equal(connectorChangeNotice('connected', 'broken', name, 'desk')?.kind, 'bad')
  assert.equal(connectorChangeNotice('connected', 'unknown', name, 'desk')?.message, 'The file writer stopped answering. Restart npm run dev.')
  assert.equal(connectorChangeNotice('connected', 'checking', name, 'desk'), null)
})

test('the header badge says in one word whether Grok Bot is connected', () => {
  assert.equal(headerBadgeLabel('connected'), 'Connected')
  assert.equal(headerBadgeLabel('stale'), 'Disconnected')
  assert.equal(headerBadgeLabel('never'), 'Not connected')
  assert.equal(headerBadgeLabel('broken'), 'Error')
  assert.equal(headerBadgeLabel('unknown'), 'Writer off')
  assert.equal(headerBadgeLabel('checking'), '', 'nothing while loading')
})

test('the connection bar sits above the organization row on every tab and never blocks the org', () => {
  const workspace = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  assert.match(workspace, /\{editable \? <ConnectionBar slug=\{bundle\.id\} status=\{connection\} \/> : null\}\s*\{APP_MODE === 'template' && !sample \? <OrgSwitcher/)
  const bar = readFileSync(fileURLToPath(new URL('../../src/components/ConnectionBar.tsx', import.meta.url)), 'utf8')
  assert.match(bar, /href=\{`#\/org\/\$\{slug\}\/connect-bots`\}>Set up the Connector</)
  assert.match(bar, /connectorState\(status, now\)/)
  assert.match(bar, /status\?\.project\?\.orgsFolder \|\| status\?\.folder \|\| orgFolder\(slug\)/, 'the project folder from the writer, else the org folder')
  assert.equal(/\bcompany\b/i.test(bar), false)
})

test('the header shows the time of the last run under Connected, with the day when it was not today', () => {
  const ran = new Date(2026, 9, 20, 15, 1).getTime()
  assert.equal(lastRunShort(ran, new Date(2026, 9, 20, 15, 9).getTime()), '15:01')
  assert.equal(lastRunShort(ran, new Date(2026, 9, 21, 9, 0).getTime()), '20 Oct, 15:01')
  assert.equal(lastRunShort(NaN), '')
  assert.equal(connectorRanAt(status({ stamp: at(4), syncedAt: '' })), NOW - 4 * 60_000)
  assert.equal(connectorRanAt(null), undefined)
  const badge = readFileSync(fileURLToPath(new URL('../../src/components/GrokStatusBadge.tsx', import.meta.url)), 'utf8')
  assert.match(badge, /Grok Bot · \$\{ran\}/)
})

test('the header badge and the connection bar read the light Connector view: never blank, at once, one request at a time', () => {
  const badge = readFileSync(fileURLToPath(new URL('../../src/components/GrokStatusBadge.tsx', import.meta.url)), 'utf8')
  const bar = readFileSync(fileURLToPath(new URL('../../src/components/ConnectionBar.tsx', import.meta.url)), 'utf8')
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/app.css', import.meta.url)), 'utf8')
  assert.match(badge, /fetch\('\/api\/connector'\)/)
  assert.doesNotMatch(badge, /\/sync`|\/api\/orgs'\)/, 'the badge never asks for a sync plan')
  assert.match(badge, /useState<ConnectorView \| null>\(\(\) => remembered\(\)\?\.status \?\? null\)/, 'the last state this browser saw shows at once')
  assert.match(badge, /<span className="grok-status is-checking" aria-label="Grok Bot: checking">/)
  assert.match(badge, /let inFlight = false\s+const load = async \(\) => \{\s+if \(inFlight\) return/, 'the in-flight flag belongs to each run of the effect, so StrictMode cannot strand the badge on Checking')
  assert.doesNotMatch(badge, /busy\.current/)
  assert.match(css, /\.grok-status\.is-checking \{ color: var\(--color-muted\); \}/)
  assert.match(bar, /status: ConnectionView \| null/)
  assert.match(page, /fetch\('\/api\/connector'\)/)
  assert.match(page, /<ConnectionBar slug=\{bundle\.id\} status=\{connection\} \/>/)
  assert.match(page, /if \(syncBusy\.current\) \{\s+syncAgain\.current = true\s+return\s+\}/, 'the org page never stacks status requests')
  assert.match(page, /\} while \(syncAgain\.current\)/, 'and asks once more when events kept coming')
})

test('the connection bar opens on the last Connector state this tab saw, shared with the header badge', async () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  Object.assign(globalThis, { sessionStorage: storage })
  try {
    const { remember, remembered } = await import('../../src/live/connector-memory.ts')
    assert.equal(remembered(), null, 'nothing seen yet')
    const status = { snapshot: null, error: '', project: { id: 'uft5', connectorName: 'Connector - BotsEverywhere (uft5)', orgsFolder: '/home/ada/app/orgs', connector: { stamp: '1:2', syncedAt: '', error: '' }, syncMinutes: 17, orgs: ['acme'] } }
    remember('acme', status)
    assert.deepEqual(remembered(), { slug: 'acme', status })
    store.set('be:grok-status', '{not json')
    assert.equal(remembered(), null, 'a bad entry reads as nothing')
    Object.assign(globalThis, { sessionStorage: { getItem: () => { throw new Error('storage off') }, setItem: () => { throw new Error('storage off') } } })
    assert.equal(remembered(), null)
    assert.doesNotThrow(() => remember('acme', status), 'storage can be off')
  } finally {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  const badge = readFileSync(fileURLToPath(new URL('../../src/components/GrokStatusBadge.tsx', import.meta.url)), 'utf8')
  assert.match(page, /useState<ConnectionView \| null>\(\(\) => remembered\(\)\?\.status \?\? null\)/, 'a tab switch shows the known state at once')
  assert.match(page, /remember\(info\.orgs\[0\] \?\? '', next\)/, 'and keeps it current for the badge')
  assert.match(badge, /from '\.\.\/live\/connector-memory'/, 'one memory for both')
  assert.doesNotMatch(badge, /sessionStorage/)
})

test('the org page sends the light Connector status before its sync plan, so the bar never waits for the plan', () => {
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  const start = page.indexOf('const loadSync = useCallback(async () => {')
  const body = page.slice(start, page.indexOf('}, [bundle.id, editable, loadConnection])', start))
  assert.match(body, /const connected = loadConnection\(\)/)
  assert.match(body, /syncBusy\.current = true\s+try \{\s+await connected\s+do \{\s+syncAgain\.current = false\s+await fetchOnce\(\)/, 'the plan waits for the status answer')
})
