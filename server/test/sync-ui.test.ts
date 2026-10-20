import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { GROK_SNAPSHOT_PROMPT, SNAPSHOT_FILE_NAME, SYNC_NOW_PROMPT, grokSnapshotPrompt } from '../../src/content/grok-snapshot-prompt.ts'
import { grokSyncClass, grokSyncLine, grokSyncTag, rowLine, statusLine, syncButtonLabel } from '../../src/components/sync-copy.ts'
import { managerChoices } from '../../src/org/manager-choices.ts'

const SNAP = '2026-10-17T20:10:00.000Z'

test('sync copy helpers name the button, the rows, and the status', () => {
  assert.equal(syncButtonLabel(0), 'Sync with Grok Bot')
  assert.equal(syncButtonLabel(4), 'Sync with Grok Bot · 4')
  assert.equal(syncButtonLabel(0, 3), 'Sync with Grok Bot · 3', 'bots still missing count even with nothing to apply')
  assert.equal(syncButtonLabel(2, 3), 'Sync with Grok Bot · 2', 'changes to apply come first')
  assert.equal(rowLine({ kind: 'new', name: 'Brand New Bot', note: '', bot: { name: 'Brand New Bot', grokBotUrl: '', reportsTo: 'You', owns: [], may: [], needsApproval: [], doneWhen: [], createdAt: '', lastActive: '', routines: [], botStatus: '', note: '', error: '' } }), 'Brand New Bot → new seat, reports to You')
  assert.equal(rowLine({ kind: 'updated', name: 'Invoice Bot', slug: 'invoice-bot', renamed: false, changes: ['link', '3 routines'], patch: { grokSync: 'synced' } }), 'Invoice Bot → link, 3 routines')
  assert.equal(rowLine({ kind: 'missing', name: 'Gone Bot', slug: 'gone-bot', write: true, patch: { grokSync: 'missing' } }), 'Gone Bot → not found in Grok Bot')
  assert.equal(rowLine({ kind: 'missing', name: 'Gone Bot', slug: 'gone-bot', write: false, patch: { grokSync: 'missing' } }), 'Gone Bot → still not found')
  assert.equal(rowLine({ kind: 'new-process', name: 'Invoice arrives', row: { name: 'Invoice arrives', trigger: { type: 'manual', schedule: '', source: '', description: '' }, steps: [], doneWhen: '', next: '', notes: [], error: '' } }), 'Invoice arrives → new process')
  assert.equal(rowLine({ kind: 'schedule', name: 'Daily brief', slug: 'daily-brief', process: 'weekdays 08:00', routine: '0 9 * * 1-5' }), 'Daily brief → Grok Bot runs it "0 9 * * 1-5", the process says "weekdays 08:00"')
  assert.equal(rowLine({ kind: 'skipped', name: 'Bot 3', error: 'Name is required.' }), 'Bot 3 → Name is required.')
  assert.equal(statusLine({ snapshot: null, error: '', lastConfirmed: '' }, 'your-company'), 'No snapshot yet. The Connector writes orgs/your-company/grok/snapshot.json on each run.')
  assert.equal(statusLine({ snapshot: { stamp: '1:1', syncedAt: '' }, error: 'This file is not JSON.', lastConfirmed: '' }, 'x'), 'The snapshot could not be read: This file is not JSON.')
  assert.equal(statusLine({ snapshot: { stamp: '1:1', syncedAt: SNAP }, error: '', lastConfirmed: '' }, 'x'), 'Snapshot from 17 Oct 2026, 20:10. Not confirmed yet.')
  assert.equal(statusLine({ snapshot: { stamp: '1:1', syncedAt: SNAP }, error: '', lastConfirmed: '2026-10-17T20:14:00.000Z' }, 'x'), 'Snapshot from 17 Oct 2026, 20:10. Last confirmed 17 Oct 2026, 20:14.')
  assert.equal(grokSyncTag({ grokSync: 'new' }), 'New in Grok Bot')
  assert.equal(grokSyncTag({ grokSync: 'missing' }), 'Not in Grok Bot')
  assert.equal(grokSyncTag({ grokSync: 'synced' }), 'In Grok Bot')
  assert.equal(grokSyncTag({}), 'Not synced yet', 'a seat no sync has seen and with no link is unknown, not absent')
  assert.equal(grokSyncTag({ grokBotUrl: 'grokbot://app/v1/agent?id=abc' }), 'In Grok Bot', 'a Grok Bot link counts until a snapshot says otherwise')
  assert.equal(grokSyncTag({ grokSync: 'missing', grokBotUrl: 'grokbot://app/v1/agent?id=abc' }), 'Not in Grok Bot', 'a snapshot that lacked the bot wins over a stale link')
  assert.equal(grokSyncClass({ grokSync: 'synced' }), 'is-in-grok')
  assert.equal(grokSyncClass({ grokSync: 'new' }), 'is-in-grok')
  assert.equal(grokSyncClass({ grokSync: 'missing' }), 'is-off-grok')
  assert.equal(grokSyncClass({}), 'is-unsynced')
  assert.equal(grokSyncClass({ grokBotUrl: 'grokbot://app/v1/agent?id=abc' }), 'is-in-grok')
  assert.equal(grokSyncClass({ grokBotUrl: '' }), 'is-unsynced')
  assert.equal(grokSyncLine({ grokSync: 'synced', grokSyncedAt: SNAP }), 'synced 17 Oct 2026, 20:10')
  assert.equal(grokSyncLine({ grokSync: 'new', grokSyncedAt: SNAP }), 'new since 17 Oct 2026, 20:10')
  assert.equal(grokSyncLine({ grokSync: 'missing', grokMissingSince: SNAP }), 'not found since 17 Oct 2026, 20:10')
  assert.equal(grokSyncLine({}), 'not synced yet')
  assert.equal(SNAPSHOT_FILE_NAME, 'snapshot.json')
  assert.match(GROK_SNAPSHOT_PROMPT, /"syncedAt"/)
  assert.match(GROK_SNAPSHOT_PROMPT, /"bots"/)
  assert.match(GROK_SNAPSHOT_PROMPT, /"processes"/)
  assert.match(GROK_SNAPSHOT_PROMPT, /If you do not know a value, leave the field out\. Never estimate or invent numbers\./)
  assert.match(SYNC_NOW_PROMPT, /Connector - BotsEverywhere/)
  assert.match(grokSnapshotPrompt('orgs/acme'), /save it to orgs\/acme\/grok\/snapshot\.json/i, 'the one-off prompt names the folder')
  for (const text of [GROK_SNAPSHOT_PROMPT, SYNC_NOW_PROMPT, grokSnapshotPrompt('orgs/acme')]) assert.equal(/\bcompany\b/i.test(text), false)
})

