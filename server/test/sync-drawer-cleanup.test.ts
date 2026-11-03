import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConnectorState, ProjectInfo, SyncStatus } from '../src/grok-sync.ts'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

/** A Connector that wrote connector.json a minute ago: connected. */
const RAN = () => ({ stamp: `${Date.now() - 60_000}:537`, syncedAt: new Date(Date.now() - 60_000).toISOString(), error: '', syncMinutes: 15 })

function project(connector: ProjectInfo['connector'], bots = 21): ProjectInfo {
  return { id: 'vuk7', connectorName: 'Connector - BotsEverywhere (vuk7)', orgsFolder: 'C:\\Users\\migue\\botseverywhere-v7\\orgs', connector, unassigned: [], bots, renamed: {}, syncMinutes: 15 }
}

const QUIET: ConnectorState = { stuck: [], failed: [], pending: 0, pendingSince: '', waiting: { routines: 0, profiles: 0, notes: 0 }, dumpError: '', otherCopies: [] }

function status(over: Partial<SyncStatus> = {}): SyncStatus {
  return {
    snapshot: { stamp: `${Date.now() - 60_000}:100`, syncedAt: new Date(Date.now() - 60_000).toISOString() },
    error: '',
    plan: { syncedAt: '2026-11-03T12:18:12+01:00', rows: [], counts: { new: 0, missing: 0, updated: 0, processes: 0, warnings: 0, unchanged: 21 }, writes: 0 },
    lastConfirmed: '2026-11-03T11:58:00+01:00',
    folder: 'C:\\Users\\migue\\botseverywhere-v7\\orgs\\org-trav3fcs',
    requests: [],
    project: project(RAN()),
    connector: QUIET,
    ...over,
  }
}

async function drawer(over: Partial<SyncStatus> = {}): Promise<string> {
  const { SyncDrawer } = await import('../../src/components/SyncDrawer.tsx')
  return render(SyncDrawer, { orgSlug: 'org-trav3fcs', status: status(over), seats: [], onClose: () => undefined, onRefresh: async () => undefined, onApplied: async () => undefined })
}

test('once the Connector is connected, the drawer leaves out how to set it up; before that, it says how', async () => {
  const connected = await drawer()
  assert.doesNotMatch(connected, /moves files between Grok Bot and every organization in this folder/)
  assert.doesNotMatch(connected, /Copy the Connector prompt on Connect bots/)
  assert.match(connected, /Run the Connector now/, 'running it right away stays')
  const never = await drawer({ snapshot: null, project: project(null) })
  assert.match(never, /Connector - BotsEverywhere \(vuk7\) moves files between Grok Bot and every organization in this folder\. Paste its prompt from Connect bots into Grok Bot once/)
  assert.match(never, /<a href="#\/org\/org-trav3fcs\/connect-bots">Copy the Connector prompt on Connect bots<\/a>/)
  const stopped = await drawer({ project: project({ ...RAN(), stamp: `${Date.now() - 3 * 60 * 60_000}:537` }) })
  assert.match(stopped, /Copy the Connector prompt on Connect bots/, 'a stopped Connector may need its prompt again')
})

test('the drawer has no one-off snapshot prompt and no snapshot import: the app writes the snapshot from the Connector itself', async () => {
  const html = await drawer()
  assert.doesNotMatch(html, /One-off snapshot without the Connector/)
  assert.doesNotMatch(html, /Import snapshot file/)
  assert.doesNotMatch(html, /List every bot I run in Grok Bot/)
})

test('Coming from Grok Bot shows what changed, without the paragraph on what Sync is for', async () => {
  const coming = (await drawer()).split('Going to Grok Bot')[0]!.split('Coming from Grok Bot')[1]!
  assert.doesNotMatch(coming, /apply on their own on every Connector run/)
  assert.match(coming, /21 unchanged\. Nothing to apply\./)
})

test('the bot limit shows only once the Grok Bot account is past it', async () => {
  assert.doesNotMatch(await drawer(), /Grok Bot limits how many bots one account can have/, '21 bots: nothing to say')
  assert.doesNotMatch(await drawer({ project: project(RAN(), 50) }), /Grok Bot limits how many bots/, '50 is still within it')
  assert.match(await drawer({ project: project(RAN(), 60) }), /<p class="save-off" role="alert">The organizations in this folder have 60 bots\. Grok Bot limits how many bots one account can have\. We recommend up to 50\.<\/p>/)
})

