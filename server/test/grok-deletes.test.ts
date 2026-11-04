import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { recordConnectorRun } from '../src/connector-log.ts'
import { REQUESTS_PATH, canDelete, parseRequests, serializeRequests, stillInGrok } from '../src/grok-requests.ts'
import { parseLogMarkdown } from '../src/org-markdown.ts'
import { parseSeatMarkdown, type FileActivity } from '../src/org-files.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, readRequests, startTemplateServer } from '../src/template-server.ts'

const INBOX = 'grokbot://app/v1/agent?id=inbox'

test('Grok Bot cannot delete bots: the Connector prompt has no delete step, and old delete entries are dropped', () => {
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: '/home/me/orgs' })
  assert.doesNotMatch(prompt, /deletes/)
  const parsed = parseRequests(JSON.stringify({ requests: [{ seat: 'a-bot', name: 'A Bot' }], deletes: [{ grokBotUrl: INBOX }] }))
  assert.equal(parsed.ok && parsed.requests.length, 1, 'a file an earlier version wrote still reads')
  assert.doesNotMatch(serializeRequests([]), /deletes/, 'the next write drops it')
})

test('only a retired bot with a link and not yet deleted gets Delete in Grok Bot', () => {
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: INBOX }), true)
  assert.equal(canDelete({ kind: 'bot', status: 'active', grokBotUrl: INBOX }), false, 'retire it first')
  assert.equal(canDelete({ kind: 'bot', status: 'retired' }), false, 'no link to open')
  assert.equal(canDelete({ kind: 'human', status: 'retired', grokBotUrl: INBOX }), false)
  assert.equal(canDelete({ kind: 'bot', status: 'retired', grokBotUrl: INBOX, grokDeletedAt: '2026-10-20T13:03:00.000Z' }), false, 'already gone')
})

test('a bot counts as still in Grok Bot by its link, or by its name when the entry has no link', () => {
  const inbox = { grokBotUrl: INBOX, name: 'Inbox Bot' }
  assert.equal(stillInGrok(inbox, [{ name: 'Other', grokBotUrl: INBOX }]), true)
  assert.equal(stillInGrok(inbox, [{ name: 'Inbox Bot', grokBotUrl: '' }]), true, 'same name, no link: still there')
  assert.equal(stillInGrok(inbox, [{ name: 'Inbox Bot · Desk', grokBotUrl: '' }]), true)
  assert.equal(stillInGrok(inbox, [{ name: 'Inbox Bot', grokBotUrl: 'grokbot://other' }]), false, 'a different bot with the same name is not this one')
  assert.equal(stillInGrok(inbox, []), false)
})

function seat(root: string, slug: string, title: string, extra: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-deletes-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const make = (name: string) => {
    const made = createOrgFiles(orgs, name, 'Ada')
    if (!made.ok) throw new Error('no org')
    return made.slug
  }
  return { orgs, make, done: () => rmSync(dir, { recursive: true, force: true }) }
}

const minute = (n: number) => new Date(Date.now() + n * 60_000)
const retired = (link: string, at = minute(-20)) => `status: retired\nretiredAt: "${at.toISOString()}"\ngrokBotUrl: "${link}"\n`

/** One Connector run at a file time: each org's snapshot, then connector.json. */
function run(orgs: string, at: Date, perOrg: Record<string, { name: string; grokBotUrl?: string }[]>, unassigned: { name: string; grokBotUrl?: string }[] = []) {
  for (const [slug, bots] of Object.entries(perOrg)) {
    mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
    const path = join(orgs, slug, 'grok', 'snapshot.json')
    writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), bots, processes: [] }))
    utimesSync(path, at, at)
  }
  const path = join(orgs, CONNECTOR_FILE)
  writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), unassigned }))
  utimesSync(path, at, at)
}

function events(root: string): FileActivity[] {
  return readdirSync(join(root, 'log')).flatMap((name) => {
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) return []
    const parsed = parseLogMarkdown(readFileSync(join(root, 'log', name), 'utf8'), name)
    return parsed.ok ? [parsed.event] : []
  })
}

const deletedAt = (root: string, slug: string) => {
  const parsed = parseSeatMarkdown(slug, readFileSync(join(root, 'seats', `${slug}.md`), 'utf8'))
  return parsed.ok ? parsed.seat.grokDeletedAt ?? '' : 'bad'
}

