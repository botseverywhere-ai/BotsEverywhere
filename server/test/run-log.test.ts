import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { serializeSeat, type SeatDocument } from '../src/org-files.ts'
import { writeProcessFile } from '../src/process-files.ts'
import { appendRunLine, playRun, readRunLogDir } from '../src/run-log-files.ts'
import type { ProcessFile } from '../src/processes.ts'
import { CONNECTOR_BOT_NAME, CONNECTOR_LOG_BOT, connectorPrompt } from '../src/connector-prompt.ts'
import { orgChange } from '../src/live-hub.ts'
import { activitySentence, liveSeats, parseRunLog, planRun, waitingLines } from '../src/run-log.ts'
import { readOrgDir, startTemplateServer, writeOrgDir } from '../src/template-server.ts'
import type { OrgBundle } from '../src/org-files.ts'

const source = `# Run log 2026-10-17
- 09:02 | Invoice Bot | Invoice arrives | matched invoice | waiting | 1042
- this line is bad
- 09:03 | Only | Three
- 9:04 | Bot | Process | Step | done | -
- 09:05 | Bot | Process | Step | nope | -
`

test('the run log parser keeps six-field lines and counts the rest', () => {
  const parsed = parseRunLog(source, '2026-10-17')
  assert.equal(parsed.skipped, 3)
  assert.equal(parsed.lines.length, 2)
  assert.equal(parsed.lines[0]?.time, '09:02')
  assert.equal(parsed.lines[0]?.status, 'waiting')
  assert.equal(parsed.lines[0]?.note, '1042')
  assert.equal(parsed.lines[1]?.time, '09:04')
  assert.equal(activitySentence(parsed.lines[0]!), '09:02 Invoice Bot matched invoice 1042, waiting for your approval')
})

test('a simulated run appends valid lines and stops on a checkpoint', async () => {
  const process: ProcessFile = {
    slug: 'invoice-arrives',
    name: 'Invoice arrives',
    trigger: { type: 'event', schedule: '', source: 'email', description: 'An invoice lands.' },
    steps: [
      { seat: 'finance-bot', action: 'Match the invoice' },
      { seat: 'you', action: 'Approve payment' },
    ],
    doneWhen: 'Payment is approved.',
    next: '',
    notes: '',
  }
  const seats = [
    { slug: 'finance-bot', title: 'Finance Bot', kind: 'bot', mustAskBefore: [] },
    { slug: 'you', title: 'You', kind: 'human', mustAskBefore: [] },
  ]
  const planned = planRun(process, seats, new Date(2026, 9, 17, 9, 2, 0))
  assert.deepEqual(planned.map((line) => line.status), ['running', 'done', 'running', 'waiting'])
  assert.equal(planned.at(-1)?.bot, 'You')
  const dir = mkdtempSync(join(tmpdir(), 'be-run-'))
  const wrote = await playRun(dir, planned, 0)
  assert.equal(wrote, 4)
  const read = readRunLogDir(dir)
  assert.equal(read.skipped, 0)
  assert.equal(read.lines.length, 4)
  assert.equal(read.lines[0]?.time, '09:02')
  assert.equal(read.lines[3]?.status, 'waiting')
  const waiting = waitingLines(read.lines, [process])
  assert.equal(waiting.length, 1)
  assert.equal(waiting[0]?.step, 'Approve payment')
  const live = liveSeats(read.lines, [
    { slug: 'finance-bot', title: 'Finance Bot', reportsTo: 'you' },
    { slug: 'you', title: 'You', reportsTo: '' },
  ])
  assert.equal(live.get('finance-bot')?.running, false)
  assert.equal(live.get('finance-bot')?.reporting, true)
  assert.equal(live.get('you')?.running, false)
  rmSync(dir, { recursive: true, force: true })
})

test('the watcher pushes a log change and simulate writes a real file', async () => {
  const orgs = mkdtempSync(join(tmpdir(), 'be-live-'))
  const root = join(orgs, 'acme')
  mkdirSync(root, { recursive: true })
  const you = ownerSeat()
  assert.deepEqual(writeOrgDir(root, orgBundle([you])).errors, [])
  const process: ProcessFile = {
    slug: 'daily-brief',
    name: 'Daily brief',
    trigger: { type: 'manual', schedule: '', source: '', description: 'Start the brief.' },
    steps: [{ seat: 'you', action: 'Prepare the brief' }],
    doneWhen: 'The brief is ready.',
    next: '',
    notes: '',
  }
  assert.equal(writeProcessFile(root, process).ok, true)
  const started = await startTemplateServer({ orgsDir: orgs, port: 0 })
  try {
    const seen = waitForEvent(`http://127.0.0.1:${started.port}/api/orgs/acme/live`)
    await delay(80)
    appendRunLine(root, {
      date: '2026-10-17',
      time: '09:00',
      bot: 'You',
      process: 'Daily brief',
      step: 'Prepare the brief',
      status: 'running',
      note: '-',
      index: 0,
    })
    const payload = await seen
    assert.match(payload, /event: log/)
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/acme/processes/daily-brief/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paceMs: 0 }),
    })
    assert.equal(response.status, 202)
    const body = await response.json() as { lines: number }
    assert.equal(body.lines, 2)
    await delay(30)
    const read = readRunLogDir(root)
    assert.ok(read.lines.some((line) => line.status === 'done' && line.step === 'Prepare the brief'))
    assert.equal(read.skipped, 0)
    const org = readOrgDir(root, 'acme')
    assert.equal(org.ok, true)
  } finally {
    await started.close()
    rmSync(orgs, { recursive: true, force: true })
  }
})

