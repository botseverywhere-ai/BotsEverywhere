import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  deriveSteps,
  matchStepSeats,
  parseProcessMarkdown,
  parseProcessesFile,
  processSlug,
  scheduleFasterThanHourly,
  serializeProcess,
  stepText,
  waitsForYou,
  type ProcessFile,
} from '../src/processes.ts'
import { importProcessRows, readProcessDir, writeProcessFile } from '../src/process-files.ts'

const invoice: ProcessFile = {
  slug: 'invoice-arrives',
  name: 'Invoice arrives',
  trigger: { type: 'event', schedule: '', source: 'email', description: 'A supplier invoice lands in the inbox.' },
  steps: [
    { seat: 'invoice-bot', action: 'Match the invoice to the open bill' },
    { seat: 'you', action: 'Approve payment' },
  ],
  doneWhen: 'The invoice is matched and payment is approved or sent back.',
  next: '',
  notes: 'Finance follows the match.',
}

test('a process file round-trips through markdown', () => {
  const parsed = parseProcessMarkdown(invoice.slug, serializeProcess(invoice))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.process, invoice)
  const dir = mkdtempSync(join(tmpdir(), 'be-process-'))
  const written = writeProcessFile(dir, invoice)
  assert.equal(written.ok, true)
  const again = readProcessDir(dir).processes[0]
  assert.deepEqual(again, invoice)
  assert.match(readFileSync(join(dir, 'processes', 'invoice-arrives.md'), 'utf8'), /^name: Invoice arrives$/m)
})

test('a step is a checkpoint when the action contains a gated verb or the seat must ask', () => {
  const steps = deriveSteps(
    [
      { seat: 'invoice-bot', action: 'Match the invoice to the open bill' },
      { seat: 'you', action: 'Approve payment' },
      { seat: 'mail-bot', action: 'Send the receipt' },
    ],
    [
      { slug: 'you', title: 'You', kind: 'human', mustAskBefore: [] },
      { slug: 'invoice-bot', title: 'Invoice Bot', kind: 'bot', mustAskBefore: ['Sending a message outside the organization'] },
      { slug: 'mail-bot', title: 'Mail Bot', kind: 'bot', mustAskBefore: ['Sending a message outside the organization'] },
    ],
  )
  assert.equal(steps[0]?.checkpoint, false)
  assert.equal(steps[1]?.checkpoint, true)
  assert.equal(steps[1]?.because, 'pay')
  assert.equal(steps[1]?.approver, 'you')
  assert.equal(steps[2]?.checkpoint, true)
  assert.equal(steps[2]?.because, 'send')
  const asking = deriveSteps(
    [{ seat: 'invoice-bot', action: 'Draft the message outside the organization' }],
    [{ slug: 'invoice-bot', title: 'Invoice Bot', kind: 'bot', mustAskBefore: ['Sending a message outside the organization'] }],
  )
  assert.equal(asking[0]?.checkpoint, true)
  assert.equal(asking[0]?.approver, 'you')
})

