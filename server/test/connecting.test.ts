import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { recordConnectorRun } from '../src/connector-log.ts'
import { performanceOnly, type SyncRow } from '../src/grok-sync.ts'
import { parseLogMarkdown } from '../src/org-markdown.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, readRequests, requestGrokBot } from '../src/template-server.ts'

const updated = (patch: Extract<SyncRow, { kind: 'updated' }>['patch']): SyncRow => ({ kind: 'updated', name: 'Bot', slug: 'bot', renamed: false, changes: ['x'], patch })

test('for a bot the owner asked for, the link Grok Bot reports lands with the numbers; for any other bot it waits for Sync', () => {
  const stamp = { grokSync: 'synced' as const, grokSyncedAt: '2026-10-20T18:00:00Z' }
  const linked = updated({ ...stamp, grokBotUrl: 'grokbot://new', runs30d: 1 })
  assert.equal(performanceOnly(linked), false)
  assert.equal(performanceOnly(linked, true), true)
  assert.equal(performanceOnly(updated({ ...stamp, grokBotUrl: 'grokbot://new', title: 'Other', role: 'Other' }), true), false, 'a name change still waits')
  assert.equal(performanceOnly(updated({ ...stamp, grokBotUrl: 'grokbot://new', owns: ['Rows'] }), true), false, 'a card fill still waits')
})

function seat(root: string, slug: string, title: string, extra = '') {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

test('when the Connector reports a requested bot, the app links it, clears the request, and logs Created, with no Sync', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-connecting-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    if (!made.ok) throw new Error('no org')
    const root = join(orgs, made.slug)
    seat(root, 'code-review-bot', 'Code Review Bot')
    seat(root, 'other-bot', 'Other Bot')
    assert.equal(requestGrokBot(root, made.slug, 'code-review-bot', orgs).ok, true)
    assert.deepEqual(readRequests(root).requests.map((item) => item.seat), ['code-review-bot'])

    const at = new Date()
    mkdirSync(join(root, 'grok'), { recursive: true })
    const snapshot = join(root, 'grok', 'snapshot.json')
    writeFileSync(snapshot, JSON.stringify({
      syncedAt: at.toISOString(),
      bots: [
        { name: 'Code Review Bot', grokBotUrl: 'grokbot://review', runs30d: 1, lastActive: at.toISOString() },
        { name: 'Other Bot', grokBotUrl: 'grokbot://other', runs30d: 2 },
      ],
      processes: [],
    }))
    utimesSync(snapshot, at, at)
    const connector = join(orgs, CONNECTOR_FILE)
    writeFileSync(connector, JSON.stringify({ syncedAt: at.toISOString(), unassigned: [] }))
    utimesSync(connector, at, at)

    recordConnectorRun(orgs, 'Connector')

    const review = readFileSync(join(root, 'seats', 'code-review-bot.md'), 'utf8')
    assert.match(review, /grokBotUrl: "grokbot:\/\/review"/, 'the requested bot is linked')
    assert.match(review, /grokSync: synced/)
    assert.match(review, /runs30d: 1/)
    assert.deepEqual(readRequests(root).requests, [], 'the request is done')
    const other = readFileSync(join(root, 'seats', 'other-bot.md'), 'utf8')
    assert.doesNotMatch(other, /grokBotUrl/, 'a bot nobody asked for still waits for Sync to confirm its link')
    const events = readdirSync(join(root, 'log')).filter((name) => !/^\d{4}-\d{2}-\d{2}\.md$/.test(name)).map((name) => parseLogMarkdown(readFileSync(join(root, 'log', name), 'utf8'), name)).flatMap((parsed) => (parsed.ok ? [parsed.event] : []))
    assert.deepEqual(events.filter((event) => event.kind === 'created').map((event) => event.summary), ['Created in Grok Bot: Code Review Bot'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a requested bot pulses as connecting on Performance and in the waiting list', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const workspace = read('../../src/pages/Workspace.tsx')
  const drawer = read('../../src/components/SyncDrawer.tsx')
  const css = read('../../src/styles/app.css')
  assert.match(workspace, /requests=\{createRequests\}/, 'Performance pulses for bots being created; an update is not a create')
  assert.match(workspace, /<td colSpan=\{4\} className="be-connecting"><i className="be-pulse" aria-hidden="true" \/>Connecting to Grok Bot…/)
  assert.match(drawer, /<li key=\{item\.slug\}><i className="be-pulse" aria-hidden="true" \/>\{item\.kind === 'update' \? <>[^<]*\{item\.name\} → update asked[\s\S]*?: <>\{item\.name\} → asked/, 'a create still reads asked, created on the next run; an update reads update asked')
  assert.match(css, /@keyframes be-pulse/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.be-pulse \{ animation: none; \} \}/)
  assert.match(css, /\.be-pulse \{[^}]*border-radius: var\(--control-radius\)/, 'square, like every other corner')
})
