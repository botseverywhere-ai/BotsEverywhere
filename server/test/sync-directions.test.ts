import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseLogMarkdown, serializeLogMarkdown } from '../src/org-markdown.ts'
import type { FileActivity, SeatDocument } from '../src/org-files.ts'
import type { SyncPlan } from '../src/grok-sync.ts'
import { applySync, createOrgFiles, readOrgDir, requestGrokBot } from '../src/template-server.ts'
import { botLimitLine, GROK_BOT_LIMIT, grokDirection, grokDirectionLabel, outgoing, overBotLimit } from '../../src/components/sync-copy.ts'

const event: FileActivity = { id: 'e1', orgId: '', type: 'edit', actorSeatId: 'you', actorType: 'human', timestamp: '2026-10-18T10:00:00.000Z', summary: 'Asked' }

test('an activity event keeps its Grok Bot direction and ignores a bad one', () => {
  const text = serializeLogMarkdown({ ...event, grok: 'out' })
  assert.match(text, /\ngrok: out\n/)
  const parsed = parseLogMarkdown(text)
  assert.equal(parsed.ok && parsed.event.grok, 'out')
  const bad = parseLogMarkdown(text.replace('grok: out', 'grok: sideways'))
  assert.equal(bad.ok && bad.event.grok, undefined)
  assert.equal(serializeLogMarkdown(event).includes('grok:'), false)
})

test('the log badge says which way a change went; older sync events count as incoming', () => {
  assert.equal(grokDirection({ ...event, grok: 'out' }), 'out')
  assert.equal(grokDirection({ ...event, id: 'sync-2026-10-17T22:12:17.000Z' }), 'in')
  assert.equal(grokDirection(event), undefined)
  assert.equal(grokDirectionLabel('in'), 'From Grok Bot')
  assert.equal(grokDirectionLabel('out'), 'To Grok Bot')
})

test('going out: bots Grok Bot lacks, split into waiting for the Connector and ready to send', () => {
  const plan = {
    rows: [
      { kind: 'missing', name: 'Metric Change Bot', slug: 'metric-change-bot', write: false, patch: { grokSync: 'missing' } },
      { kind: 'missing', name: 'Search Brief Bot', slug: 'search-brief-bot', write: true, patch: { grokSync: 'missing' } },
      { kind: 'unchanged', name: 'Invoice Bot', slug: 'invoice-bot' },
    ],
  } as Pick<SyncPlan, 'rows'>
  const requests = [{ seat: 'metric-change-bot', name: 'Metric Change Bot', seatFile: '', prompt: '', requestedAt: '2026-10-18T10:40:00.000Z' }]
  assert.deepEqual(outgoing(plan, requests), {
    waiting: [{ slug: 'metric-change-bot', name: 'Metric Change Bot', requestedAt: '2026-10-18T10:40:00.000Z', kind: 'create' }],
    ready: [{ slug: 'search-brief-bot', name: 'Search Brief Bot' }],
  })
  assert.deepEqual(outgoing(null, requests).waiting.map((item) => item.slug), ['metric-change-bot'], 'a request shows before any snapshot')
})

const seat = (slug: string, title: string, extra: Partial<SeatDocument> = {}) =>
  ({ slug, title, kind: 'bot', status: 'active', grokBotUrl: '', ...extra }) as SeatDocument

test('going out: a template copy with no snapshot lists every bot Grok Bot does not have yet', () => {
  const seats = [
    seat('invoice-bot', 'Invoice Bot'),
    seat('payment-bot', 'Payment Bot'),
    seat('linked-bot', 'Linked Bot', { grokBotUrl: 'https://x.ai/bot/abc' }),
    seat('synced-bot', 'Synced Bot', { grokSync: 'synced' }),
    seat('old-bot', 'Old Bot', { status: 'retired' }),
    seat('helen', 'Helen Cho', { kind: 'human' }),
    seat('inbox', 'Invoice Inbox', { kind: 'system' }),
  ]
  assert.deepEqual(outgoing(null, [], seats).ready, [
    { slug: 'invoice-bot', name: 'Invoice Bot' },
    { slug: 'payment-bot', name: 'Payment Bot' },
  ])
  const requests = [{ seat: 'invoice-bot', name: 'Invoice Bot', seatFile: '', prompt: '', requestedAt: '2026-10-18T10:40:00.000Z' }]
  assert.deepEqual(outgoing(null, requests, seats).ready, [{ slug: 'payment-bot', name: 'Payment Bot' }], 'a bot already asked for waits instead')
})

