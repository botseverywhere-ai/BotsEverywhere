/**
 * Writes src/data/mock-companies.json for the 15 Oct preview.
 * Ten fictional companies plus the owner org, Bot Company X, which is fictional too. Run: npx tsx scripts/build-preview-seed.ts
 */
import { writeFileSync } from 'node:fs'
import { ACTIVITY, QA_RUN, SEEDED_SEATS } from './owner-org.ts'
import type { CompanySeed, DemoActivity, LogEvent, MockSeed, Seat, SeatType } from '../src/data/mock-companies.ts'
import { displayCardText } from '../src/preview/card-text.ts'

const AS_OF = '2026-10-14'

interface Person {
  key: string
  name: string
  role: string
  dept: string
  reports: string
}

interface BotSpec extends Person {
  usage: number
  tasks: number
  last: string
  least?: boolean
  retired?: boolean
}

interface StepSpec {
  key: string
  name: string
  exec: string
  level: 2 | 3 | 4
  checkpoint?: string
}

interface CompanyDef {
  id: string
  name: string
  industry: string
  tagline: string
  address: string
  revenueBand: string
  headcount: string
  founded: number
  mark: string
  markColor: string
  city: string
  domain: string
  phone: string
  clients: [string, string, string]
  owner: Person
  leads: Person[]
  humans: Person[]
  clerk: Person
  system: Person
  bots: BotSpec[]
  trigger: { source: 'email' | 'chat' | 'meeting' | 'dashboard' | 'customer' | 'alert' | 'management' | 'schedule'; label: string; example: string }
  outcome: string
  approver: string
  steps: StepSpec[]
  contingencyName: string
  contingencyOutcome: string
  contingency: StepSpec[]
}

function lines(text: string): string[] {
  const trimmed = text.trim()
  return trimmed ? [trimmed] : []
}

function stamp(day: string, hour: number): string {
  return `${day}T${String(hour).padStart(2, '0')}:20:00-05:00`
}

function emailFor(name: string, domain: string): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
  return `${slug}@${domain}`
}

function build(def: CompanyDef): CompanySeed {
  const orgId = def.id
  const seats: Seat[] = []

  function add(
    person: Person,
    type: SeatType,
    extra?: { usage?: number; tasks?: number; last?: string; retired?: boolean; prompt?: string },
  ) {
    const id = `${orgId}-${person.key}`
    const retired = Boolean(extra?.retired)
    const seat: Seat = {
      id,
      orgId,
      name: person.name,
      role: person.role,
      type,
      reportsTo: person.reports === 'top' ? undefined : `${orgId}-${person.reports}`,
      curated: true,
      card: cardFor(def, person, type),
      profile: {
        department: person.dept,
        location: def.city,
        email: type === 'system' ? `intake@${def.domain}` : emailFor(person.name, def.domain),
        phone: def.phone,
        startedOn: type === 'bot' ? '2026-03-02' : '2019-06-17',
        bio: bioFor(def, person, type),
      },
      status: type === 'bot' ? (retired ? 'retired' : 'active') : 'active',
    }
    if (type === 'bot') {
      seat.prompt = extra?.prompt ?? `You are ${person.name}, ${person.role} at ${def.name}. ${seat.card.owns[0] ?? ''}`
      seat.grokShareUrl = null
      seat.integrations = ['Grok Bot']
      seat.hiredAt = retired ? '2026-01-14' : '2026-03-02'
      seat.retiredAt = retired ? stamp('2026-09-16', 16) : null
      seat.stats = {
        usageCount30d: extra?.usage ?? 0,
        tasksDone30d: extra?.tasks ?? 0,
        lastActiveAt: stamp(extra?.last ?? '2026-10-01', 11),
      }
    }
    seats.push(seat)
    return id
  }

  const owner = { ...def.owner, reports: 'top' }
  add(owner, 'human')
  for (const lead of def.leads) add(lead, 'human')
  for (const human of def.humans) add(human, 'human')
  add(def.clerk, 'human')
  add(def.system, 'system')
  for (const bot of def.bots) {
    add(bot, 'bot', { usage: bot.usage, tasks: bot.tasks, last: bot.last, retired: bot.retired })
  }

  const sid = (key: string) => `${orgId}-${key}`
  const mainId = `${orgId}-main`
  const extraId = `${orgId}-exception`
  const triggerId = `${orgId}-trigger`
  const steps = def.steps.map((step) => ({
    id: `${orgId}-step-${step.key}`,
    workstreamId: mainId,
    name: step.name,
    level: step.level,
    executorSeatId: sid(step.exec),
    inputs: [`${def.clients[0]} source document`],
    outputs: [`${step.name} for ${def.clients[0]}`],
    exceptionTo: step.key === def.steps[1]?.key ? extraId : undefined,
    checkpointId: step.checkpoint ? `${orgId}-cp-${step.key}` : undefined,
  }))
  const extraSteps = def.contingency.map((step) => ({
    id: `${orgId}-step-${step.key}`,
    workstreamId: extraId,
    name: step.name,
    level: step.level,
    executorSeatId: sid(step.exec),
    inputs: ['Exception from the main stream'],
    outputs: [step.name],
    checkpointId: step.checkpoint ? `${orgId}-cp-${step.key}` : undefined,
  }))
  const allSteps = [...steps, ...extraSteps]
  const handoffs = []
  for (let i = 1; i < steps.length; i += 1) {
    handoffs.push({ id: `${orgId}-hand-${i}`, fromStepId: steps[i - 1].id, toStepId: steps[i].id })
  }
  handoffs.push({
    id: `${orgId}-hand-exception`,
    fromStepId: steps[1].id,
    toStepId: extraSteps[0].id,
    condition: 'mismatch',
  })
  if (extraSteps.length > 1) {
    handoffs.push({ id: `${orgId}-hand-extra`, fromStepId: extraSteps[0].id, toStepId: extraSteps[1].id })
    const approve = steps.find((step) => step.checkpointId)
    if (approve) {
      handoffs.push({
        id: `${orgId}-hand-rejoin`,
        fromStepId: extraSteps[extraSteps.length - 1].id,
        toStepId: approve.id,
        condition: 'resolved',
      })
    }
  }
  const checkpoints = allSteps
    .filter((step) => step.checkpointId)
    .map((step) => ({
      id: step.checkpointId as string,
      stepId: step.id,
      rule: [...def.steps, ...def.contingency].find((item) => `${orgId}-step-${item.key}` === step.id)?.checkpoint ?? '',
      approverSeatId: sid(def.approver),
      required: true,
    }))

  const seatByKey = new Map(seats.map((seat) => [seat.id, seat]))
  const log: LogEvent[] = []
  let n = 0
  function push(event: Omit<LogEvent, 'id' | 'orgId'>) {
    n += 1
    log.push({ id: `${orgId}-log-${n}`, orgId, ...event })
  }

  for (const bot of def.bots) {
    const actorId = sid(bot.key)
    const step = allSteps.find((item) => item.executorSeatId === actorId) ?? steps[0]
    const days = bot.least || bot.retired ? [bot.last] : spread(bot.last, bot.tasks)
    for (const [index, day] of days.entries()) {
      push({
        type: 'work',
        actorSeatId: actorId,
        actorType: 'bot',
        timestamp: stamp(day, 9 + (index % 6)),
        summary: `${bot.name} completed ${step.name.toLowerCase()} for ${def.clients[index % 3]}.`,
        stepId: step.id,
        workstreamId: step.workstreamId,
        status: 'done',
      })
    }
  }

  const approver = seatByKey.get(sid(def.approver))
  const approveStep = steps.find((step) => step.checkpointId) ?? steps[steps.length - 1]
  for (const day of ['2026-10-03', '2026-10-07', '2026-10-09', '2026-10-13']) {
    push({
      type: 'approval',
      actorSeatId: sid(def.approver),
      actorType: 'human',
      timestamp: stamp(day, 15),
      summary: `${approver?.name ?? 'Approver'} approved ${approveStep.name.toLowerCase()} for ${def.clients[0]}.`,
      stepId: approveStep.id,
      workstreamId: mainId,
      status: 'approved',
      approverSeatId: sid(def.approver),
    })
  }

  const exceptionActor = def.bots.find((bot) => !bot.least && !bot.retired) ?? def.bots[0]
  const exceptionStep = extraSteps[0]
  for (const day of ['2026-10-06', '2026-10-08']) {
    push({
      type: 'exception',
      actorSeatId: sid(exceptionActor.key),
      actorType: 'bot',
      timestamp: stamp(day, 13),
      summary: `${exceptionActor.name} opened an exception on ${def.clients[1]} and drafted the next question.`,
      stepId: exceptionStep.id,
      workstreamId: extraId,
      status: 'exception',
    })
  }

  const hired = def.bots.find((bot) => !bot.retired && !bot.least) ?? def.bots[0]
  push({
    type: 'hire',
    actorSeatId: sid(def.owner.key),
    actorType: 'human',
    timestamp: stamp('2026-09-22', 10),
    summary: `${def.owner.name} hired ${hired.name} into ${hired.role}.`,
    subjectSeatId: sid(hired.key),
    stepId: steps.find((step) => step.executorSeatId === sid(hired.key))?.id,
    workstreamId: mainId,
    status: 'done',
  })

  const retired = def.bots.find((bot) => bot.retired)
  if (retired) {
    push({
      type: 'fire',
      actorSeatId: sid(def.owner.key),
      actorType: 'human',
      timestamp: stamp('2026-09-16', 16),
      summary: `${def.owner.name} retired ${retired.name}. The seat was no longer used.`,
      subjectSeatId: sid(retired.key),
      workstreamId: mainId,
      status: 'done',
    })
  }

  push({
    type: 'work',
    actorSeatId: sid(def.system.key),
    actorType: 'system',
    timestamp: stamp('2026-10-13', 8),
    summary: `${def.system.name} took in a new file from ${def.clients[2]}.`,
    stepId: steps[0].id,
    workstreamId: mainId,
    status: 'done',
  })

  for (const seat of seats) {
    if (seat.type !== 'bot' || !seat.stats) continue
    const mine = log.filter((event) => event.actorSeatId === seat.id)
    const work = mine.filter((event) => event.type === 'work')
    seat.stats.tasksDone30d = work.length
    const latest = mine.map((event) => event.timestamp).sort().at(-1)
    if (latest) seat.stats.lastActiveAt = latest
  }

  const activity = log.slice(0, 22).map((event, index) => ({
    id: `${orgId}-act-${index + 1}`,
    at: event.timestamp,
    workstreamId: event.workstreamId || mainId,
    stepId: event.stepId || steps[0].id,
    actorSeatId: event.actorSeatId,
    actorType: event.actorType,
    action: event.type === 'approval' ? 'approved' as const : event.type === 'exception' ? 'flagged' as const : event.type === 'hire' ? 'started' as const : event.type === 'fire' ? 'rejected' as const : 'completed' as const,
    status: event.type === 'approval' ? 'approved' as const : event.type === 'exception' ? 'exception' as const : event.type === 'fire' ? 'rejected' as const : 'done' as const,
    inputRefs: [def.clients[0]],
    outputRefs: event.type === 'exception' ? [extraId] : [event.summary],
    approverSeatId: event.approverSeatId,
    note: event.summary,
  }))

  return {
    org: {
      id: orgId,
      name: def.name,
      description: def.tagline,
      industry: def.industry,
      mock: true,
      tagline: def.tagline,
      address: def.address,
      revenueBand: def.revenueBand,
      headcount: def.headcount,
      founded: def.founded,
      mark: def.mark,
      markColor: def.markColor,
      seatIds: seats.map((seat) => seat.id),
      workstreamIds: [mainId, extraId],
    },
    seats,
    triggers: [{ id: triggerId, orgId, source: def.trigger.source, label: def.trigger.label, example: def.trigger.example }],
    workstreams: [
      {
        id: mainId,
        orgId,
        triggerId,
        outcome: def.outcome,
        ownerSeatId: sid(def.approver),
        kind: 'main',
        stepIds: steps.map((step) => step.id),
      },
      {
        id: extraId,
        orgId,
        triggerId,
        outcome: def.contingencyOutcome,
        ownerSeatId: sid(def.approver),
        parentWorkstreamId: mainId,
        kind: 'contingency',
        stepIds: extraSteps.map((step) => step.id),
      },
    ],
    steps: allSteps,
    handoffs,
    checkpoints,
    activity,
    log: log.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
  }
}

