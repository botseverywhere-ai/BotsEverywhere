import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseRequests, serializeRequests } from '../src/grok-requests.ts'
import { clearHandledUpdates, createExistingBot, createHiredSeat, createOrgFiles, readOrgDir, readRequests, requestGrokUpdate, setSeatManager, startTemplateServer, updateSeatProfile } from '../src/template-server.ts'
import { outgoing, parseStats, waitingLogIds } from '../../src/components/sync-copy.ts'

const SKILLS = [{ name: 'Lead sort', description: 'Match a new lead.' }, { name: 'Weekly recap' }]

/** You, then Grok Bot under You, then Inner Loop and UX/UI under Grok Bot. Every bot is in Grok Bot. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-manager-grok-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  const root = join(orgs, made.slug)
  const add = (name: string, id: string, reportsTo: string) => {
    const bot = createExistingBot(root, made.slug, { name, grokBotUrl: `grokbot://app/v1/agent?id=${id}`, reportsTo, allowEmptyCard: true, grokSync: 'synced', grokSyncedAt: '2026-10-26T10:00:00.000Z' })
    assert.ok(bot.ok, bot.ok ? '' : bot.errors.join(' '))
    return bot.slug
  }
  const grok = add('Grok Bot', 'grok', 'you')
  const lead = add('Inner Loop', 'lead', grok)
  const ux = add('UX/UI', 'ux', grok)
  return { dir, orgs, root, org: made.slug, grok, lead, ux, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function moveEvent(p: ReturnType<typeof project>, slug: string) {
  const read = readOrgDir(p.root, p.org)
  assert.ok(read.ok)
  return read.bundle.activity.filter((item) => item.id.startsWith(`move-${slug}-`)).at(-1)
}

test('a new manager for a bot in Grok Bot waits for the Connector, and the log says who it reports to now', () => {
  const p = project()
  try {
    const moved = setSeatManager(p.root, p.org, p.ux, p.lead)
    assert.ok(moved.ok)
    assert.equal(moved.sent, true, 'the app says it goes to Grok Bot')
    const waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1)
    assert.equal(waiting[0]!.seat, p.ux)
    assert.equal(waiting[0]!.kind, 'update', 'the Connector already carries out updates and reports them done')
    assert.equal(waiting[0]!.grokBotUrl, 'grokbot://app/v1/agent?id=ux')
    assert.equal(waiting[0]!.reportsTo, 'Inner Loop')
    assert.equal(waiting[0]!.previousReportsTo, 'Grok Bot')
    assert.equal(waiting[0]!.skills, undefined, 'a manager change never sends skills again')
    assert.equal(waiting[0]!.routines, undefined, 'a manager change never sends routines again')
    const event = moveEvent(p, p.ux)
    assert.ok(event)
    assert.equal(event.summary, 'Moved UX/UI under Inner Loop')
    assert.equal(event.grok, 'out', 'a To Grok Bot line')
    assert.deepEqual(parseStats(event.stats), [['Reports to', 'Inner Loop'], ['Was', 'Grok Bot']])
  } finally {
    p.done()
  }
})

test('a bot not in Grok Bot yet changes manager without asking the Connector', () => {
  const p = project()
  try {
    assert.ok(createHiredSeat(p.root, p.org, { name: 'New Bot', kind: 'bot', slug: 'new-bot', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', owns: ['a'], may: ['b'], mustAskBefore: ['c'], doneWhen: ['d'] }).ok)
    const moved = setSeatManager(p.root, p.org, 'new-bot', p.lead)
    assert.ok(moved.ok)
    assert.equal(moved.sent, false)
    assert.equal(readRequests(p.root).requests.length, 0, 'it gets its manager when it is created')
    const event = moveEvent(p, 'new-bot')
    assert.ok(event)
    assert.equal(event.grok, undefined)
    assert.deepEqual(parseStats(event.stats), [['Reports to', 'Inner Loop'], ['Was', 'You']])
  } finally {
    p.done()
  }
})

test('a new manager joins the update already waiting for that bot, and Update bot keeps it', () => {
  const p = project()
  try {
    assert.ok(updateSeatProfile(p.root, p.org, p.ux, { skills: SKILLS }).ok)
    const asked = requestGrokUpdate(p.root, p.org, p.ux)
    assert.ok(asked.ok)
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    let waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1, 'one update per bot')
    assert.deepEqual(waiting[0]!.skills, SKILLS, 'the skills still go')
    assert.equal(waiting[0]!.reportsTo, 'Inner Loop')
    assert.equal(waiting[0]!.previousReportsTo, 'Grok Bot')
    assert.ok(waiting[0]!.requestedAt >= asked.request.requestedAt)

    assert.ok(requestGrokUpdate(p.root, p.org, p.ux).ok)
    waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1)
    assert.equal(waiting[0]!.reportsTo, 'Inner Loop', 'Update bot keeps the waiting manager')
    assert.equal(waiting[0]!.previousReportsTo, 'Grok Bot')

    assert.ok(setSeatManager(p.root, p.org, p.ux, 'you').ok)
    waiting = readRequests(p.root).requests
    assert.equal(waiting[0]!.reportsTo, 'You')
    assert.equal(waiting[0]!.previousReportsTo, 'Grok Bot', 'Grok Bot still knows the first manager')

    assert.ok(setSeatManager(p.root, p.org, p.ux, p.grok).ok)
    waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1, 'the skills still go')
    assert.equal(waiting[0]!.reportsTo, undefined, 'back to the manager Grok Bot knows: nothing to send about it')
    assert.equal(waiting[0]!.previousReportsTo, undefined)
  } finally {
    p.done()
  }
})

test('moving a bot back before the Connector runs drops the manager-only update', () => {
  const p = project()
  try {
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    const back = setSeatManager(p.root, p.org, p.ux, p.grok)
    assert.ok(back.ok)
    assert.equal(back.sent, false)
    assert.equal(readRequests(p.root).requests.length, 0)
  } finally {
    p.done()
  }
})

test('Update bot logs the skills and routines it sends by name', () => {
  const p = project()
  try {
    assert.ok(updateSeatProfile(p.root, p.org, p.ux, { skills: [...SKILLS, { name: 'Pipes | bars' }] }).ok)
    assert.ok(requestGrokUpdate(p.root, p.org, p.ux).ok)
    const read = readOrgDir(p.root, p.org)
    assert.ok(read.ok)
    const event = read.bundle.activity.find((item) => item.summary === 'Asked the Connector to update UX/UI in Grok Bot')
    assert.ok(event)
    assert.deepEqual(parseStats(event.stats), [['Skills', '3: Lead sort, Weekly recap, Pipes / bars'], ['Routines', '0']])
  } finally {
    p.done()
  }
})

test('when the Connector reports the update done, the From Grok Bot line says what was sent', () => {
  const p = project()
  try {
    assert.ok(updateSeatProfile(p.root, p.org, p.ux, { skills: SKILLS }).ok)
    assert.ok(requestGrokUpdate(p.root, p.org, p.ux).ok)
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    const waiting = readRequests(p.root).requests[0]!
    mkdirSync(join(p.root, 'grok'), { recursive: true })
    writeFileSync(join(p.root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-26T13:09:00.000Z', bots: [], processes: [], updated: [{ seat: p.ux, requestedAt: waiting.requestedAt }] }))
    clearHandledUpdates(p.root, p.org)
    assert.equal(readRequests(p.root).requests.length, 0)
    const read = readOrgDir(p.root, p.org)
    assert.ok(read.ok)
    const done = read.bundle.activity.find((item) => item.summary === 'Updated in Grok Bot: UX/UI')
    assert.ok(done)
    assert.equal(done.grok, 'in')
    const stats = parseStats(done.stats)
    assert.deepEqual(stats.slice(0, 4), [['Skills', '2: Lead sort, Weekly recap'], ['Routines', '0'], ['Reports to', 'Inner Loop'], ['Was', 'Grok Bot']])
    assert.equal(stats[4]?.[0], 'Asked')
  } finally {
    p.done()
  }
})

test('a manager-only update reported done says only the manager', () => {
  const p = project()
  try {
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    const waiting = readRequests(p.root).requests[0]!
    mkdirSync(join(p.root, 'grok'), { recursive: true })
    writeFileSync(join(p.root, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-26T13:09:00.000Z', bots: [], processes: [], updated: [{ seat: p.ux, requestedAt: waiting.requestedAt }] }))
    clearHandledUpdates(p.root, p.org)
    const read = readOrgDir(p.root, p.org)
    assert.ok(read.ok)
    const done = read.bundle.activity.find((item) => item.summary === 'Updated in Grok Bot: UX/UI')
    assert.ok(done)
    assert.deepEqual(parseStats(done.stats).map(([label]) => label), ['Reports to', 'Was', 'Asked'])
  } finally {
    p.done()
  }
})

test('requests.json keeps the new manager through a write and a read', () => {
  const request = { seat: 'ux-ui', name: 'UX/UI', seatFile: '/o/s.md', prompt: '', kind: 'update' as const, grokBotUrl: 'grokbot://app/v1/agent?id=ux', reportsTo: 'Inner Loop', previousReportsTo: 'Grok Bot', requestedAt: '2026-10-26T12:00:00.000Z' }
  const parsed = parseRequests(serializeRequests([request]))
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.requests, [request])
})

test('Sync lists each waiting change of a bot on its own pulsing line', () => {
  const update = { seat: 'ux-ui', name: 'UX/UI', seatFile: '', prompt: '', kind: 'update' as const, skills: SKILLS, reportsTo: 'Inner Loop', previousReportsTo: 'Grok Bot', requestedAt: '2026-10-26T12:00:00.000Z' }
  const managerOnly = { ...update, seat: 'lead', skills: undefined, previousReportsTo: undefined }
  const create = { seat: 'new-bot', name: 'New Bot', seatFile: '', prompt: '', requestedAt: '2026-10-26T12:01:00.000Z' }
  const going = outgoing(null, [update, managerOnly, create], [])
  const [first, second, third] = going.waiting
  assert.ok(first?.kind === 'update' && second?.kind === 'update')
  assert.deepEqual(first.items, ['Reports to Inner Loop (was Grok Bot)', 'Skill: Lead sort', 'Skill: Weekly recap'])
  assert.deepEqual(second.items, ['Reports to Inner Loop'])
  assert.equal('items' in third!, false, 'a bot to create keeps its own line')
  const drawer = readFileSync(new URL('../../src/components/SyncDrawer.tsx', import.meta.url), 'utf8')
  assert.match(drawer, /\{item\.items\.length \? null : <i className="be-pulse" aria-hidden="true" \/>\}<strong>\{item\.name\}<\/strong> · asked \{formatShortDate\(item\.requestedAt\)\}, sent on the Connector&apos;s next run\s*\{item\.items\.length \? <ul className="sync-update-items">\{item\.items\.map\(\(change, index\) => <li key=\{index\}><i className="be-pulse" aria-hidden="true" \/>\{change\}<\/li>\)\}<\/ul> : null\}/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.sync-group ul\.sync-update-items \{ margin: var\(--space-1\) 0 0; padding-left: var\(--space-4\); list-style: none; display: grid; gap: var\(--space-1\); \}/)
})

test('PUT .../manager answers whether the change goes to Grok Bot', async () => {
  const p = project()
  const started = await startTemplateServer({ port: 0, orgsDir: p.orgs, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${p.org}/seats/${p.ux}/manager`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reportsTo: p.lead }),
    })
    assert.equal(response.status, 200)
    assert.equal(((await response.json()) as { sent?: boolean }).sent, true)
    const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
    assert.match(workspace, /Seat moved\. Grok Bot gets the new manager on the Connector's next run\./)
  } finally {
    await started.close()
    p.done()
  }
})

test('a To Grok Bot line in Logs waits until the Connector carries it out', () => {
  const out = (id: string, seat: string, timestamp: string) => ({ id, grok: 'out' as const, kind: 'request', subjectSeatId: seat, timestamp })
  const events = [
    out('old-invoice', 'invoice-bot', '2026-10-26T11:56:00.000Z'),
    { id: 'done-invoice', grok: 'in' as const, kind: 'updated', subjectSeatId: 'invoice-bot', timestamp: '2026-10-26T12:15:00.000Z' },
    out('new-invoice', 'invoice-bot', '2026-10-26T13:00:00.000Z'),
    out('skills-qa', 'qa', '2026-10-26T12:20:00.000Z'),
    { id: 'move-qa', grok: 'out' as const, subjectSeatId: 'qa', timestamp: '2026-10-26T12:23:00.000Z' },
    { id: 'seen-qa', grok: 'in' as const, kind: 'bot-connected', subjectSeatId: 'qa', timestamp: '2026-10-26T12:30:00.000Z' },
    out('sent-ux', 'ux', '2026-10-26T12:00:00.000Z'),
  ]
  const requests = [{ seat: 'invoice-bot' }, { seat: 'qa' }]
  assert.deepEqual([...waitingLogIds(events, requests)].sort(), ['move-qa', 'new-invoice', 'skills-qa'], 'only lines after the last Updated or Created for a seat still waiting')
  assert.equal(waitingLogIds(events, []).size, 0, 'nothing waits once the Connector has carried it out')
})

test('a To Grok Bot line still waiting ends with Syncing with Grok Bot and the pulse, after its text', () => {
  const panel = readFileSync(new URL('../../src/components/LogPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /\{figures \? <small className="be-log-figures"> · \{figures\}<\/small> : null\}\s*\{waiting\?\.has\(event\.id\) \? <SyncState parts=\{progress\?\.\[event\.subjectSeatId \?\? ''\]\} \/> : null\}/)
  assert.match(panel, /if \(!parts\?\.length\) return <span className="be-log-syncing be-connecting"><i className="be-pulse" aria-hidden="true" \/>Syncing with Grok Bot<\/span>/, 'without progress from the writer, the old label')
  assert.doesNotMatch(panel, /Waiting for the Connector/, 'one visible label, after the text')
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.be-log-syncing \{ margin-left: var\(--space-3\); \}/)
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /<LogPanel events=\{activity\} waiting=\{waitingLogIds\(activity, sync\?\.requests \?\? \[\]\)\}/)
})

test('a skill added after a move joins the update waiting for the move', () => {
  const p = project()
  try {
    assert.ok(setSeatManager(p.root, p.org, p.ux, p.lead).ok)
    assert.ok(updateSeatProfile(p.root, p.org, p.ux, { skills: SKILLS }).ok)
    assert.ok(requestGrokUpdate(p.root, p.org, p.ux).ok)
    const waiting = readRequests(p.root).requests
    assert.equal(waiting.length, 1, 'one update for the bot')
    assert.deepEqual(waiting[0]!.skills, SKILLS)
    assert.equal(waiting[0]!.reportsTo, 'Inner Loop')
    assert.equal(waiting[0]!.previousReportsTo, 'Grok Bot')
  } finally {
    p.done()
  }
})

test('Profile keeps Update bot while an update waits, and lists each waiting change on its own line', async () => {
  const { updateWaitingLine } = await import('../../src/components/bot-profile-copy.ts')
  const { updateItems } = await import('../../src/components/sync-copy.ts')
  assert.match(updateWaitingLine('2026-10-26T12:51:00.000Z'), /^Asked .+\. The Connector sends them on its next run\.$/, 'unchanged without a list')
  assert.match(updateWaitingLine('2026-10-26T12:51:00.000Z', 2), /^Asked .+\. The Connector sends these on its next run:$/)
  assert.deepEqual(updateItems({ reportsTo: 'Sales Follow-up Bot', previousReportsTo: 'You', skills: [{ name: 'use invoice instructions modern company' }, { name: 'Weekly recap' }], routines: [{ name: 'Monday invoices' }] }), [
    'Reports to Sales Follow-up Bot (was You)',
    'Skill: use invoice instructions modern company',
    'Skill: Weekly recap',
    'Routine: Monday invoices',
  ])
  assert.deepEqual(updateItems({ skills: [{ name: 'Lead sort' }] }), ['Skill: Lead sort'])
  const profile = readFileSync(new URL('../../src/components/BotProfile.tsx', import.meta.url), 'utf8')
  assert.match(profile, /\{grokUpdateAt \? \([\s\S]*?Update waiting for the Connector[\s\S]*?updateWaitingLine\(grokUpdateAt, grokUpdateItems\.length\)[\s\S]*?<ul className="profile-update-items">\{grokUpdateItems\.map\(\(item, index\) => <li key=\{index\}><i className="be-pulse" aria-hidden="true" \/>\{item\}<\/li>\)\}<\/ul>[\s\S]*?\) : null\}\s*<Button variant="primary" type="button" onClick=\{onUpdateInGrok\}>\{UPDATE_LABEL\}<\/Button>/, 'one pulsing line per change, and the button stays under them')
  assert.match(profile, /\{grokUpdateItems\.length \? null : <i className="be-pulse" aria-hidden="true" \/>\}<strong>Update waiting for the Connector<\/strong>/, 'the title pulses only when there is no list to pulse')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /grokUpdateItems=\{waitingUpdate \? updateItems\(waitingUpdate, sync\?\.progress\?\.\[waitingUpdate\.seat\]\) : \[\]\}/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.profile-update-items \{ margin: 0; padding-left: 0; color: var\(--color-ink\); font-size: var\(--text-sm\); \}/)
  assert.match(css, /\.panel \.profile-update-items li::before \{ content: none; \}/, 'the pulse replaces the arrow')
  assert.match(css, /\.profile-update-items \.be-pulse \{ flex: none; margin: 6px 0 0; \}/)
})
