import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GROK_DATA_FILE, RESULTS_FILE, TODO_FILE } from '../src/connector-files.ts'
import { createKeyBase, requestProgress, routineKeyBase, skillKeyBase, type ResultsFile, type TodoFile } from '../src/connector-todo.ts'
import type { GrokData } from '../src/grok-data.ts'
import { serializeRequests, type GrokRequest } from '../src/grok-requests.ts'
import { createOrgFiles, syncStatus } from '../src/template-server.ts'
import { clock, partLine, progressSummary, updateItems } from '../../src/components/sync-copy.ts'

const ORG = 'org-abcd2345'
const link = (id: string) => `grokbot://app/v1/agent?id=${id}`
const READ_AT = '2026-10-30T18:11:50+01:00'
const ACTED_AT = '2026-10-30T18:17:58+01:00'
const daily = { name: 'botseverywhere daily summary', schedule: '0 9,21 * * *', trigger: 'schedule' as const, timeZone: 'Europe/Madrid' }
const weekly = { name: 'Weekly growth report', schedule: '0 8 * * 1', trigger: 'schedule' as const, timeZone: 'Europe/Madrid' }
const status = { name: 'daily-status', description: 'Twice a day, one status.' }
const study = { name: 'viral-repo-study', description: 'Each week, study trending repos.' }

const data: GrokData = {
  dumpedAt: READ_AT,
  copy: 'acn8',
  bots: [{ id: 'g1', name: 'Grok Bot', grokBotUrl: link('g1'), description: 'Routes work.', routinesVisible: false }],
  skills: [status],
}
const create: GrokRequest = { seat: 'growth', name: 'Growth', seatFile: '', prompt: '', skills: [study], routines: [weekly], requestedAt: '2026-10-30T17:07:00.000Z' }
const update: GrokRequest = { seat: 'grok-bot', name: 'Grok Bot', seatFile: '', prompt: '', kind: 'update', grokBotUrl: link('g1'), reportsTo: 'You', skills: [status], routines: [daily], requestedAt: '2026-10-30T17:08:20.000Z' }
const todo = (items: string[], stuck: TodoFile['stuck'] = []): Pick<TodoFile, 'items' | 'stuck'> => ({
  // A describe item names its bot by Grok Bot id, as computeTodo writes it.
  items: items.map((key) => ({ key, kind: key.split(':')[0] as TodoFile['items'][number]['kind'], bot: 'x', org: ORG, ...(key.startsWith('describe:') ? { botId: key.split(':')[1] } : {}) })),
  stuck,
})
const stages = (parts: { label: string; stage: string }[] = []) => Object.fromEntries(parts.map((part) => [part.label, part.stage]))

test('each part of a request has its own stage: done after the reading, confirmed in it, waiting for the Connector', () => {
  const results: ResultsFile = {
    results: [
      { key: `${createKeyBase(create)}#1`, status: 'done', at: ACTED_AT, botId: 'n1' },
      { key: `${skillKeyBase(study)}#1`, status: 'done', at: ACTED_AT },
      { key: 'describe:g1:0123456789abcdef#1', status: 'done', at: ACTED_AT },
    ],
    confirmations: [],
  }
  const progress = requestProgress({ orgId: ORG, requests: [create, update], data, results, todo: todo([`${routineKeyBase(ORG, 'grok-bot', daily)}#1`]) })
  assert.deepEqual(stages(progress.growth), {
    'Create the bot': 'done',
    'Skill: viral-repo-study': 'done',
    'Routine: Weekly growth report': 'after-create',
  })
  assert.deepEqual(stages(progress['grok-bot']), {
    Instructions: 'done',
    'Skill: daily-status': 'confirmed',
    'Routine: botseverywhere daily summary': 'waiting',
  })
  assert.equal(progress.growth?.[0]?.at, ACTED_AT)
})

test('a request part moves from waiting to retrying to stuck, and a routine from asked to confirmed', () => {
  const routineKey = routineKeyBase(ORG, 'grok-bot', daily)
  const waiting = requestProgress({ orgId: ORG, requests: [update], data, results: { results: [], confirmations: [] }, todo: todo(['describe:g1:aaaa#1', `${routineKey}#1`]) })
  assert.equal(stages(waiting['grok-bot']).Instructions, 'waiting', 'nothing done yet')

  const failed = requestProgress({ orgId: ORG, requests: [update], data, results: { results: [{ key: 'describe:g1:aaaa#1', status: 'failed', at: ACTED_AT, why: 'read-back differed' }], confirmations: [] }, todo: todo(['describe:g1:aaaa#2']) })
  const instructions = failed['grok-bot']?.find((part) => part.label === 'Instructions')
  assert.equal(instructions?.stage, 'retrying')
  assert.equal(instructions?.why, 'read-back differed')

  const stuck = requestProgress({ orgId: ORG, requests: [update], data, results: { results: [{ key: `${routineKey}#1`, status: 'done', at: ACTED_AT }, { key: `${routineKey}#2`, status: 'done', at: ACTED_AT }], confirmations: [] }, todo: todo([], [{ bot: 'Grok Bot', org: ORG, why: 'Asked twice for the routine "botseverywhere daily summary"; Grok Bot has not confirmed it.' }]) })
  assert.equal(stages(stuck['grok-bot'])['Routine: botseverywhere daily summary'], 'stuck')

  const asked = requestProgress({ orgId: ORG, requests: [update], data, results: { results: [{ key: `${routineKey}#1`, status: 'done', at: ACTED_AT }], confirmations: [] }, todo: todo([]) })
  assert.equal(stages(asked['grok-bot'])['Routine: botseverywhere daily summary'], 'asked', 'the Connector sent the ask; the bot has not confirmed')

  const shown = { ...data, bots: [{ ...data.bots[0]!, routinesVisible: true, routines: [daily] }] }
  const confirmed = requestProgress({ orgId: ORG, requests: [update], data: shown, results: { results: [], confirmations: [] }, todo: todo([]) })
  assert.equal(stages(confirmed['grok-bot'])['Routine: botseverywhere daily summary'], 'confirmed')
})