test('going out: with a snapshot, a bot it matched is not sent again and a missing one is listed once', () => {
  const plan = {
    rows: [
      { kind: 'unchanged', name: 'Invoice Bot', slug: 'invoice-bot' },
      { kind: 'missing', name: 'Payment Bot', slug: 'payment-bot', write: true, patch: { grokSync: 'missing' } },
    ],
  } as Pick<SyncPlan, 'rows'>
  const seats = [seat('invoice-bot', 'Invoice Bot'), seat('payment-bot', 'Payment Bot')]
  assert.deepEqual(outgoing(plan, [], seats).ready, [{ slug: 'payment-bot', name: 'Payment Bot' }])
})

test('the Grok Bot bot limit is a recommendation of 50 and warns past it', () => {
  assert.equal(GROK_BOT_LIMIT, 50)
  assert.equal(botLimitLine(4), 'Grok Bot limits how many bots one account can have. We recommend up to 50.')
  assert.equal(botLimitLine(50), 'Grok Bot limits how many bots one account can have. We recommend up to 50.')
  assert.equal(botLimitLine(51), 'This organization has 51 bots. Grok Bot limits how many bots one account can have. We recommend up to 50.')
  assert.equal(botLimitLine(49, 3), 'This would make 52 bots. Grok Bot limits how many bots one account can have. We recommend up to 50.')
  assert.equal(botLimitLine(60, 0, 'project'), 'The organizations in this folder have 60 bots. Grok Bot limits how many bots one account can have. We recommend up to 50.', 'one Grok Bot account serves every org in the folder')
  assert.equal(overBotLimit(50), false)
  assert.equal(overBotLimit(50, 1), true)
})

function writeBot(root: string, slug: string, title: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\ngrokSync: missing\n---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

function logEvents(root: string): FileActivity[] {
  return readdirSync(join(root, 'log')).flatMap((name) => {
    const parsed = parseLogMarkdown(readFileSync(join(root, 'log', name), 'utf8'), name)
    return parsed.ok ? [parsed.event] : []
  })
}

test('asking for a bot logs To Grok Bot; a confirmed sync logs From Grok Bot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-directions-'))
  const created = createOrgFiles(dir, 'Desk', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const root = join(dir, created.slug)
  writeBot(root, 'metric-change-bot', 'Metric Change Bot')
  try {
    assert.equal(requestGrokBot(root, created.slug, 'metric-change-bot').ok, true)
    const asked = logEvents(root).find((item) => item.grok === 'out')
    assert.equal(asked?.summary, 'Asked the Connector to create Metric Change Bot in Grok Bot')
    assert.equal(asked?.subjectSeatId, 'metric-change-bot')

    const read = readOrgDir(root, created.slug)
    assert.equal(read.ok, true)
    const plan: SyncPlan = { syncedAt: '2026-10-18T11:00:00.000Z', rows: [{ kind: 'new', name: 'Fresh Bot', note: '', bot: { name: 'Fresh Bot', grokBotUrl: '', reportsTo: 'You', owns: [], may: [], needsApproval: [], doneWhen: [], createdAt: '', lastActive: '', routines: [], botStatus: '', note: '', error: '' } }], counts: { new: 1, missing: 0, updated: 0, processes: 0, warnings: 0, unchanged: 0 }, writes: 1 }
    assert.equal(applySync(root, created.slug, plan).ok, true)
    assert.ok(logEvents(root).some((item) => item.grok === 'in' && item.summary.startsWith('Synced with Grok Bot')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the drawer splits coming and going, sends ticked bots, and the log shows the badge', () => {
  const drawer = readFileSync(new URL('../../src/components/SyncDrawer.tsx', import.meta.url), 'utf8')
  const log = readFileSync(new URL('../../src/components/LogPanel.tsx', import.meta.url), 'utf8')
  assert.match(drawer, /Coming from Grok Bot/)
  assert.match(drawer, /Going to Grok Bot/)
  assert.match(drawer, /type="checkbox"/)
  assert.match(drawer, /\/grok\/requests/)
  assert.match(drawer, /disabled=\{busy \|\| \(incoming === 0 && picked\.size === 0 && adopt\.size === 0\)\}/, 'Sync works with only outgoing or only unassigned bots ticked')
  assert.match(drawer, /\/sync\/adopt`/, 'ticked unassigned bots are added to this org')
  assert.match(log, /className=\{`grok-badge is-\$\{direction\}`\}/)
})
