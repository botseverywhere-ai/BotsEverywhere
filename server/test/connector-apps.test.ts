import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseBotsFile } from '../src/bots-file.ts'
import { recordConnectorRun } from '../src/connector-log.ts'
import { connectorPrompt } from '../src/connector-prompt.ts'
import { performanceOnly, planSync } from '../src/grok-sync.ts'
import { parseLogMarkdown } from '../src/org-markdown.ts'
import { parseSeatMarkdown, serializeExistingSeat } from '../src/org-files.ts'
import { CONNECTOR_FILE, readConnector } from '../src/project.ts'
import { createOrgFiles, readOrgDir } from '../src/template-server.ts'
import { botApps } from '../../src/org/bot-apps.ts'

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

test('the Connector prompt asks for the apps connected to Grok Bot and the apps each bot uses, names and status only', () => {
  const prompt = connectorPrompt({ id: 'uft5', orgsFolder: 'C:\\orgs', syncMinutes: 17, timeZone: 'Europe/Madrid', windows: true })
  assert.match(prompt, /\(createdAt, lastActive, runs30d, tasksDone30d, routines, skills, apps, publicUrl, botStatus, grokSync, grokSyncedAt, grokMissingSince, grokDeletedAt\)/)
  assert.ok(prompt.includes([
    '11. Write C:\\orgs/connector.json with:',
    '   - "syncedAt": ISO datetime of now.',
    '   - "syncMinutes": 17 (how often you run, in minutes).',
    '   - "unassigned": every bot you run that belongs to no organization, in the same bot format as the snapshot, performance included.',
    '   - "apps": every app (connector) connected to this Grok Bot account, as [{ "name": "app name as Grok Bot shows it", "status": "connected" or "needsAuth" }]. Names and status only: never an account email, token, or private link.',
  ].join('\n')))
  assert.ok(prompt.includes('      "apps": ["names of connected apps this bot\'s description or routines use, e.g. Gmail"],\n      "publicUrl"'))
  assert.ok(prompt.includes('- skills: Grok Bot skills are one shared library, so list only the skills the bot\'s own description or a request tells it to use, with a name and, when you can see it, one line on what it does. Never list the whole library on every bot, and never invent skills; leave the list out if the bot uses none.'))
  assert.ok(prompt.includes('- apps lists only connected apps the bot\'s own description or routines name or clearly use, using the names from "apps" in connector.json. Never list every app on every bot; leave the list out when the bot uses none.'))
  assert.ok(prompt.includes('}\n\nThe values above show the shape only. Never copy an example value, including the 0s, true, and "active", into a file.\n\nRules:'))
  assert.ok(prompt.endsWith('- trigger.type is schedule, event, or manual. For event, set source to email, slack, github, webhook, or form.\n- Do not add fields that are not in this object.'))
})

test('a reported bot keeps its apps as plain names: a list of names or of objects with a name, repeats dropped', () => {
  const parsed = parseBotsFile(JSON.stringify({ bots: [
    { name: 'Invoice Bot', apps: ['Gmail', { name: 'Google Calendar' }, 'gmail', 5, '', { token: 'x' }] },
    { name: 'Plain Bot' },
  ] }))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  assert.deepEqual(parsed.rows[0]!.apps, ['Gmail', 'Google Calendar'])
  assert.deepEqual(parsed.rows[1]!.apps, [])
})