test('process import keeps loose fields and reports an unknown seat', () => {
  const parsed = parseProcessesFile(JSON.stringify({
    processes: [
      {
        name: 'Loose',
        trigger: { type: 'event', source: 'carrier-pigeon', schedule: 15, description: ['Inbox'] },
        steps: 'Invoice Bot: Match it\nYou | Approve payment',
        doneWhen: ['Matched', 'Approved'],
        next: null,
        extra: true,
      },
      { trigger: { type: 'manual' } },
    ],
  }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.rows[0]?.error, '')
  assert.equal(parsed.rows[0]?.trigger.source, '')
  assert.equal(parsed.rows[0]?.trigger.schedule, '15')
  assert.equal(parsed.rows[0]?.trigger.description, 'Inbox')
  assert.match(parsed.rows[0]?.notes.join(' ') ?? '', /source was left out/)
  assert.equal(parsed.rows[0]?.doneWhen, 'Matched Approved')
  assert.equal(parsed.rows[0]?.next, '')
  assert.equal(parsed.rows[1]?.error, 'Name is required.')
  const matched = matchStepSeats(parsed.rows[0]!.steps, [
    { slug: 'invoice-bot', title: 'Invoice Bot' },
    { slug: 'you', title: 'You' },
  ])
  assert.deepEqual(matched.steps, [
    { seat: 'invoice-bot', action: 'Match it' },
    { seat: 'you', action: 'Approve payment' },
  ])
  const unknown = matchStepSeats([{ seat: 'Brand Bot', action: 'Post the note' }], [{ slug: 'you', title: 'You' }])
  assert.deepEqual(unknown.notes, ['Unknown seat Brand Bot.'])
  assert.equal(unknown.steps[0]?.seat, 'Brand Bot')
  assert.equal(parseProcessesFile('not json').ok, false)
  assert.equal(parseProcessesFile('{"bots":[]}').ok, false)
  assert.equal(processSlug('Invoice arrives'), 'invoice-arrives')
})

test('a schedule that fires more than once an hour is flagged', () => {
  assert.equal(scheduleFasterThanHourly('Mon 09:00'), false)
  assert.equal(scheduleFasterThanHourly('weekdays 08:00'), false)
  assert.equal(scheduleFasterThanHourly('0 * * * *'), false)
  assert.equal(scheduleFasterThanHourly('0 9 * * 1'), false)
  assert.equal(scheduleFasterThanHourly('*/15 * * * *'), true)
  assert.equal(scheduleFasterThanHourly('* * * * *'), true)
  assert.equal(scheduleFasterThanHourly('0,30 * * * *'), true)
  assert.equal(scheduleFasterThanHourly('every 15 minutes'), true)
  assert.equal(scheduleFasterThanHourly('every minute'), true)
  assert.equal(scheduleFasterThanHourly('every hour'), false)
})

test("importing again replaces a flow with Grok Bot's latest version instead of writing a -2 copy; a name listed twice in one file keeps the first", () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-process-import-'))
  const seats = [{ slug: 'invoice-bot', title: 'Invoice Bot' }]
  const row = { name: 'Invoice arrives', trigger: { type: 'manual' }, steps: [{ seat: 'Invoice Bot', action: 'Match it' }], doneWhen: 'Matched' }
  const parsed = parseProcessesFile(JSON.stringify({ processes: [row, { ...row, doneWhen: 'Twice' }] }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const first = importProcessRows(dir, parsed.rows, seats)
  assert.deepEqual(first.imported.map((item) => [item.slug, item.replaced]), [['invoice-arrives', false]])
  assert.deepEqual(first.errors, [{ name: 'Invoice arrives', error: 'Listed twice in this file. The first one was kept.' }])
  const newer = parseProcessesFile(JSON.stringify({ processes: [{ ...row, steps: [{ seat: 'Invoice Bot', action: 'Match it' }, { seat: 'Invoice Bot', action: 'Needs approval: pay it' }], doneWhen: 'Paid' }] }))
  assert.equal(newer.ok, true)
  if (!newer.ok) return
  const again = importProcessRows(dir, newer.rows, seats)
  assert.deepEqual(again.imported.map((item) => [item.slug, item.replaced]), [['invoice-arrives', true]])
  assert.deepEqual(again.errors, [])
  assert.deepEqual(readdirSync(join(dir, 'processes')).sort(), ['invoice-arrives.md'])
  const flow = readProcessDir(dir).processes[0]!
  assert.deepEqual([flow.steps.length, flow.doneWhen], [2, 'Paid'], 'the flow is now what Grok Bot sent last')
})

test('importing replaces every flow of the same name, whoever made it, and leaves the other flows alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-process-import-'))
  const seats = [{ slug: 'aura', title: 'Aura' }, { slug: 'prod', title: 'Prod' }]
  const trigger = { type: 'schedule' as const, schedule: '0 9 * * 1', source: '', description: '' }
  writeProcessFile(dir, { slug: 'clip-brief', name: 'Clip brief', trigger, steps: [{ seat: 'aura', action: 'Clip brief' }], doneWhen: '', next: '', notes: '' })
  writeProcessFile(dir, { slug: 'health', name: 'Health', trigger, steps: [{ seat: 'prod', action: 'Health' }], doneWhen: 'The site is up', next: '', notes: '' })
  writeProcessFile(dir, { slug: 'wall', name: 'Wall', trigger, steps: [{ seat: 'prod', action: 'Ask for posts' }], doneWhen: '', next: '', notes: '' })
  const full = (name: string) => ({ name, trigger: { type: 'schedule', schedule: '0 9 * * 1' }, steps: [{ seat: 'Aura', action: 'Find stories' }, { seat: 'Prod', action: 'Redeploy' }] })
  const parsed = parseProcessesFile(JSON.stringify({ processes: [full('Clip brief'), full('Health')] }))
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const result = importProcessRows(dir, parsed.rows, seats)
  assert.deepEqual(result.imported.map((item) => [item.slug, item.replaced]), [['clip-brief', true], ['health', true]])
  assert.deepEqual(result.errors, [])
  const flows = readProcessDir(dir).processes
  assert.deepEqual(flows.find((item) => item.slug === 'clip-brief')?.steps.map((step) => step.action), ['Find stories', 'Redeploy'])
  assert.deepEqual(flows.find((item) => item.slug === 'health')?.steps.map((step) => step.action), ['Find stories', 'Redeploy'])
  assert.deepEqual(flows.find((item) => item.slug === 'wall')?.steps.map((step) => step.action), ['Ask for posts'], 'a flow not in the file stays')
})