function spread(last: string, count: number): string[] {
  const days: string[] = []
  const cursor = new Date(`${last}T12:00:00Z`)
  for (let i = 0; i < count; i += 1) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() - 2)
  }
  return days
}

function cardFor(def: CompanyDef, person: Person, type: SeatType) {
  const client = def.clients[0]
  if (type === 'system') {
    return {
      owns: [`Receiving ${def.trigger.label.toLowerCase()} and storing the original file.`],
      may: ['Read the inbox and the upload folder for this process.'],
      mustAskBefore: ['Deleting a source file.', 'Forwarding a document outside the organization.'],
      doneWhen: ['The file is stored and the first step can start.'],
    }
  }
  if (type === 'human') {
    return {
      owns: [`${person.role} at ${def.name}, including the call on ${def.outcome.charAt(0).toLowerCase()}${def.outcome.slice(1)}`],
      may: [`Ask a bot to draft, match, or summarize work for ${client}.`, 'Hold a step when the source is incomplete.'],
      mustAskBefore: ['Anything that pays, signs, files, or sends on behalf of the organization.', 'Changing a client or vendor record.'],
      doneWhen: [`A human can see who did the step, what changed, and what still needs approval.`],
    }
  }
  return {
    owns: [`${person.role} for ${def.name}. The usual case is ${client} and the two other active accounts.`],
    may: ['Read the source file, the prior record, and the seat card for this step.', 'Draft the next handoff for a human to approve.'],
    mustAskBefore: ['Sending a message outside the organization.', 'Moving money, changing terms, or closing the work.'],
    doneWhen: ['The step output is attached and a human can approve or send it back.'],
  }
}

function bioFor(def: CompanyDef, person: Person, type: SeatType): string {
  if (type === 'system') return `Handles inbound files for ${def.name} before a person or a bot touches them.`
  if (type === 'bot') return `${person.name} covers ${person.role.toLowerCase()} on the ${def.trigger.label.toLowerCase()} stream.`
  return `${person.name} is ${person.role.toLowerCase()} at ${def.name}, working with ${def.clients[0]}.`
}