test('manager choices leave out the seat, its reports, and retired seats', () => {
  const seats = [
    { slug: 'you', title: 'You', reportsTo: '', status: 'active' as const },
    { slug: 'lead-bot', title: 'Lead Bot', reportsTo: 'you', status: 'active' as const },
    { slug: 'helper-bot', title: 'Helper Bot', reportsTo: 'lead-bot', status: 'active' as const },
    { slug: 'deep-bot', title: 'Deep Bot', reportsTo: 'helper-bot', status: 'active' as const },
    { slug: 'other-bot', title: 'Other Bot', reportsTo: 'you', status: 'active' as const },
    { slug: 'old-bot', title: 'Old Bot', reportsTo: 'you', status: 'retired' as const },
  ]
  assert.deepEqual(managerChoices(seats, 'lead-bot').map((item) => item.slug), ['you', 'other-bot'])
  assert.deepEqual(managerChoices(seats, 'deep-bot').map((item) => item.slug), ['you', 'lead-bot', 'helper-bot', 'other-bot'])
})

test('company seats carry the sync fields from the seat file', () => {
  const company = readFileSync(fileURLToPath(new URL('../../src/org/company.ts', import.meta.url)), 'utf8')
  assert.match(company, /grokSync: seat\.grokSync/)
  assert.match(company, /grokSyncedAt: seat\.grokSyncedAt/)
  assert.match(company, /grokMissingSince: seat\.grokMissingSince/)
  const types = readFileSync(fileURLToPath(new URL('../../src/data/mock-companies.ts', import.meta.url)), 'utf8')
  assert.match(types, /grokSync\?: 'new' \| 'synced' \| 'missing'/)
})