test("the Work Chart tags a step as waiting for you only when Grok Bot marks it 'Needs approval:', never from words or who does it; the copied routine still asks before risky steps", () => {
  const steps = deriveSteps(
    [
      { seat: 'grok', action: 'Send you the summary' },
      { seat: 'inner', action: 'Run the prompt through the coding agent' },
      { seat: 'inner', action: 'Reply with what changed and what is merged' },
      { seat: 'x', action: 'Needs approval: send you the drafts' },
      { seat: 'you', action: 'Post it from your own account' },
    ],
    [
      { slug: 'you', title: 'You', kind: 'human', mustAskBefore: [] },
      { slug: 'grok', title: 'Grok Bot', kind: 'bot', mustAskBefore: [] },
      { slug: 'inner', title: 'Inner Loop', kind: 'bot', mustAskBefore: ['Large refactors outside the prompt scope'] },
      { slug: 'x', title: 'x.com', kind: 'bot', mustAskBefore: [] },
    ],
  )
  assert.deepEqual(steps.map((step) => waitsForYou(step)), [false, false, false, true, false])
  assert.deepEqual(steps.map((step) => step.checkpoint), [true, true, true, true, true], 'the copied routine keeps every safety ask')
})

test('the Work Chart import prompt is the one Grok Bot recommended, word for word, with this organization\'s bots', async () => {
  const { grokProcessesPrompt } = await import('../src/processes.ts')
  const rules = `Use exactly this JSON format and nothing else:
{"processes":[{"name":"","trigger":{"type":"schedule","schedule":"Mon 09:00","description":""},"steps":[{"seat":"","action":""}],"doneWhen":"","next":""}]}

Rules:
- One process per routine, using the routine's real name. Also add a process for each handoff one bot regularly sends another (in chats or routines) that has no routine of its own, with trigger type manual or event.
- trigger.type is schedule, event, or manual. For schedule, use words like "Mon 09:00" or the routine's cron line, and put its time zone in description. For event, set source to email, slack, github, webhook, or form, plus a short description. For manual, a description is enough.
- If a routine is paused, still include it and end its trigger description with "(paused)".
- steps are in order. seat is the exact name of the bot or person who does that step, written as "You" for me. action is one short line. When a step waits on another bot's reply, add that bot's step too.
- Any step that must ask me first starts its action with "Needs approval:".
- doneWhen is one sentence, taken from the bot's instructions or routine. Leave it out if they don't say.
- next is the name of another process in this file that this one hands off to. Leave it out otherwise.
- Take steps only from each routine's own text and the bot's instructions. Ignore every block starting with "=== BotsEverywhere" and every Connector message. Never invent steps, bots or schedules, and leave a field out when you don't know it.
- Do not add fields that are not in this object.
- Send me the file to download. If you can't, reply with only the JSON so I can save it myself.`
  assert.equal(grokProcessesPrompt(['Inner Loop - botseverywhere', 'x.com - botseverywhere', 'x.com - botseverywhere']), `List the routines and handoffs that these bots already run: Inner Loop - botseverywhere, x.com - botseverywhere. Leave out every other bot. Save them as one file named botseverywhere-processes.json so I can import them into the BotsEverywhere Work Chart.\n\n${rules}`)
  assert.equal(grokProcessesPrompt(), `List the routines and handoffs your bots already run for this organization. Save them as one file named botseverywhere-processes.json so I can import them into the BotsEverywhere Work Chart.\n\n${rules}`)
})

test("Grok Bot's Needs approval: mark adds a checkpoint and never removes one: the seat's Needs approval list and the risky verbs still count in a marked process; steps read without the mark", () => {
  const seats = [
    { slug: 'you', title: 'Sam', kind: 'human', mustAskBefore: [] },
    { slug: 'inner', title: 'Inner Loop', kind: 'bot', mustAskBefore: ['Running a prompt through the coding agent'] },
    { slug: 'x', title: 'x.com', kind: 'bot', mustAskBefore: [] },
  ]
  const steps = deriveSteps([
    { seat: 'inner', action: 'Run the prompt through the coding agent until tests pass' },
    { seat: 'inner', action: 'Merge to main' },
    { seat: 'x', action: 'Needs approval: change the pricing page' },
    { seat: 'x', action: 'Compare with drafted milestones' },
  ], seats)
  assert.deepEqual(steps.map((step) => step.checkpoint), [true, true, true, false], "the seat's own rule and a risky verb still ask, though another step carries the mark")
  assert.equal(steps[0]!.because, 'Running a prompt through the coding agent')
  assert.equal(steps[1]!.because, 'merge')
  assert.equal(steps[2]!.because, 'Needs approval', 'the mark asks where no word would')
  assert.equal(stepText('Needs approval: send you the exact post text'), 'send you the exact post text')
  assert.equal(stepText('  needs approval:merge to main'), 'merge to main')
  assert.equal(stepText('Gather context'), 'Gather context')
})