/** Sample walkthrough only. Kept off the real project log. */
function ownerDemoActivity(orgId: string): DemoActivity {
  const events: LogEvent[] = []
  let n = 0
  function push(event: Omit<LogEvent, 'id' | 'orgId'>): void {
    n += 1
    events.push({ id: `${orgId}-demo-${n}`, orgId, ...event })
  }
  push({
    type: 'work',
    actorSeatId: 'seat-research-bot',
    actorType: 'bot',
    timestamp: '2026-09-18T15:10:00+00:00',
    summary: 'Sample: compared three agent protocols for the plan.',
    stepId: 'step-plan',
    workstreamId: 'ws-release',
    status: 'done',
  })
  push({
    type: 'hire',
    actorSeatId: 'seat-sam',
    actorType: 'human',
    timestamp: '2026-09-22T14:00:00+00:00',
    summary: 'Sample: hired a migration bot for the 2.0 upgrade guide.',
    subjectSeatId: 'demo-migration-bot',
    status: 'done',
  })
  push({
    type: 'exception',
    actorSeatId: 'seat-benchmark-bot',
    actorType: 'bot',
    timestamp: '2026-10-02T11:20:00+00:00',
    summary: 'Sample: a benchmark regressed; the pull request was sent back.',
    stepId: 'step-bench',
    workstreamId: 'ws-release',
    status: 'exception',
  })
  push({
    type: 'approval',
    actorSeatId: 'seat-sam',
    actorType: 'human',
    timestamp: '2026-10-06T16:05:00+00:00',
    summary: 'Sample: approved the streaming merge.',
    stepId: 'step-review',
    workstreamId: 'ws-release',
    status: 'approved',
    approverSeatId: 'seat-sam',
  })
  push({
    type: 'fire',
    actorSeatId: 'seat-sam',
    actorType: 'human',
    timestamp: '2026-10-08T17:40:00+00:00',
    summary: 'Sample: retired the migration bot after the guide shipped.',
    subjectSeatId: 'demo-migration-bot',
    status: 'done',
  })
  const work: { seat: string; count: number; line: string; stepId?: string }[] = [
    { seat: 'seat-issue-bot', count: 4, line: 'Sample: triaged an issue and drafted the reply.' },
    { seat: 'seat-community-bot', count: 3, line: 'Sample: drafted an answer with a docs link.' },
    { seat: 'seat-security-bot', count: 2, line: 'Sample: scanned a pull request for secrets.', stepId: 'step-review' },
    { seat: 'seat-release-bot', count: 1, line: 'Sample: updated the release checklist.', stepId: 'step-notes' },
    { seat: 'seat-roadmap-bot', count: 3, line: 'Sample: moved a milestone date in the plan.', stepId: 'step-plan' },
    { seat: 'seat-research-bot', count: 4, line: 'Sample: added a sourced note to the comparison table.', stepId: 'step-plan' },
    { seat: 'seat-docs-bot', count: 5, line: 'Sample: updated an example after a merge.', stepId: 'step-notes' },
    { seat: 'seat-review-bot', count: 6, line: 'Sample: drafted a first-pass review.', stepId: 'step-review' },
    { seat: 'seat-benchmark-bot', count: 5, line: 'Sample: ran the suite on a candidate build.', stepId: 'step-bench' },
    { seat: 'seat-books-bot', count: 2, line: 'Sample: summed the week\'s spend.' },
    { seat: 'seat-grok', count: 8, line: 'Sample: routed a release task.' },
  ]
  let cursor = Date.parse('2026-09-20T09:00:00+00:00')
  for (const item of work) {
    for (let index = 0; index < item.count; index += 1) {
      cursor += 10 * 3600 * 1000
      push({
        type: 'work',
        actorSeatId: item.seat,
        actorType: 'bot',
        timestamp: new Date(cursor).toISOString().replace('.000Z', '+00:00'),
        summary: `${item.line} Pass ${index + 1}.`,
        stepId: item.stepId,
        workstreamId: 'ws-release',
        status: 'done',
      })
    }
  }
  return { label: 'Demo activity (sample)', events }
}

function ownerCompany(): CompanySeed {
  const orgId = 'bot-company-x'
  const seats: Seat[] = SEEDED_SEATS.map((seat) => ({
    id: seat.id,
    orgId,
    name: seat.name,
    role: seat.role,
    type: seat.kind,
    reportsTo: seat.reportsTo ?? undefined,
    prompt: seat.kind === 'bot' ? `You are ${seat.name}. ${displayCardText(seat.card.owns) || seat.role}` : undefined,
    grokShareUrl: seat.kind === 'bot' ? null : undefined,
    curated: true,
    card: {
      owns: lines(seat.card.owns),
      may: lines(seat.card.may),
      mustAskBefore: lines(seat.card.mustAskBefore),
      doneWhen: lines(seat.card.doneWhen),
    },
    provenance: seat.kind === 'bot' ? { ...seat.card.provenance } : undefined,
    profile: {
      department: seat.role,
      location: 'Remote',
      email: '',
      phone: '',
      startedOn: '2026-09-15',
      bio: displayCardText(seat.card.owns) || `${seat.name}, ${seat.role}.`,
    },
    status: 'active' as const,
  }))
  const steps = [
    { id: 'step-plan', name: 'Write the release plan', exec: 'seat-roadmap-bot', level: 2 as const },
    { id: 'step-review', name: 'Review the pull requests', exec: 'seat-review-bot', level: 2 as const },
    { id: 'step-bench', name: 'Run the agent benchmarks', exec: 'seat-benchmark-bot', level: 2 as const },
    { id: 'step-notes', name: 'Draft the release notes', exec: 'seat-docs-bot', level: 2 as const },
  ]
  const stepForSeat: Record<string, string> = {
    'seat-roadmap-bot': 'step-plan',
    'seat-review-bot': 'step-review',
    'seat-benchmark-bot': 'step-bench',
    'seat-docs-bot': 'step-notes',
  }
  const log: LogEvent[] = []
  let logIndex = 0
  function pushLog(event: Omit<LogEvent, 'id' | 'orgId'>): void {
    logIndex += 1
    log.push({ id: `${orgId}-log-${logIndex}`, orgId, ...event })
  }
  for (const event of ACTIVITY) {
    pushLog({
      type: 'work',
      actorSeatId: event.seatId,
      actorType: 'bot',
      timestamp: event.at,
      summary: event.summary,
      stepId: stepForSeat[event.seatId],
      workstreamId: 'ws-release',
      status: 'done',
    })
    if (event.onMain) {
      pushLog({
        type: 'approval',
        actorSeatId: 'seat-sam',
        actorType: 'human',
        timestamp: event.at,
        summary: event.summary,
        stepId: 'step-review',
        workstreamId: 'ws-release',
        status: 'approved',
        approverSeatId: 'seat-sam',
      })
    }
  }
  pushLog({
    type: 'work',
    actorSeatId: QA_RUN.seatId,
    actorType: 'bot',
    timestamp: QA_RUN.at,
    summary: QA_RUN.summary,
    stepId: 'step-bench',
    workstreamId: 'ws-release',
    status: 'done',
  })
  for (const seat of seats) {
    if (seat.type !== 'bot') continue
    const mine = log.filter((event) => event.actorSeatId === seat.id)
    const latest = mine.map((event) => event.timestamp).sort().at(-1) ?? ''
    seat.stats = {
      usageCount30d: mine.length,
      tasksDone30d: mine.filter((event) => event.type === 'work').length,
      lastActiveAt: latest,
    }
  }
  return {
    org: {
      id: orgId,
      name: 'Bot Company X',
      description: 'A fictional open source project: one maintainer and a team of bots that keep a toolkit for bots and AI agents healthy. Every bot, issue, and number here is made up.',
      industry: 'Open source software',
      mock: false,
      ownerOrg: true,
      tagline: 'Open source tools for bots and AI agents.',
      address: 'Remote',
      headcount: '1 person, 11 bots',
      founded: 2024,
      mark: 'BX',
      markColor: '#0b1220',
      logExemption:
        'Hire and fire have not happened in this made-up fortnight, so the release log has no hire or fire events; they appear only in the demo activity. Work events come one per step, and an approval each time the maintainer signed off a step.',
      goals: {
        title: 'Version 2.0 release',
        dueOn: '2026-11-30',
        milestones: [
          'release plan approved',
          'open pull requests reviewed',
          'benchmarks green on the candidate',
          'release notes approved',
          'version 2.0 tagged',
        ].map((title) => ({ title, done: false })),
      },
      seatIds: seats.map((seat) => seat.id),
      workstreamIds: ['ws-release'],
    },
    seats,
    triggers: [{
      id: 'trigger-release',
      orgId,
      source: 'management',
      label: 'Version 2.0 release',
      example: 'The maintainer sets the version 2.0 release as the outcome for this stream.',
    }],
    workstreams: [{
      id: 'ws-release',
      orgId,
      triggerId: 'trigger-release',
      outcome: 'Version 2.0 release',
      ownerSeatId: 'seat-sam',
      kind: 'main',
      stepIds: steps.map((step) => step.id),
    }],
    steps: steps.map((step) => ({
      id: step.id,
      workstreamId: 'ws-release',
      name: step.name,
      level: step.level,
      executorSeatId: step.exec,
      inputs: ['The release plan and the open pull requests'],
      outputs: [step.name],
      checkpointId: step.id === 'step-review' ? 'cp-owner-merge' : undefined,
    })),
    handoffs: [
      { id: 'hand-plan-review', fromStepId: 'step-plan', toStepId: 'step-review' },
      { id: 'hand-review-bench', fromStepId: 'step-review', toStepId: 'step-bench' },
      { id: 'hand-bench-notes', fromStepId: 'step-bench', toStepId: 'step-notes' },
      { id: 'hand-bench-review', fromStepId: 'step-bench', toStepId: 'step-review', condition: 'regression: send back' },
    ],
    checkpoints: [{
      id: 'cp-owner-merge',
      stepId: 'step-review',
      rule: 'The maintainer approves every merge and every release.',
      approverSeatId: 'seat-sam',
      required: true,
    }],
    activity: log.map((event, index) => ({
      id: `${orgId}-act-${index + 1}`,
      at: event.timestamp,
      workstreamId: event.workstreamId || 'ws-release',
      stepId: event.stepId || 'step-plan',
      actorSeatId: event.actorSeatId,
      actorType: event.actorType,
      action: event.type === 'approval' ? 'approved' as const : 'completed' as const,
      status: event.type === 'approval' ? 'approved' as const : 'done' as const,
      inputRefs: [],
      outputRefs: [event.summary],
      approverSeatId: event.approverSeatId,
      note: event.summary,
    })),
    log,
    demoActivity: ownerDemoActivity(orgId),
  }
}