test('a seat file or org.md on disk pushes an org event', async () => {
  assert.equal(orgChange('/orgs', 'acme/log/2026-10-17.md')?.kind, 'log')
  assert.equal(orgChange('/orgs', 'acme/processes/daily.md')?.kind, 'processes')
  assert.deepEqual(orgChange('/orgs', 'acme/seats/connector.md'), { slug: 'acme', kind: 'org' })
  assert.deepEqual(orgChange('C:/orgs', 'C:\\orgs\\acme\\org.md'), { slug: 'acme', kind: 'org' })
  assert.equal(orgChange('/orgs', 'acme/seats/notes.txt'), null)
  assert.equal(orgChange('/orgs', 'acme/readme.md'), null)

  const orgs = mkdtempSync(join(tmpdir(), 'be-seat-'))
  const root = join(orgs, 'acme')
  mkdirSync(root, { recursive: true })
  const you = ownerSeat()
  assert.deepEqual(writeOrgDir(root, orgBundle([you])).errors, [])
  const started = await startTemplateServer({ orgsDir: orgs, port: 0 })
  try {
    const seen = waitForEvent(`http://127.0.0.1:${started.port}/api/orgs/acme/live`, 'org')
    await delay(80)
    const seat = botSeat('connector', 'Connector - BotsEverywhere')
    writeFileSync(join(root, 'seats', 'connector.md'), seat.source.endsWith('\n') ? seat.source : `${seat.source}\n`)
    const payload = await seen
    assert.match(payload, /event: org/)
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/acme`)
    assert.equal(response.status, 200)
    const body = await response.json() as OrgBundle
    assert.ok(body.seats.some((item) => item.slug === 'connector' && item.title === 'Connector - BotsEverywhere'))
    const again = waitForEvent(`http://127.0.0.1:${started.port}/api/orgs/acme/live`, 'org')
    await delay(80)
    writeFileSync(join(root, 'org.md'), readFileSync(join(root, 'org.md')))
    assert.match(await again, /event: org/)
  } finally {
    await started.close()
    rmSync(orgs, { recursive: true, force: true })
  }
})

function waitForEvent(url: string, kind = 'log'): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let buf = ''
      const timer = setTimeout(() => {
        req.destroy()
        reject(new Error(`no live event in ${buf}`))
      }, 4000)
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8')
        if (buf.includes(`event: ${kind}`)) {
          clearTimeout(timer)
          req.destroy()
          resolve(buf)
        }
      })
    })
    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function botSeat(slug: string, title: string): SeatDocument {
  const draft = {
    slug,
    title,
    department: 'general',
    reportsTo: 'you',
    addToGrokBotUrl: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    status: 'active' as const,
    kind: 'bot' as const,
    role: 'Sync',
    personId: '',
    owns: ['The org files'],
    may: ['Read seats'],
    mustAskBefore: ['Nothing'],
    doneWhen: ['The chart shows the seat'],
  }
  return { ...draft, source: serializeSeat(draft) }
}

function ownerSeat(): SeatDocument {
  const draft = {
    slug: 'you',
    title: 'You',
    department: 'general',
    reportsTo: '',
    addToGrokBotUrl: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    status: 'active' as const,
    kind: 'human' as const,
    role: 'Owner',
    personId: 'person-you',
    owns: ['The work'],
    may: ['Edit the org'],
    mustAskBefore: ['Sending'],
    doneWhen: ['The brief is ready'],
  }
  return { ...draft, source: serializeSeat(draft) }
}

function orgBundle(seats: SeatDocument[]): OrgBundle {
  return {
    id: 'acme',
    org: {
      company: { name: 'Acme' },
      departments: [{ id: 'general', name: 'General' }],
      people: [{ id: 'person-you', name: 'You' }],
      seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })),
    },
    seats,
    work: {
      triggers: [{ id: 't', source: 'management', label: 'Start', example: 'Go' }],
      workstreams: [{ id: 'w', triggerId: 't', outcome: 'Done', ownerSeatId: 'you', kind: 'main', stepIds: ['s'] }],
      steps: [{ id: 's', workstreamId: 'w', name: 'Step', level: 2, executorSeatId: 'you' }],
      handoffs: [],
      checkpoints: [],
    },
    activity: [],
  }
}

test('the connector prompt names Connector', () => {
  assert.equal(CONNECTOR_BOT_NAME, 'Connector - BotsEverywhere')
  assert.equal(CONNECTOR_LOG_BOT, 'Connector')
  const prompt = connectorPrompt({ id: 'k3f9', orgsFolder: 'orgs' })
  assert.match(prompt, /^Create a bot named Connector - BotsEverywhere \(k3f9\)\./)
  assert.match(prompt, /The bot field on those lines is Connector\./)
  const retired = ['Bri', 'dge'].join('')
  assert.equal(prompt.toLowerCase().includes(retired.toLowerCase()), false)
  for (const file of ['../src/connector-prompt.ts', '../../src/pages/DocsPage.tsx', '../../src/components/ConnectGrok.tsx']) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    assert.equal(source.toLowerCase().includes(retired.toLowerCase()), false, file)
  }
})