test('an action the reading came after, but does not show, is not done: it is retried', () => {
  const late = requestProgress({ orgId: ORG, requests: [create], data: { ...data, dumpedAt: '2026-10-30T18:28:06+01:00' }, results: { results: [{ key: `${createKeyBase(create)}#1`, status: 'done', at: ACTED_AT }], confirmations: [] }, todo: todo([`${createKeyBase(create)}#2`]) })
  const part = late.growth?.find((item) => item.label === 'Create the bot')
  assert.equal(part?.stage, 'retrying')
  assert.equal(part?.why, 'reported done, but Grok Bot does not show it')
})

test('the words for each stage, and the one line in Logs', () => {
  assert.equal(clock(ACTED_AT, 'Europe/Madrid'), '18:17')
  const at = { at: ACTED_AT }
  assert.equal(partLine({ label: 'Instructions', stage: 'done', ...at }, 'Europe/Madrid'), "Instructions: done in Grok Bot at 18:17, confirming on the Connector's next reading")
  assert.equal(partLine({ label: 'Skill: daily-status', stage: 'confirmed' }), 'Skill: daily-status: confirmed in Grok Bot')
  assert.equal(partLine({ label: 'Routine: Daily', stage: 'asked', ...at }, 'Europe/Madrid'), 'Routine: Daily: asked at 18:17, waiting for the bot to confirm')
  assert.equal(partLine({ label: 'Create the bot', stage: 'waiting' }), "Create the bot: waiting for the Connector's next run")
  assert.equal(partLine({ label: 'Instructions', stage: 'retrying', why: 'read-back differed', ...at }, 'Europe/Madrid'), 'Instructions: failed at 18:17 (read-back differed), trying again on the next run')
  assert.equal(partLine({ label: 'Instructions', stage: 'stuck', why: 'Fix it in Grok Bot.' }), 'Instructions: stuck. Fix it in Grok Bot.')
  assert.equal(partLine({ label: 'Routine: Weekly', stage: 'after-create' }), 'Routine: Weekly: asked for once the bot is created')

  assert.deepEqual(progressSummary([{ label: 'A', stage: 'done' }, { label: 'B', stage: 'confirmed' }]), { text: 'Done in Grok Bot, confirming on the next reading', moving: true })
  assert.deepEqual(progressSummary([{ label: 'A', stage: 'done' }, { label: 'B', stage: 'waiting' }]), { text: 'Waiting for the Connector', moving: true })
  assert.deepEqual(progressSummary([{ label: 'A', stage: 'stuck' }, { label: 'B', stage: 'waiting' }]), { text: 'Stuck: needs you', moving: false })
  assert.deepEqual(progressSummary([{ label: 'A', stage: 'confirmed' }]), { text: 'Confirmed in Grok Bot', moving: false })
})

test('Profile and the Sync drawer say where each waiting change stands', () => {
  const parts = [{ label: 'Instructions', stage: 'done' as const, at: ACTED_AT }, { label: 'Skill: daily-status', stage: 'confirmed' as const }, { label: 'Routine: botseverywhere daily summary', stage: 'waiting' as const }]
  assert.deepEqual(updateItems({ reportsTo: 'You', previousReportsTo: 'Miguel', skills: [status], routines: [daily] }, parts, 'Europe/Madrid'), [
    "Reports to You (was Miguel): done in Grok Bot at 18:17, confirming on the Connector's next reading",
    'Skill: daily-status: confirmed in Grok Bot',
    "Routine: botseverywhere daily summary: waiting for the Connector's next run",
  ])
  assert.deepEqual(updateItems({ skills: [status] }), ['Skill: daily-status'], 'without progress, the change alone')
})

test('the sync status carries each request\'s progress, read from the Connector\'s files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-progress-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    assert.ok(made.ok)
    if (!made.ok) return
    const root = join(orgs, made.slug)
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'requests.json'), serializeRequests([{ ...update, seat: 'you' }]))
    writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify(data))
    writeFileSync(join(orgs, RESULTS_FILE), JSON.stringify({ results: [], confirmations: [] }))
    writeFileSync(join(orgs, TODO_FILE), JSON.stringify({ basedOn: READ_AT, items: [], stuck: [], otherCopies: [] }))
    const read = syncStatus(root, made.slug, orgs)
    assert.ok(read.ok)
    if (!read.ok) return
    assert.deepEqual(read.status.progress?.you?.map((part) => part.label), ['Instructions', 'Skill: daily-status', 'Routine: botseverywhere daily summary'])
    // A routine ask goes out from the Connector's own runs, so it waits for the Connector, never for the owner's chat.
    assert.equal(read.status.progress?.you?.[2]?.stage, 'waiting')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Logs shows the stage and the parts instead of a bare Syncing line', () => {
  const source = readFileSync(new URL('../../src/components/LogPanel.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /progressSummary\(/)
  assert.match(source, /className="be-log-parts"/)
  assert.match(source, /partLine\(/)
  assert.match(page, /progress=\{sync\?\.progress\}/)
  assert.match(page, /updateItems\(waitingUpdate, sync\?\.progress\?\.\[/)
})