test('a Connector that carried out items since the late ones is still working, not stopped; one that carried out none is asked about', async () => {
  const working = await drawer({ connector: { ...QUIET, pending: 9, pendingSince: '2026-11-03T11:55:22+01:00', actedSince: 5 } })
  assert.match(working, /<p class="overview-note">The Connector is still working through 9 items\. It has carried out 5 since [^<]+\.<\/p>/)
  assert.doesNotMatch(working, /Check that it still runs/)
  const one = await drawer({ connector: { ...QUIET, pending: 1, pendingSince: '2026-11-03T11:55:22+01:00', actedSince: 1 } })
  assert.match(one, /The Connector is still working through 1 item\. It has carried out 1 since /)
  const idle = await drawer({ connector: { ...QUIET, pending: 9, pendingSince: '2026-11-03T11:55:22+01:00', actedSince: 0 } })
  assert.match(idle, /<p class="save-off" role="alert">The Connector has not acted on 9 items since [^<]+\. Check that it still runs in Grok Bot\.<\/p>/)
})

test("each other copy's old instructions take one short line; the bots' names open on a click", async () => {
  const html = await drawer({ connector: { ...QUIET, otherCopies: [
    { copy: 'acn8', bots: ['Overheard', 'Events - botseverywhere', 'Grok Bot'], removing: false },
    { copy: '87xp', bots: ['Overheard'], removing: true },
  ] } })
  assert.match(html, /<li class="sync-copy"><details><summary>Copy acn8 · in 3 bots<\/summary><p class="overview-note">Overheard, Events - botseverywhere, Grok Bot<\/p><\/details><button[^>]*>Remove old instructions<\/button><\/li>/)
  assert.match(html, /<li class="sync-copy"><details><summary>Copy 87xp · in 1 bot<\/summary><p class="overview-note">Overheard<\/p><\/details><span class="overview-note">Removing, bot by bot<\/span><\/li>/, 'it takes many runs, not the next one')
  assert.doesNotMatch(html, /Blocks from copy/)
})

test('the old copies section says it removes instructions, never bots', async () => {
  const html = await drawer({ connector: { ...QUIET, otherCopies: [{ copy: 'acn8', bots: ['Overheard'], removing: false }] } })
  assert.match(html, /<h3>Old instructions from other copies of BotsEverywhere \(1\)<\/h3>/)
  assert.match(html, /Another copy of BotsEverywhere added these instructions to your bots\. Remove them only if that copy is gone\. Your bots, and your own text in them, stay as they are\./)
  assert.doesNotMatch(html, />Remove them</, 'a button named Remove them reads as removing bots')
  assert.doesNotMatch(html, /Blocks from other copies/)
})

test('a copy whose Connector is gone from Grok Bot says so, and two or more such copies can be cleaned with one button', async () => {
  const gone = (copy: string, removing = false) => ({ copy, bots: ['Overheard'], removing, connectorGone: true })
  const html = await drawer({ connector: { ...QUIET, otherCopies: [gone('acn8'), gone('6kb7'), { copy: 'k7m2', bots: ['Overheard'], removing: false, connectorGone: false }] } })
  assert.match(html, /<summary>Copy acn8 · in 1 bot · its Connector is no longer in Grok Bot<\/summary>/)
  assert.match(html, /<summary>Copy k7m2 · in 1 bot<\/summary>/, 'a copy whose Connector is still there may still be in use')
  assert.match(html, /<button[^>]*>Remove all old instructions<\/button>/)
  assert.doesNotMatch(await drawer({ connector: { ...QUIET, otherCopies: [gone('acn8')] } }), /Remove all old instructions/, 'one old copy has its own button')
  assert.doesNotMatch(await drawer({ connector: { ...QUIET, otherCopies: [gone('acn8', true), gone('6kb7', true)] } }), /Remove all old instructions/, 'already on their way out')
})

test('Remove all old instructions takes the copies whose Connector is gone and that are not being removed yet, and nothing else', async () => {
  const { oldCopies } = await import('../../src/components/sync-copy.ts')
  assert.deepEqual(oldCopies([
    { copy: 'acn8', bots: ['A'], removing: false, connectorGone: true },
    { copy: '6kb7', bots: ['A'], removing: true, connectorGone: true },
    { copy: 'k7m2', bots: ['A'], removing: false, connectorGone: false },
    { copy: 'f3sr', bots: ['A'], removing: false },
    { copy: 'ddap', bots: ['A'], removing: false, connectorGone: true },
  ]), ['acn8', 'ddap'], 'an older writer that sends no connectorGone removes nothing on its own')
})