const companies: CompanyDef[] = [
  {
    id: 'meridian-ledger',
    name: 'Meridian Ledger Partners',
    industry: 'Finance',
    tagline: 'Independent finance advice for closely held organizations.',
    address: '233 S Wacker Drive, Suite 1840, Chicago, IL 60606',
    revenueBand: '$48 million',
    headcount: '86',
    founded: 2004,
    mark: 'ML',
    markColor: '#1e3a5f',
    city: 'Chicago',
    domain: 'meridianledger.com',
    phone: '(312) 555-0184',
    clients: ['Northshore Components', 'Field & Birch Manufacturing', 'Kestrel Foods'],
    owner: { key: 'helen', name: 'Helen Cho', role: 'Managing Partner', dept: 'Leadership', reports: 'top' },
    leads: [
      { key: 'marcus', name: 'Marcus Adeyemi', role: 'Chief Operating Officer', dept: 'Operations', reports: 'helen' },
      { key: 'priya', name: 'Priya Shah', role: 'Finance Lead', dept: 'Finance', reports: 'helen' },
      { key: 'owen', name: 'Owen Blake', role: 'Client Delivery Lead', dept: 'Client service', reports: 'helen' },
    ],
    humans: [
      { key: 'nora', name: 'Nora Pell', role: 'Controller', dept: 'Finance', reports: 'priya' },
      { key: 'jonah', name: 'Jonah Ellis', role: 'Accounts Payable Coordinator', dept: 'Finance', reports: 'priya' },
      { key: 'camille', name: 'Camille Ortiz', role: 'Vendor Relations Manager', dept: 'Operations', reports: 'marcus' },
    ],
    clerk: { key: 'drew', name: 'Drew Okonkwo', role: 'Billing Clerk', dept: 'Finance', reports: 'jonah' },
    system: { key: 'invoice-inbox', name: 'Invoice Inbox', role: 'Mail and upload intake', dept: 'Finance', reports: 'priya' },
    bots: [
      { key: 'invoice-bot', name: 'Invoice Bot', role: 'Invoice triage', dept: 'Finance', reports: 'priya', usage: 18, tasks: 6, last: '2026-10-13' },
      { key: 'purchase-order-bot', name: 'Purchase Order Bot', role: 'PO matching', dept: 'Finance', reports: 'priya', usage: 1, tasks: 1, last: '2026-09-18', least: true },
      { key: 'exception-bot', name: 'Exception Bot', role: 'Exception drafting', dept: 'Finance', reports: 'priya', usage: 9, tasks: 4, last: '2026-10-10' },
      { key: 'payment-bot', name: 'Payment Bot', role: 'Payment scheduling', dept: 'Finance', reports: 'priya', usage: 12, tasks: 5, last: '2026-10-12' },
      { key: 'collections-bot', name: 'Collections Bot', role: 'Collections drafting', dept: 'Finance', reports: 'priya', usage: 3, tasks: 1, last: '2026-09-15', retired: true },
    ],
    trigger: { source: 'email', label: 'Invoice arrives', example: 'A vendor emails a PDF invoice, or accounts payable drops the file in the intake folder.' },
    outcome: 'The invoice is paid correctly or rejected with a reason.',
    approver: 'priya',
    steps: [
      { key: 'extract', name: 'Extract invoice fields', exec: 'invoice-inbox', level: 4 },
      { key: 'match', name: 'Match to PO and vendor', exec: 'purchase-order-bot', level: 4 },
      { key: 'packet', name: 'Prepare the pay packet', exec: 'invoice-bot', level: 2 },
      { key: 'approve', name: 'Approve payment', exec: 'priya', level: 3, checkpoint: 'Amount over $5,000, a new vendor, or any mismatch.' },
      { key: 'schedule', name: 'Schedule payment', exec: 'payment-bot', level: 4 },
    ],
    contingencyName: 'Resolve exception',
    contingencyOutcome: 'The mismatch is corrected, or the invoice is rejected.',
    contingency: [
      { key: 'query', name: 'Draft the vendor query', exec: 'exception-bot', level: 4 },
      { key: 'msg', name: 'Approve the vendor message', exec: 'priya', level: 3, checkpoint: 'Any message that leaves the firm, or a decision to reject the invoice.' },
    ],
  },
  firm({
    id: 'lark-field',
    name: 'Lark & Field',
    industry: 'Marketing agency',
    tagline: 'Brand and campaign work for regional consumer organizations.',
    address: '418 Broadway, Floor 6, New York, NY 10013',
    revenueBand: '$22 million',
    headcount: '64',
    founded: 2011,
    mark: 'LF',
    markColor: '#7c3aed',
    city: 'New York',
    domain: 'larkandfield.com',
    phone: '(212) 555-0146',
    clients: ['Hale Grocery', 'Port & Pine Home', 'Sunday Roast Coffee'],
    ownerName: 'Claire Fenwick',
    ownerRole: 'Managing Director',
    leadA: ['nina', 'Nina Berg', 'Head of Client Services'],
    leadB: ['samir', 'Samir Qureshi', 'Creative Director'],
    leadC: ['ruth', 'Ruth Adler', 'Head of Production'],
    approverKey: 'ruth',
    approverName: 'Ruth Adler',
    humans: [
      ['leah', 'Leah Ortiz', 'Account Director', 'nina'],
      ['chris', 'Chris Daley', 'Media Planner', 'nina'],
      ['paulo', 'Paulo Mendes', 'Studio Manager', 'samir'],
    ],
    clerk: ['ivy', 'Ivy Tran', 'Traffic Coordinator', 'paulo'],
    system: ['brief-inbox', 'Brief Inbox', 'Inbound brief intake'],
    bots: [
      ['brief-bot', 'Brief Bot', 'Brief intake', 14, 5, '2026-10-12'],
      ['asset-bot', 'Asset Bot', 'Asset matching', 1, 1, '2026-09-17', 'least'],
      ['copy-bot', 'Copy Bot', 'First-draft copy', 11, 4, '2026-10-11'],
      ['schedule-bot', 'Schedule Bot', 'Schedule and handoff', 8, 4, '2026-10-09'],
      ['old-post-bot', 'Old Post Bot', 'Old social drafts', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'customer', label: 'Campaign brief arrives', example: 'Hale Grocery sends a brief for the spring circular and the assets they already have.' },
    outcome: 'The campaign is approved, scheduled, and ready for the client to publish.',
    steps: [
      ['intake', 'File the brief and assets', 'brief-inbox', 4],
      ['match', 'Match assets to the brief', 'asset-bot', 4],
      ['draft', 'Draft the first version', 'copy-bot', 2],
      ['approve', 'Approve the client version', 'ruth', 3, 'Anything a client will see, or a spend change over $2,500.'],
      ['schedule', 'Schedule production', 'schedule-bot', 4],
    ],
    contingencyName: 'Resolve a brand exception',
    contingencyOutcome: 'The off-brand item is rewritten or pulled.',
    contingency: [
      ['query', 'Draft the revision note', 'copy-bot', 4],
      ['msg', 'Approve the note to the client', 'ruth', 3, 'Any note that leaves the agency.'],
    ],
  }),
]

function firm(input: {
  id: string
  name: string
  industry: string
  tagline: string
  address: string
  revenueBand: string
  headcount: string
  founded: number
  mark: string
  markColor: string
  city: string
  domain: string
  phone: string
  clients: [string, string, string]
  ownerName: string
  ownerRole: string
  leadA: [string, string, string]
  leadB: [string, string, string]
  leadC: [string, string, string]
  approverKey: string
  approverName: string
  humans: [string, string, string, string][]
  clerk: [string, string, string, string]
  system: [string, string, string]
  bots: [string, string, string, number, number, string, ('least' | 'retired')?][]
  trigger: CompanyDef['trigger']
  outcome: string
  steps: [string, string, string, 2 | 3 | 4, string?][]
  contingencyName: string
  contingencyOutcome: string
  contingency: [string, string, string, 2 | 3 | 4, string?][]
}): CompanyDef {
  const ownerKey = 'owner'
  return {
    id: input.id,
    name: input.name,
    industry: input.industry,
    tagline: input.tagline,
    address: input.address,
    revenueBand: input.revenueBand,
    headcount: input.headcount,
    founded: input.founded,
    mark: input.mark,
    markColor: input.markColor,
    city: input.city,
    domain: input.domain,
    phone: input.phone,
    clients: input.clients,
    owner: { key: ownerKey, name: input.ownerName, role: input.ownerRole, dept: 'Leadership', reports: 'top' },
    leads: [input.leadA, input.leadB, input.leadC].map(([key, name, role]) => ({
      key, name, role, dept: role, reports: ownerKey,
    })),
    humans: input.humans.map(([key, name, role, reports]) => ({ key, name, role, dept: role, reports })),
    clerk: { key: input.clerk[0], name: input.clerk[1], role: input.clerk[2], dept: input.clerk[2], reports: input.clerk[3] },
    system: { key: input.system[0], name: input.system[1], role: input.system[2], dept: 'Operations', reports: input.approverKey },
    bots: input.bots.map(([key, name, role, usage, tasks, last, flag]) => ({
      key,
      name,
      role,
      dept: role,
      reports: input.approverKey,
      usage,
      tasks,
      last,
      least: flag === 'least',
      retired: flag === 'retired',
    })),
    trigger: input.trigger,
    outcome: input.outcome,
    approver: input.approverKey,
    steps: input.steps.map(([key, name, exec, level, checkpoint]) => ({ key, name, exec, level, checkpoint })),
    contingencyName: input.contingencyName,
    contingencyOutcome: input.contingencyOutcome,
    contingency: input.contingency.map(([key, name, exec, level, checkpoint]) => ({ key, name, exec, level, checkpoint })),
  }
}

const rest: CompanyDef[] = [
  firm({
    id: 'vesper-signal',
    name: 'Vesper Signal',
    industry: 'Data analytics',
    tagline: 'Decision support for operators who still want a person on the hook.',
    address: '901 N 34th Street, Suite 300, Seattle, WA 98103',
    revenueBand: '$31 million',
    headcount: '72',
    founded: 2016,
    mark: 'VS',
    markColor: '#0f766e',
    city: 'Seattle',
    domain: 'vespersignal.com',
    phone: '(206) 555-0172',
    clients: ['Cedar Route Transit', 'Marrow Health Plan', 'Island Cold Storage'],
    ownerName: 'Elena Voss',
    ownerRole: 'Chief Executive',
    leadA: ['theo', 'Theo Lang', 'Head of Delivery'],
    leadB: ['amira', 'Amira Hassan', 'Head of Data'],
    leadC: ['joel', 'Joel Prieto', 'Engagement Lead'],
    approverKey: 'joel',
    approverName: 'Joel Prieto',
    humans: [
      ['sara', 'Sara Nguyen', 'Analytics Manager', 'amira'],
      ['ben', 'Ben Adler', 'Data Engineer', 'amira'],
      ['kate', 'Kate Morrow', 'Client Partner', 'theo'],
    ],
    clerk: ['luis', 'Luis Ortega', 'Reporting Associate', 'sara'],
    system: ['data-pull', 'Data Pull', 'Scheduled source extract'],
    bots: [
      ['question-bot', 'Question Bot', 'Question intake', 16, 6, '2026-10-13'],
      ['metric-bot', 'Metric Bot', 'Metric check', 1, 1, '2026-09-18', 'least'],
      ['insight-bot', 'Insight Bot', 'Insight draft', 10, 4, '2026-10-11'],
      ['send-bot', 'Send Prep Bot', 'Pack and send prep', 7, 3, '2026-10-08'],
      ['old-dashboard-bot', 'Old Dashboard Bot', 'Legacy dashboard notes', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'customer', label: 'A client asks for a read', example: 'Cedar Route Transit asks why on-time performance dropped last Tuesday.' },
    outcome: 'The client receives a sourced answer a person has approved.',
    steps: [
      ['extract', 'Pull the source extract', 'data-pull', 4],
      ['match', 'Check the metric against the definition', 'metric-bot', 4],
      ['draft', 'Draft the insight memo', 'insight-bot', 2],
      ['approve', 'Approve the client answer', 'joel', 3, 'Any number that leaves the firm, or a claim about a person.'],
      ['schedule', 'Send the approved memo', 'send-bot', 4],
    ],
    contingencyName: 'Resolve a data exception',
    contingencyOutcome: 'The broken definition is corrected or the answer is held.',
    contingency: [
      ['query', 'Draft the definition question', 'insight-bot', 4],
      ['msg', 'Approve the question to the client', 'joel', 3, 'Any question that leaves the firm.'],
    ],
  }),
  firm({
    id: 'corbett-construction',
    name: 'Corbett Construction Group',
    industry: 'Construction',
    tagline: 'Commercial builds for owners who want one accountable superintendent.',
    address: '1400 16th Street, Suite 200, Denver, CO 80202',
    revenueBand: '$210 million',
    headcount: '340',
    founded: 1987,
    mark: 'CC',
    markColor: '#9a3412',
    city: 'Denver',
    domain: 'corbettconstruction.com',
    phone: '(303) 555-0194',
    clients: ['Front Range Schools', 'Platte Medical Pavilion', 'Union Yard Apartments'],
    ownerName: 'Patrick Corbett',
    ownerRole: 'President',
    leadA: ['dana', 'Dana Ruiz', 'Vice President of Operations'],
    leadB: ['mike', 'Mike Ellison', 'Chief Estimator'],
    leadC: ['helen', 'Helen Park', 'Project Executive'],
    approverKey: 'helen',
    approverName: 'Helen Park',
    humans: [
      ['andy', 'Andy Brooks', 'Superintendent', 'helen'],
      ['rosa', 'Rosa Nguyen', 'Project Engineer', 'helen'],
      ['tom', 'Tom Gallagher', 'Safety Manager', 'dana'],
    ],
    clerk: ['kim', 'Kim Alvarez', 'Document Control Clerk', 'rosa'],
    system: ['email-inbox', 'Project Email Inbox', 'Project email intake'],
    bots: [
      ['request-bot', 'Request Bot', 'RFI intake', 15, 5, '2026-10-12'],
      ['spec-bot', 'Spec Bot', 'Spec matching', 1, 1, '2026-09-18', 'least'],
      ['reply-bot', 'Reply Bot', 'Response draft', 9, 4, '2026-10-10'],
      ['send-bot', 'Send Bot', 'Distribution', 8, 3, '2026-10-09'],
      ['old-draft-bot', 'Old Draft Bot', 'Old submittal drafts', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'email', label: 'An RFI arrives', example: 'The mechanical subcontractor asks which roof drain detail applies at grid C.' },
    outcome: 'The RFI is answered against the spec, or sent back with a named owner.',
    steps: [
      ['extract', 'Log the RFI', 'email-inbox', 4],
      ['match', 'Match it to the spec section', 'spec-bot', 4],
      ['draft', 'Draft the response', 'reply-bot', 2],
      ['approve', 'Approve the answer', 'helen', 3, 'Any answer that changes cost, schedule, or a life-safety detail.'],
      ['schedule', 'Issue the answer', 'send-bot', 4],
    ],
    contingencyName: 'Resolve a spec conflict',
    contingencyOutcome: 'The conflict is clarified with the architect or the RFI is rejected.',
    contingency: [
      ['query', 'Draft the question to the architect', 'reply-bot', 4],
      ['msg', 'Approve the outbound question', 'helen', 3, 'Any message to the architect or owner.'],
    ],
  }),
  firm({
    id: 'rowan-accountants',
    name: 'Rowan & Co.',
    industry: 'Accounting',
    tagline: 'Audit and advisory for owner-managed organizations.',
    address: '200 S Tryon Street, Suite 1100, Charlotte, NC 28202',
    revenueBand: '$27 million',
    headcount: '95',
    founded: 1998,
    mark: 'RC',
    markColor: '#1d4ed8',
    city: 'Charlotte',
    domain: 'rowanandco.com',
    phone: '(704) 555-0160',
    clients: ['Piedmont Mills', 'Aster Clinics', 'Lowland Logistics'],
    ownerName: 'Margaret Rowan',
    ownerRole: 'Managing Partner',
    leadA: ['david', 'David Chen', 'Assurance Partner'],
    leadB: ['anita', 'Anita Desai', 'Tax Partner'],
    leadC: ['paul', 'Paul Weber', 'Advisory Director'],
    approverKey: 'david',
    approverName: 'David Chen',
    humans: [
      ['nina', 'Nina Cole', 'Audit Manager', 'david'],
      ['omar', 'Omar Farah', 'Senior Accountant', 'david'],
      ['liz', 'Liz Potter', 'Tax Manager', 'anita'],
    ],
    clerk: ['evan', 'Evan Brooks', 'Workpaper Associate', 'omar'],
    system: ['client-inbox', 'Client File Inbox', 'Client upload intake'],
    bots: [
      ['client-file-bot', 'Client File Bot', 'PBC intake', 13, 5, '2026-10-13'],
      ['tie-out-bot', 'Tie-out Bot', 'Tie-out check', 1, 1, '2026-09-19', 'least'],
      ['exception-bot', 'Exception Bot', 'Exception memo', 10, 4, '2026-10-11'],
      ['close-bot', 'Close Bot', 'Close checklist', 6, 4, '2026-10-08'],
      ['old-notes-bot', 'Old Notes Bot', 'Old sampling notes', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'schedule', label: 'Month-end binder arrives', example: 'Piedmont Mills uploads the October binder the morning after close.' },
    outcome: 'The binder is tied out, exceptions are listed, and a partner signs the review.',
    steps: [
      ['extract', 'Index the binder', 'client-inbox', 4],
      ['match', 'Tie out the lead sheet', 'tie-out-bot', 4],
      ['draft', 'Draft the exception memo', 'exception-bot', 2],
      ['approve', 'Partner review', 'david', 3, 'Any adjustment, or a disclosure the client will file.'],
      ['schedule', 'Issue the review notes', 'close-bot', 4],
      ['file', 'File the signed review', 'nina', 4],
    ],
    contingencyName: 'Resolve a tie-out exception',
    contingencyOutcome: 'The difference is explained or booked.',
    contingency: [
      ['query', 'Draft the question to the controller', 'exception-bot', 4],
      ['msg', 'Approve the question', 'david', 3, 'Any question that leaves the firm.'],
    ],
  }),
  firm({
    id: 'harborlight-clinic',
    name: 'Harborlight Clinic',
    industry: 'Medical clinic',
    tagline: 'Primary care for the harbor neighborhoods.',
    address: '880 Harbor Avenue, Portland, ME 04101',
    revenueBand: '$18 million',
    headcount: '54',
    founded: 2001,
    mark: 'HC',
    markColor: '#0e7490',
    city: 'Portland',
    domain: 'harborlightclinic.com',
    phone: '(207) 555-0133',
    clients: ['Maine Coast Referrals', 'Bay School District', 'Casco Employer Health'],
    ownerName: 'Dr. Anne Lind',
    ownerRole: 'Medical Director',
    leadA: ['joan', 'Joan Keller', 'Practice Manager'],
    leadB: ['robert', 'Robert Hale', 'Nursing Lead'],
    leadC: ['sofia', 'Sofia Marin', 'Referral Coordinator Lead'],
    approverKey: 'sofia',
    approverName: 'Sofia Marin',
    humans: [
      ['amy', 'Amy Cho', 'Front Desk Supervisor', 'joan'],
      ['pete', 'Pete Nowak', 'Nurse', 'robert'],
      ['lina', 'Lina Abbas', 'Billing Supervisor', 'joan'],
    ],
    clerk: ['ned', 'Ned Brooks', 'Referral Clerk', 'sofia'],
    system: ['referral-inbox', 'Referral Inbox', 'Fax and portal intake'],
    bots: [
      ['referral-bot', 'Referral Bot', 'Referral intake', 17, 6, '2026-10-13'],
      ['record-bot', 'Record Bot', 'Matches patient records', 1, 1, '2026-09-18', 'least'],
      ['schedule-bot', 'Schedule Bot', 'Schedule draft', 9, 4, '2026-10-10'],
      ['message-bot', 'Message Bot', 'Patient message draft', 8, 3, '2026-10-09'],
      ['old-reminder-bot', 'Old Reminder Bot', 'Old reminder drafts', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'email', label: 'A referral arrives', example: 'Maine Coast Referrals faxes a cardiology follow-up for a current patient.' },
    outcome: 'The patient has a confirmed visit, or the referral is declined with a reason.',
    steps: [
      ['extract', 'Read the referral', 'referral-inbox', 4],
      ['match', 'Match the patient record', 'record-bot', 4],
      ['draft', 'Draft the visit hold', 'schedule-bot', 2],
      ['approve', 'Confirm the booking', 'sofia', 3, 'Any message to a patient, or a decline.'],
      ['schedule', 'Send the confirmation', 'message-bot', 4],
    ],
    contingencyName: 'Resolve a record mismatch',
    contingencyOutcome: 'The right chart is found, or the referral is returned.',
    contingency: [
      ['query', 'Draft the clarification', 'schedule-bot', 4],
      ['msg', 'Approve the clarification', 'sofia', 3, 'Any message that includes clinical detail.'],
    ],
  }),
  firm({
    id: 'halvorsen-ruiz',
    name: 'Halvorsen & Ruiz LLP',
    industry: 'Law firm',
    tagline: 'Counsel for growing organizations on contracts, disputes, and employment.',
    address: '555 California Street, Suite 3200, San Francisco, CA 94104',
    revenueBand: '$41 million',
    headcount: '78',
    founded: 1994,
    mark: 'HR',
    markColor: '#312e81',
    city: 'San Francisco',
    domain: 'halvorsenruiz.com',
    phone: '(415) 555-0199',
    clients: ['Sutter & Co. Retail', 'Bayline Transit', 'Kindred Foods'],
    ownerName: 'Ingrid Halvorsen',
    ownerRole: 'Managing Partner',
    leadA: ['rafael', 'Rafael Ruiz', 'Disputes Partner'],
    leadB: ['maya', 'Maya Stein', 'Corporate Partner'],
    leadC: ['ellen', 'Ellen Cho', 'Employment Partner'],
    approverKey: 'maya',
    approverName: 'Maya Stein',
    humans: [
      ['jon', 'Jon Adler', 'Senior Associate', 'maya'],
      ['priya', 'Priya Nair', 'Associate', 'rafael'],
      ['greg', 'Greg Holt', 'Conflicts Manager', 'ellen'],
    ],
    clerk: ['ann', 'Ann Duffy', 'Matter Clerk', 'jon'],
    system: ['conflict-check', 'Conflict Check', 'New-matter intake screen'],
    bots: [
      ['intake-bot', 'Intake Bot', 'Matter intake', 12, 5, '2026-10-12'],
      ['clause-bot', 'Clause Bot', 'Clause matching', 1, 1, '2026-09-18', 'least'],
      ['letter-bot', 'Letter Bot', 'Engagement draft', 11, 4, '2026-10-11'],
      ['closing-bot', 'Closing Bot', 'Closing checklist', 7, 3, '2026-10-08'],
      ['old-letter-bot', 'Old Letter Bot', 'Old form letters', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'email', label: 'A new matter arrives', example: 'Sutter & Co. asks the firm to review a supplier agreement before Friday.' },
    outcome: 'The matter is opened and the engagement letter is signed, or the work is declined.',
    steps: [
      ['extract', 'Screen conflicts', 'conflict-check', 4],
      ['match', 'Match clauses to the playbook', 'clause-bot', 4],
      ['draft', 'Draft the engagement letter', 'letter-bot', 2],
      ['approve', 'Partner approves the letter', 'maya', 3, 'Opening a matter, sending a letter, or declining a client.'],
      ['schedule', 'Send the letter for signature', 'closing-bot', 4],
    ],
    contingencyName: 'Resolve a conflicts hit',
    contingencyOutcome: 'The hit is cleared or the matter is declined.',
    contingency: [
      ['query', 'Draft the conflicts question', 'letter-bot', 4],
      ['msg', 'Approve the question', 'maya', 3, 'Any note that names another client.'],
    ],
  }),
  firm({
    id: 'sable-goods',
    name: 'Sable Goods',
    industry: 'E-commerce',
    tagline: 'Home goods, sold direct, with a small team on returns.',
    address: '1200 NW Everett Street, Portland, OR 97209',
    revenueBand: '$36 million',
    headcount: '48',
    founded: 2018,
    mark: 'SG',
    markColor: '#92400e',
    city: 'Portland',
    domain: 'sablegoods.com',
    phone: '(503) 555-0118',
    clients: ['Repeat buyers', 'West Elm trade desk', 'Regional gift shops'],
    ownerName: 'Hannah Sable',
    ownerRole: 'Founder',
    leadA: ['chris', 'Chris Dalton', 'Head of Operations'],
    leadB: ['mei', 'Mei Laurent', 'Head of Merchandising'],
    leadC: ['oscar', 'Oscar Bennett', 'Care Lead'],
    approverKey: 'oscar',
    approverName: 'Oscar Bennett',
    humans: [
      ['jade', 'Jade Murphy', 'Warehouse Lead', 'chris'],
      ['ali', 'Ali Rahman', 'Care Specialist', 'oscar'],
      ['brooke', 'Brooke Ellis', 'Buyer', 'mei'],
    ],
    clerk: ['tim', 'Tim Vogel', 'Returns Clerk', 'ali'],
    system: ['order-inbox', 'Order Inbox', 'Return request intake'],
    bots: [
      ['return-bot', 'Return Bot', 'Return intake', 19, 6, '2026-10-13'],
      ['order-bot', 'Order Bot', 'Order matching', 1, 1, '2026-09-17', 'least'],
      ['reply-bot', 'Reply Bot', 'Reply draft', 10, 4, '2026-10-11'],
      ['refund-bot', 'Refund Bot', 'Refund scheduling', 8, 3, '2026-10-09'],
      ['old-coupon-bot', 'Old Coupon Bot', 'Old coupon drafts', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'customer', label: 'A return request arrives', example: 'A buyer asks to return a cracked lamp and includes the order number.' },
    outcome: 'The buyer gets a refund or a replacement, or a clear refusal.',
    steps: [
      ['extract', 'Read the request', 'order-inbox', 4],
      ['match', 'Match the order and the item', 'order-bot', 4],
      ['draft', 'Draft the reply', 'reply-bot', 2],
      ['approve', 'Approve the refund or replacement', 'oscar', 3, 'Any refund over $150, or a refusal.'],
      ['schedule', 'Schedule the refund', 'refund-bot', 4],
    ],
    contingencyName: 'Resolve a missing order',
    contingencyOutcome: 'The order is found, or the buyer is asked for the missing detail.',
    contingency: [
      ['query', 'Draft the question to the buyer', 'reply-bot', 4],
      ['msg', 'Approve the question', 'oscar', 3, 'Any message that offers money or refuses the return.'],
    ],
  }),
  firm({
    id: 'redline-freight',
    name: 'Redline Freight',
    industry: 'Logistics',
    tagline: 'Regional freight for shippers who call when a load goes quiet.',
    address: '4100 Commerce Parkway, Columbus, OH 43228',
    revenueBand: '$92 million',
    headcount: '210',
    founded: 2007,
    mark: 'RF',
    markColor: '#b91c1c',
    city: 'Columbus',
    domain: 'redlinefreight.com',
    phone: '(614) 555-0177',
    clients: ['Oakline Grocery', 'Midstate Auto Parts', 'Glasshouse Packaging'],
    ownerName: 'Donna Keane',
    ownerRole: 'President',
    leadA: ['marcus', 'Marcus Bell', 'Vice President of Operations'],
    leadB: ['cindy', 'Cindy Zhao', 'Customer Care Director'],
    leadC: ['alan', 'Alan Brooks', 'Dispatch Manager'],
    approverKey: 'cindy',
    approverName: 'Cindy Zhao',
    humans: [
      ['joe', 'Joe Harlan', 'Senior Dispatcher', 'alan'],
      ['rina', 'Rina Shah', 'Care Supervisor', 'cindy'],
      ['erik', 'Erik Moss', 'Claims Analyst', 'marcus'],
    ],
    clerk: ['beth', 'Beth Cooper', 'Trace Clerk', 'rina'],
    system: ['load-monitor', 'Load Monitor', 'Tracking exception feed'],
    bots: [
      ['exception-bot', 'Exception Bot', 'Exception intake', 14, 5, '2026-10-12'],
      ['load-bot', 'Load Bot', 'Load matching', 1, 1, '2026-09-18', 'least'],
      ['update-bot', 'Customer Update Bot', 'Customer update draft', 9, 4, '2026-10-10'],
      ['recovery-bot', 'Recovery Bot', 'Recovery schedule', 7, 3, '2026-10-08'],
      ['old-claim-bot', 'Old Claim Bot', 'Old claim letters', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'alert', label: 'A load goes quiet', example: 'The monitor flags a Glasshouse Packaging load with no ping for two hours.' },
    outcome: 'The customer has a true status, and the load is moving or formally delayed.',
    steps: [
      ['extract', 'Read the exception', 'load-monitor', 4],
      ['match', 'Match the load and the last ping', 'load-bot', 4],
      ['draft', 'Draft the customer update', 'update-bot', 2],
      ['approve', 'Approve the customer update', 'cindy', 3, 'Any delay over four hours, or a claim.'],
      ['schedule', 'Send the update and reset the watch', 'recovery-bot', 4],
    ],
    contingencyName: 'Resolve a missed appointment',
    contingencyOutcome: 'The receiver is rebooked, or the customer accepts the delay.',
    contingency: [
      ['query', 'Draft the rebooking note', 'update-bot', 4],
      ['msg', 'Approve the note', 'cindy', 3, 'Any message that changes an appointment or offers a credit.'],
    ],
  }),
  firm({
    id: 'kindling-labs',
    name: 'Kindling Labs',
    industry: 'Software',
    tagline: 'Workflow software for field service organizations.',
    address: '77 Summer Street, Floor 4, Boston, MA 02110',
    revenueBand: '$14 million',
    headcount: '39',
    founded: 2020,
    mark: 'KL',
    markColor: '#0369a1',
    city: 'Boston',
    domain: 'kindlinglabs.com',
    phone: '(617) 555-0104',
    clients: ['Northwind Field Service', 'Harbor HVAC', 'Civic Lighting Co.'],
    ownerName: 'Jordan Hale',
    ownerRole: 'Chief Executive',
    leadA: ['priya', 'Priya Raman', 'Head of Product'],
    leadB: ['chris', 'Chris Ellison', 'Engineering Manager'],
    leadC: ['nora', 'Nora Feldman', 'Support Lead'],
    approverKey: 'priya',
    approverName: 'Priya Raman',
    humans: [
      ['sam', 'Sam Ortega', 'Product Manager', 'priya'],
      ['leah', 'Leah Brooks', 'Senior Engineer', 'chris'],
      ['owen', 'Owen Cho', 'Support Specialist', 'nora'],
    ],
    clerk: ['mia', 'Mia Grant', 'QA Analyst', 'leah'],
    system: ['error-inbox', 'Error Inbox', 'Production error intake'],
    bots: [
      ['ticket-bot', 'Ticket Bot', 'Ticket intake', 15, 5, '2026-10-13'],
      ['repro-bot', 'Repro Bot', 'Reproduction notes', 1, 1, '2026-09-18', 'least'],
      ['patch-bot', 'Patch Bot', 'Patch summary', 11, 4, '2026-10-11'],
      ['release-bot', 'Release Bot', 'Release checklist', 6, 3, '2026-10-07'],
      ['old-status-bot', 'Old Status Bot', 'Old status drafts', 2, 1, '2026-09-15', 'retired'],
    ],
    trigger: { source: 'alert', label: 'A customer bug is filed', example: 'Northwind Field Service reports that completed jobs are not syncing after 6 p.m.' },
    outcome: 'A fix is ready for release, or the bug is returned with a reason.',
    steps: [
      ['extract', 'Capture the report', 'error-inbox', 4],
      ['match', 'Write the reproduction note', 'repro-bot', 4],
      ['draft', 'Summarize the patch', 'patch-bot', 2],
      ['approve', 'Approve the release', 'priya', 3, 'Any production release, or a customer-facing status.'],
      ['schedule', 'Queue the release', 'release-bot', 4],
    ],
    contingencyName: 'Resolve a failed reproduction',
    contingencyOutcome: 'The missing detail is requested, or the ticket is closed as not reproduced.',
    contingency: [
      ['query', 'Draft the question to support', 'patch-bot', 4],
      ['msg', 'Approve the customer question', 'priya', 3, 'Any question that goes to the customer.'],
    ],
  }),
]

const seed: MockSeed = {
  asOf: AS_OF,
  companies: [ownerCompany(), build(companies[0]), build(companies[1]), ...rest.map(build)],
}

writeFileSync(new URL('../src/data/mock-companies.json', import.meta.url), `${JSON.stringify(seed, null, 2)}\n`)
console.log(`Wrote ${seed.companies.length} organizations`)