test('the Sync button, drawer, tags, and Reports to select are wired in template mode only', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const workspace = read('../../src/pages/Workspace.tsx')
  assert.match(workspace, /editable \? <Button variant="secondary" type="button" className="org-sync"/)
  assert.match(workspace, /syncButtonLabel\(sync\?\.plan\?\.writes \?\? 0, outgoing\(sync\?\.plan \?\? null, sync\?\.requests \?\? \[\], seats\)\.ready\.length\)/, 'the count includes bots never synced')
  assert.match(workspace, /<SyncDrawer\s+orgSlug=\{bundle\.id\}\s+status=\{sync\}\s+seats=\{seats\}/, 'the drawer sees every seat, not only the snapshot')
  assert.match(workspace, /actions=\{editable \? <SeatActions /, 'Add a seat shows in the chart toolbar on every editable org, not only a one-seat org')
  assert.match(read('../../src/components/OrgChart.tsx'), /<\/div>\s*\{actions \? <div className="org-actions">\{actions\}<\/div> : null\}\s*<ul className="org-legend">/, 'the seat buttons get their own row under the chart toolbar')
  assert.match(workspace, /\/api\/orgs\/\$\{bundle\.id\}\/sync`/)
  assert.match(workspace, /response\.status === 404[\s\S]{0,300}The file writer needs a restart\. Stop npm run dev and start it again\./)
  assert.match(workspace, /\/seats\/\$\{slug\}\/manager`/)
  assert.match(workspace, /managerChoices\(seats, chartSeat\.id\)/)
  assert.match(workspace, /onClick=\{\(\) => \{ setSyncOpen\(true\); void loadSync\(\) \}\}/, 'opening the drawer refetches the preview')
  assert.match(workspace, /void rereadOrg\(\)\.catch\(\(\) => undefined\); void loadSync\(\)/, 'an org change refetches the preview')
  assert.match(workspace, /setSync\(\{ snapshot: null, error: SAVING_OFF, plan: null, lastConfirmed: '', folder: '' \}\)/, 'a writer that is down shows in the drawer')
  const connect = read('../../src/components/ConnectGrok.tsx')
  assert.ok(connect.includes("connectorPrompt({ id: project?.id ?? '', orgsFolder: project?.orgsFolder ?? '', syncMinutes: minutes, timeZone: project?.timeZone ?? '', windows: project?.windows ?? false })"), 'the Connector prompt takes the folder, time zone, and platform from the running writer, never from the browser')
  assert.equal(connect.includes('rememberOrgFolder'), false, 'the folder box that copies shared through the browser is gone')
  assert.match(workspace, /if \(next\.folder\) rememberOrgFolder\(bundle\.id, next\.folder\)/, 'the running writer\'s folder always overwrites the browser memory')
  assert.match(workspace, /oxlint-disable-next-line react\/set-state-in-effect -- the sync status is fetched from the writer/)
  const live = read('../../src/live/use-run-log.ts')
  assert.match(live, /source\.addEventListener\('grok'/)
  const drawer = read('../../src/components/SyncDrawer.tsx')
  assert.match(drawer, /Sync with Grok Bot/)
  assert.match(drawer, /statusLine\(/)
  assert.match(drawer, /rowLine\(/)
  assert.match(drawer, /\/sync\/apply`/)
  assert.match(drawer, /\/sync\/preview`/)
  assert.match(drawer, /grokSnapshotPrompt\(shown\?\.folder \|\| orgFolder\(orgSlug\)\)/, 'the one-off prompt uses the absolute folder when the writer gave one')
  assert.match(drawer, /syncNowPrompt\(project\?\.connectorName \?\? ''\)/, 'the sync-now message names this copy\'s Connector')
  assert.match(drawer, /The snapshot changed\. Review it again\./)
  assert.match(drawer, /moves files between Grok Bot and every organization in this folder/, 'the drawer says what the Connector is for')
  assert.match(drawer, /Paste its prompt from Connect bots into Grok Bot once/)
  assert.match(drawer, /One-off snapshot without the Connector/)
  assert.equal(/\bcompany\b/i.test(drawer), false)
  const chart = read('../../src/components/OrgChart.tsx')
  assert.match(chart, /grokSyncTag\(seat\)/)
  assert.match(chart, /grokSyncClass\(seat\)/, 'bot cards carry the in or off Grok Bot class')
  assert.match(chart, /org-sync-tag/)
  assert.match(chart, /grokStates\b/, 'the green and dashed states are opt-in, so templates and samples stay plain')
  assert.match(chart, /legendItem\('in-grok', 'swatch-grok', 'In Grok Bot', account \? account\.total : counts\.inGrok\)/)
  assert.match(chart, /legendItem\('off-grok', 'swatch-off-grok', 'Not in Grok Bot', counts\.offGrok\)/)
  assert.match(workspace, /grokStates=\{editable\}/)
  const seatDrawer = read('../../src/components/SeatDrawer.tsx')
  assert.match(seatDrawer, /grokSyncLine\(seat\)/)
  assert.match(seatDrawer, /<dt>Grok Bot<\/dt>/)
  assert.match(seatDrawer, /managers && onReportsTo && seat\.reportsTo/)
  assert.match(seatDrawer, /managers\.some\(\(item\) => item\.slug === seat\.reportsTo\)/, 'a retired manager still shows as the current one')
  const css = read('../../src/styles/app.css')
  assert.match(css, /\.org-sync-tag \{[^}]*align-self: flex-start/, 'the tag does not stretch across the card')
  assert.match(css, /\.org-sync-tag\.is-missing \{/)
  assert.match(css, /\.org-card-hit\.is-in-grok \{[^}]*var\(--color-green-400\)/, 'a bot in Grok Bot gets the green bar')
  assert.match(css, /\.org-card-hit\.is-off-grok \{[^}]*dashed/, 'a bot not in Grok Bot is dashed')
  assert.match(css, /\.org-card-hit\.is-unsynced \{[^}]*var\(--color-muted\)/, 'a bot no sync has seen is only muted')
  assert.match(css, /\.org-sync-tag\.is-in-grok \{[^}]*var\(--color-green-700\)/)
  assert.match(css, /\.swatch-grok \{[^}]*var\(--color-green-400\)/)
  assert.match(css, /\.swatch-off-grok \{[^}]*dashed/)
  assert.match(css, /\.swatch-human \{ background: var\(--color-stone\); \}/, 'the Human square matches the beige human badge')
  assert.match(css, /\.org-avatar-human \{\s*background: var\(--color-stone\);/)
})

test('the org chart legend counts each category', async () => {
  const { legendCounts } = await import('../../src/components/sync-copy.ts')
  const seats = [
    { id: 'you', type: 'human' as const },
    { id: 'a', type: 'bot' as const, grokSync: 'synced' as const },
    { id: 'b', type: 'bot' as const, grokBotUrl: 'grokbot://x' },
    { id: 'c', type: 'bot' as const, grokSync: 'missing' as const },
    { id: 'd', type: 'bot' as const },
    { id: 'open', type: 'bot' as const },
    { id: 'inbox', type: 'system' as const },
  ]
  assert.deepEqual(legendCounts(seats, ['open']), { human: 1, bot: 4, system: 1, inGrok: 2, offGrok: 1 }, 'an open seat is not counted; a bot nothing is known about is in neither Grok Bot count')
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  assert.match(chart, /<i className=\{`swatch \$\{swatch\}`\} \/> \{label\} <span className="legend-count">\{count\}<\/span>/, 'swatch, label, and count')
  for (const [group, swatch, label, key] of [['human', 'human', 'Human', 'human'], ['bot', 'bot', 'Bot', 'bot'], ['system', 'system', 'System', 'system'], ['off-grok', 'off-grok', 'Not in Grok Bot', 'offGrok']]) {
    assert.match(chart, new RegExp(`legendItem\\('${group}', 'swatch-${swatch}', '${label}', counts\\.${key}\\)`), label)
  }
  assert.ok(chart.includes("legendItem('in-grok', 'swatch-grok', 'In Grok Bot', account ? account.total : counts.inGrok)"), 'In Grok Bot counts the account when the Connector reported it')
})

test('Organization Overview shows counts from the org chart, not typed numbers', () => {
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  assert.equal(overview.includes('type="number"'), false, 'no number inputs')
  assert.equal(overview.includes('People count'), false)
  assert.equal(overview.includes('label="Size"'), false, 'no Size field')
  assert.match(overview, /legendCounts\(/)
  assert.match(overview, /<dt>\{label\}<\/dt>/)
  for (const label of ['People', 'Bots', 'In Grok Bot', 'Not in Grok Bot', 'System', 'Retired']) assert.ok(overview.includes(`countBox('${label}', `), label)
  assert.match(overview, /JSON\.stringify\(\{ \.\.\.profile, people: counts\.human, bots: counts\.bot \}\)/, 'a save writes the chart counts')
})

test('Sync drawer layout: the buttons are centered in their footer, and the one-off panel is spaced from the list above', () => {
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.sync-drawer \.be-hire-foot \{ padding-top: var\(--space-4\); padding-bottom: var\(--space-4\); \}/, 'same space above and below the buttons')
  assert.match(css, /\.sync-drawer \.be-hire-foot \.dir-actions \{ margin-top: 0; justify-content: center; \}/)
  assert.match(css, /\.sync-drawer \.link-panel \{ margin-top: var\(--space-5\); \}/)
})