test('a seat file keeps the apps the Connector reported, and reads them back', () => {
  const written = serializeExistingSeat({ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice', reportsTo: 'you', owns: ['Rows'], may: ['Read'], mustAskBefore: ['Pay'], doneWhen: ['Listed'], apps: ['Gmail', 'Slack'] })
  assert.match(written, /apps: "\[\\"Gmail\\",\\"Slack\\"\]"/)
  const parsed = parseSeatMarkdown('invoice-bot', written)
  assert.ok(parsed.ok)
  if (parsed.ok) assert.deepEqual(parsed.seat.apps, ['Gmail', 'Slack'])
  const none = parseSeatMarkdown('plain-bot', serializeExistingSeat({ name: 'Plain Bot', grokBotUrl: '', reportsTo: 'you', owns: [], may: [], mustAskBefore: [], doneWhen: [] }))
  assert.ok(none.ok)
  if (none.ok) assert.equal(none.seat.apps, undefined)
})

test('a bot\'s apps follow each report and land on their own, like the numbers; a bot that stops using one drops it', () => {
  const seat = parseSeatMarkdown('invoice-bot', serializeExistingSeat({ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice', reportsTo: 'you', owns: ['Rows'], may: ['Read'], mustAskBefore: ['Pay'], doneWhen: ['Listed'], apps: ['Gmail', 'Slack'], grokSync: 'synced' }))
  assert.ok(seat.ok)
  if (!seat.ok) return
  const plan = (apps?: string[]) => planSync({ syncedAt: '2026-10-26T10:00:00.000Z', bots: parseBotsFile(JSON.stringify({ bots: [{ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice', ...(apps ? { apps } : {}) }] })).rows, processes: [] } as never, [seat.seat], [], 'Desk')
  const same = plan(['Gmail', 'Slack']).rows[0]!
  assert.equal(same.kind, 'unchanged')
  const more = plan(['Gmail', 'Slack', 'Google Calendar']).rows[0]!
  assert.equal(more.kind, 'updated')
  if (more.kind !== 'updated') return
  assert.deepEqual(more.patch.apps, ['Gmail', 'Slack', 'Google Calendar'])
  assert.ok(performanceOnly(more), 'apps apply on every Connector run without Sync')
  const fewer = plan(undefined).rows[0]!
  assert.equal(fewer.kind, 'updated')
  if (fewer.kind === 'updated') assert.deepEqual(fewer.patch.apps, [], 'left out means the bot uses none')
})

test('connector.json gives the account\'s apps: a name and connected or needsAuth, nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-apps-'))
  try {
    writeFileSync(join(dir, CONNECTOR_FILE), JSON.stringify({
      syncedAt: '2026-10-26T10:00:00.000Z',
      unassigned: [],
      apps: [
        { name: 'Gmail', status: 'connected', account: 'owner@example.com' },
        { name: 'Slack', status: 'needsAuth' },
        { name: 'Notion', status: 'broken' },
        { status: 'connected' },
        'Linear',
        { name: 'gmail', status: 'connected' },
      ],
    }))
    const read = readConnector(dir)
    assert.ok(read)
    assert.deepEqual(read!.apps, [
      { name: 'Gmail', status: 'connected' },
      { name: 'Slack', status: 'needsAuth' },
      { name: 'Notion', status: 'connected' },
      { name: 'Linear', status: 'connected' },
    ])
    writeFileSync(join(dir, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-26T10:00:00.000Z', unassigned: [] }))
    assert.equal(readConnector(dir)!.apps, undefined, 'a Connector on an older prompt reports no apps')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function botSeat(root: string, slug: string, title: string, extra = '') {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\ngrokBotUrl: "grokbot://${slug}"\ngrokSync: synced\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

function summaries(root: string): string[] {
  return readdirSync(join(root, 'log')).filter((name) => name.endsWith('.md') && !/^\d{4}-\d{2}-\d{2}\.md$/.test(name)).flatMap((name) => {
    const parsed = parseLogMarkdown(readFileSync(join(root, 'log', name), 'utf8'), name)
    return parsed.ok ? [parsed.event.summary] : []
  })
}

test('Logs say when an app connects to Grok Bot, needs sign-in, or leaves, and when a bot starts or stops using one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-apps-log-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    if (!made.ok) throw new Error('no org')
    const root = join(orgs, made.slug)
    botSeat(root, 'invoice-bot', 'Invoice Bot')
    mkdirSync(join(root, 'grok'), { recursive: true })
    const run = (at: Date, apps: { name: string; status: string }[], botApps: string[]) => {
      const snapshot = join(root, 'grok', 'snapshot.json')
      writeFileSync(snapshot, JSON.stringify({ syncedAt: at.toISOString(), bots: [{ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice-bot', apps: botApps }], processes: [] }))
      utimesSync(snapshot, at, at)
      const connector = join(orgs, CONNECTOR_FILE)
      writeFileSync(connector, JSON.stringify({ syncedAt: at.toISOString(), unassigned: [], apps }))
      utimesSync(connector, at, at)
      recordConnectorRun(orgs, 'Connector')
    }
    const first = new Date(Date.now() - 60 * 60_000)
    run(first, [{ name: 'Gmail', status: 'connected' }, { name: 'Slack', status: 'needsAuth' }], ['Gmail'])
    let lines = summaries(root)
    assert.ok(lines.includes('Apps in Grok Bot: Gmail, Slack (needs sign-in)'), lines.join(' | '))
    assert.ok(lines.includes('Invoice Bot now uses Gmail'))
    assert.match(readFileSync(join(root, 'seats', 'invoice-bot.md'), 'utf8'), /apps: "\[\\"Gmail\\"\]"/, 'the bot\'s apps land on the seat with the run')

    run(new Date(first.getTime() + 17 * 60_000), [{ name: 'Gmail', status: 'needsAuth' }, { name: 'Google Calendar', status: 'connected' }], ['Google Calendar'])
    lines = summaries(root)
    assert.ok(lines.includes('Gmail needs sign-in in Grok Bot'), lines.join(' | '))
    assert.ok(lines.includes('Google Calendar connected to Grok Bot'))
    assert.ok(lines.includes('Slack is no longer connected to Grok Bot'))
    assert.ok(lines.includes('Invoice Bot now uses Google Calendar and no longer uses Gmail'))
    const loaded = readOrgDir(root, made.slug)
    assert.ok(loaded.ok)
    if (loaded.ok) {
      const event = loaded.bundle.activity.find((item) => item.summary === 'Invoice Bot now uses Google Calendar and no longer uses Gmail')
      assert.equal(event?.subjectSeatId, 'invoice-bot')
      assert.equal(event?.kind, 'bot-apps')
      assert.equal(loaded.bundle.activity.find((item) => item.summary === 'Gmail needs sign-in in Grok Bot')?.kind, 'apps')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bot\'s apps carry the account status by name, any case; an app the account does not list is unknown', () => {
  const account = [{ name: 'Gmail', status: 'connected' as const }, { name: 'Slack', status: 'needsAuth' as const }]
  assert.deepEqual(botApps(['gmail', 'Slack', 'Notion'], account), [
    { name: 'gmail', status: 'connected' },
    { name: 'Slack', status: 'needsAuth' },
    { name: 'Notion', status: 'unknown' },
  ])
  assert.deepEqual(botApps(undefined, account), [])
})

test('apps show in the bot profile, on the org chart, in Performance, and in Logs', () => {
  assert.match(source('../../src/components/sync-copy.ts'), /apps: 'Apps'/)
  assert.match(source('../../src/components/sync-copy.ts'), /'bot-apps': 'Bot apps'/)
  const profile = source('../../src/components/BotProfile.tsx')
  assert.match(profile, /<h3 className="card-label">Apps used<\/h3>/, 'apps belong to the whole account, so Profile shows the ones this bot says it uses')
  assert.match(profile, /\{NEEDS_SIGN_IN\}/)
  assert.match(source('../../src/org/bot-apps.ts'), /NEEDS_SIGN_IN = 'needs sign-in in Grok Bot'/)
  assert.match(source('../../src/components/OrgChart.tsx'), /className="org-apps"/)
  assert.match(source('../../src/pages/Workspace.tsx'), /<th>Apps used<\/th>/)
})