test('a retired bot is marked deleted only on a newer run that reports it nowhere, with no request', () => {
  const { orgs, make, done } = project()
  try {
    const desk = make('Desk')
    const ledger = make('Ledger')
    const root = join(orgs, desk)
    seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
    seat(root, 'inbox-bot-2', 'Inbox Bot', retired(INBOX))
    const inbox = { name: 'Inbox Bot', grokBotUrl: INBOX }

    run(orgs, minute(-30), { [desk]: [], [ledger]: [] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(deletedAt(root, 'inbox-bot'), '', 'a run from before the retirement does not count')

    run(orgs, minute(1), { [desk]: [], [ledger]: [inbox] })
    recordConnectorRun(orgs, 'Connector')
    assert.equal(deletedAt(root, 'inbox-bot'), '', 'still in another organization')

    run(orgs, minute(2), { [desk]: [], [ledger]: [] }, [{ name: 'Inbox Bot' }])
    recordConnectorRun(orgs, 'Connector')
    assert.equal(deletedAt(root, 'inbox-bot'), '', 'the same name with no link counts as still there')

    run(orgs, minute(3), { [desk]: [], [ledger]: [] })
    writeFileSync(join(orgs, ledger, 'grok', 'snapshot.json'), '{broken', 'utf8')
    recordConnectorRun(orgs, 'Connector')
    assert.equal(deletedAt(root, 'inbox-bot'), '', 'an unreadable snapshot counts as still there')

    const last = minute(4)
    run(orgs, last, { [desk]: [], [ledger]: [] })
    recordConnectorRun(orgs, 'Connector')
    assert.ok(Math.abs(Date.parse(deletedAt(root, 'inbox-bot')) - last.getTime()) < 2000, 'the seat records the run')
    assert.equal(deletedAt(root, 'inbox-bot'), deletedAt(root, 'inbox-bot-2'), 'both seats with the link are marked')
    const log = events(root).filter((item) => item.kind === 'deleted')
    assert.equal(log.length, 1, 'one line for one bot')
    assert.match(log[0]!.summary, /Deleted in Grok Bot: Inbox Bot/)
    const after = parseSeatMarkdown('inbox-bot', readFileSync(join(root, 'seats', 'inbox-bot.md'), 'utf8'))
    assert.equal(after.ok && after.seat.status, 'retired', 'the seat stays retired')
    assert.equal(after.ok && canDelete(after.seat), false, 'no second Delete')
  } finally {
    done()
  }
})

test('the run that shows a retired bot gone logs Deleted, not also Bot left', () => {
  const { orgs, make, done } = project()
  try {
    const desk = make('Desk')
    const root = join(orgs, desk)
    seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
    run(orgs, minute(-1), { [desk]: [{ name: 'Inbox Bot', grokBotUrl: INBOX }] })
    recordConnectorRun(orgs, 'Connector')
    run(orgs, minute(1), { [desk]: [] })
    recordConnectorRun(orgs, 'Connector')
    const log = events(root)
    assert.equal(log.filter((item) => item.kind === 'deleted').length, 1)
    assert.equal(log.filter((item) => item.kind === 'bot-disconnected').length, 0)
  } finally {
    done()
  }
})

test('the sync status names organizations where a retired bot is still active, and a bad requests file never crashes', async () => {
  const { orgs, make, done } = project()
  const desk = make('Desk')
  const ledger = make('Ledger')
  const root = join(orgs, desk)
  seat(root, 'inbox-bot', 'Inbox Bot', retired(INBOX))
  seat(join(orgs, ledger), 'inbox-bot', 'Inbox Bot', `status: active\ngrokBotUrl: "${INBOX}"\n`)
  mkdirSync(join(root, 'grok'), { recursive: true })
  writeFileSync(join(root, REQUESTS_PATH), '{broken', 'utf8')
  assert.deepEqual(readRequests(root), { requests: [], error: 'grok/requests.json is not JSON.' })
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const status = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/${desk}/sync`)).json()) as { retiredElsewhere: Record<string, string[]> }
    assert.deepEqual(status.retiredElsewhere, { 'inbox-bot': ['Ledger'] })
    assert.equal((await fetch(`http://127.0.0.1:${started.port}/api/orgs/${desk}/grok/deletes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seat":"inbox-bot"}' })).status, 404, 'no delete requests any more')
  } finally {
    await started.close()
    done()
  }
})

test('Retired in the legend opens the list; Delete in Grok Bot explains why and links to the bot, and nothing waits', async () => {
  const { retiredGrokLine, retiredKindLabel, logLabel } = await import('../../src/components/sync-copy.ts')
  const { formatShortDate } = await import('../src/bot-metrics.ts')
  assert.equal(retiredKindLabel('human'), 'Human')
  assert.equal(retiredGrokLine({ grokBotUrl: INBOX }), 'Still in Grok Bot')
  assert.equal(retiredGrokLine({ grokBotUrl: '' }), 'No Grok Bot link, so the app cannot tell when it is gone')
  assert.equal(retiredGrokLine({ grokBotUrl: INBOX, grokDeletedAt: '2026-10-20T13:03:00.000Z' }), `Deleted from Grok Bot on ${formatShortDate('2026-10-20T13:03:00.000Z')}`)
  assert.equal(logLabel({ id: 'x', type: 'edit', kind: 'deleted' }), 'Deleted')
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const chart = read('../../src/components/OrgChart.tsx')
  const workspace = read('../../src/pages/Workspace.tsx')
  const drawer = read('../../src/components/RetiredDrawer.tsx')
  const sync = read('../../src/components/SyncDrawer.tsx')
  assert.match(chart, /Retired <span className="legend-count">\{retired\.count\}<\/span>/)
  assert.doesNotMatch(workspace, /be-retired/, 'the list under the chart is gone')
  assert.match(drawer, /onClick=\{\(\) => setDeleting\(seat\)\}>Delete in Grok Bot…<\/Button>/, 'the row opens the steps first')
  assert.match(drawer, /Grok Bot does not let the Connector, or any app outside Grok Bot, delete a bot\./)
  assert.match(drawer, /right-click <strong>\{deleting\.title\}<\/strong> in the sidebar, choose Delete, and confirm/)
  assert.match(drawer, /href=\{\(deleting\.grokBotUrl \?\? ''\)\.trim\(\)\} target="_blank" rel="noreferrer"/, 'then a link to that bot')
  assert.match(drawer, /Still active in \{elsewhere\.join\(', '\)\}\. Deleting it in Grok Bot stops it there too\./)
  assert.doesNotMatch(drawer, /Wait for it/)
  assert.doesNotMatch(sync, /deleted|delete in Grok Bot|deletes/i, 'the Sync drawer has no delete section')
  assert.doesNotMatch(workspace, /grok\/deletes/)
})

function retiredBot(slug: string, title: string, extra: string): ReturnType<typeof parseSeatMarkdown> {
  return parseSeatMarkdown(slug, `---
title: ${title}
department: general
reportsTo: you
addToGrokBotUrl: ""
status: retired
kind: bot
role: Bot
personId: ""
hiredAt: ""
retiredAt: "2026-10-27T14:09:16.615Z"
directoryId: ""
${extra}---

## Owns

## May

## Needs approval

## Done when
`)
}

function logEvent(type: FileActivity['type'], slug: string, summary: string): FileActivity {
  return { id: `${type}-${slug}`, orgId: 'org-test', type, actorSeatId: 'you', actorType: 'human', timestamp: '2026-10-27T14:09:16.615Z', summary, subjectSeatId: slug }
}

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

test('a Retired line in Logs offers Delete in Grok Bot… only for a bot still in Grok Bot, and only on your own org', async () => {
  const { LogPanel } = await import('../../src/components/LogPanel.tsx')
  const seats = [
    retiredBot('automations-bot', 'Automations Bot', `grokBotUrl: "${INBOX}"\n`),
    retiredBot('gone-bot', 'Gone Bot', `grokBotUrl: "${INBOX}-2"\ngrokDeletedAt: "2026-10-27T15:00:00.000Z"\n`),
    retiredBot('unlinked-bot', 'Unlinked Bot', ''),
  ].map((parsed) => {
    assert.ok(parsed.ok, 'fixture seat parses')
    return parsed.seat
  })
  const events = [
    logEvent('fire', 'automations-bot', 'Retired Automations Bot'),
    logEvent('hire', 'automations-bot', 'Hired Automations Bot'),
    logEvent('fire', 'gone-bot', 'Retired Gone Bot'),
    logEvent('fire', 'unlinked-bot', 'Retired Unlinked Bot'),
  ]
  const base = { events, stepNames: new Map(), onStep: () => undefined }
  const own = await render(LogPanel, { ...base, retired: { seats, activeElsewhere: {} } })
  const withButton = own.split('<li').filter((item) => item.includes('Delete in Grok Bot…'))
  assert.equal(withButton.length, 1, 'one line offers it')
  assert.match(withButton[0]!, /Retired Automations Bot/, 'on the Retired line of the bot still in Grok Bot')
  assert.match(withButton[0]!, /<span class="be-log-text">Retired Automations Bot<button [^>]*>Delete in Grok Bot…<\/button><\/span>/, 'right next to the text, not at the end of the line')
  const readOnly = await render(LogPanel, base)
  assert.doesNotMatch(readOnly, /Delete in Grok Bot/, 'templates and samples never offer it')
})

test('Delete in Grok Bot from Logs opens the same steps, links to the bot, and says where Deleted will show', async () => {
  const { DeleteInGrokBot } = await import('../../src/components/RetiredDrawer.tsx')
  const parsed = retiredBot('automations-bot', 'Automations Bot', `grokBotUrl: "${INBOX}"\n`)
  assert.ok(parsed.ok)
  const html = await render(DeleteInGrokBot, {
    deleting: parsed.seat,
    elsewhere: ['Ledger'],
    note: 'Logs shows Deleted in Grok Bot after the Connector’s next run.',
    onClose: () => undefined,
  })
  assert.match(html, /Delete Automations Bot in Grok Bot/)
  assert.match(html, /right-click <strong>Automations Bot<\/strong> in the sidebar, choose Delete, and confirm/)
  const link = /<a [^>]*>Open Automations Bot in Grok Bot<\/a>/.exec(html)?.[0] ?? ''
  assert.match(link, /href="grokbot:\/\/app\/v1\/agent\?id=inbox"/, 'links to that bot')
  assert.match(link, /target="_blank"/)
  assert.match(html, /Automations Bot is still active in Ledger\. Deleting it in Grok Bot stops it there too\./)
  assert.match(html, /Logs shows Deleted in Grok Bot after the Connector’s next run\./)
  assert.doesNotMatch(html, /The row here says Deleted/, 'the drawer’s own note is not shown in Logs')
})
