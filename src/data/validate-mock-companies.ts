import type { CompanySeed, LogEvent, MockSeed, Seat } from './mock-companies.ts'
import { displayCardText } from '../preview/card-text.ts'

const WINDOW_START = Date.parse('2026-09-14T00:00:00-05:00')
const WINDOW_END = Date.parse('2026-10-14T23:59:59-05:00')
const AS_OF = Date.parse('2026-10-14T18:00:00-05:00')
const ACTIONS = new Set(['started', 'completed', 'handed_off', 'flagged', 'approved', 'rejected', 'spawned_contingency'])
const STATUSES = new Set(['pending', 'in_progress', 'awaiting_approval', 'approved', 'rejected', 'done', 'exception'])
const LOG_TYPES = ['work', 'approval', 'exception', 'hire', 'fire'] as const

/** Structural checks, plus the demo-scope section 5 contract for the 10 sample companies. */
export function validateMockCompanies(seed: MockSeed): string[] {
  const errors: string[] = []
  if (!seed || !Array.isArray(seed.companies)) {
    return ['Seed is missing companies.']
  }
  const mocks = seed.companies.filter((company) => !company.org.ownerOrg)
  const owners = seed.companies.filter((company) => company.org.ownerOrg)
  if (mocks.length !== 10) errors.push(`Expected exactly 10 sample organizations, found ${mocks.length}.`)
  if (owners.length !== 1) errors.push(`Expected exactly 1 owner org, found ${owners.length}.`)
  const ids = new Set<string>()
  for (const company of seed.companies) {
    if (ids.has(company.org.id)) errors.push(`Duplicate org ${company.org.id}`)
    ids.add(company.org.id)
    errors.push(...validateCompany(company))
  }
  return errors
}

function validateCompany(company: CompanySeed): string[] {
  const errors: string[] = []
  const { org } = company
  const where = org.id
  const seats = new Map(company.seats.map((seat) => [seat.id, seat]))
  if (seats.size !== company.seats.length) errors.push(`${where}: duplicate seat ids`)
  if (org.seatIds.length !== seats.size) errors.push(`${where}: org.seatIds does not match seats`)
  for (const id of org.seatIds) {
    if (!seats.has(id)) errors.push(`${where}: org.seatIds has unknown seat ${id}`)
  }
  for (const seat of company.seats) {
    if (seat.orgId !== org.id) errors.push(`${where}: seat ${seat.id} has the wrong org`)
    if (seat.reportsTo && !seats.has(seat.reportsTo)) errors.push(`${where}: ${seat.id} reportsTo unknown seat`)
    if (seat.type === 'bot' && seat.grokShareUrl) errors.push(`${where}: ${seat.id} grokShareUrl must stay empty`)
  }
  if (cycle(company.seats)) errors.push(`${where}: reportsTo has a cycle`)

  const triggers = new Set(company.triggers.map((trigger) => trigger.id))
  const workstreams = new Map(company.workstreams.map((stream) => [stream.id, stream]))
  const steps = new Map(company.steps.map((step) => [step.id, step]))
  const checkpoints = new Map(company.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]))

  for (const stream of company.workstreams) {
    if (!triggers.has(stream.triggerId)) errors.push(`${where}: ${stream.id} trigger is missing`)
    const owner = seats.get(stream.ownerSeatId)
    if (!owner || owner.type !== 'human') errors.push(`${where}: ${stream.id} owner must be a human seat`)
    if (stream.stepIds.length === 0) errors.push(`${where}: ${stream.id} has no steps`)
  }
  for (const step of company.steps) {
    if (!workstreams.has(step.workstreamId)) errors.push(`${where}: step ${step.id} workstream is missing`)
    if (!seats.has(step.executorSeatId) && step.staffing !== 'unstaffed') {
      errors.push(`${where}: step ${step.id} has no executor`)
    }
    if (step.checkpointId && checkpoints.get(step.checkpointId)?.stepId !== step.id) {
      errors.push(`${where}: step ${step.id} checkpoint is missing`)
    }
  }
  for (const handoff of company.handoffs) {
    if (!steps.has(handoff.fromStepId) || !steps.has(handoff.toStepId)) {
      errors.push(`${where}: handoff ${handoff.id} does not connect real steps`)
    }
  }
  for (const checkpoint of company.checkpoints) {
    const approver = seats.get(checkpoint.approverSeatId)
    if (!approver || approver.type !== 'human') errors.push(`${where}: checkpoint ${checkpoint.id} approver must be human`)
  }
  if (!company.workstreams.some((stream) => stream.stepIds.length >= 4)) {
    errors.push(`${where}: needs a workstream with at least 4 steps`)
  }
  if (company.checkpoints.length < 1) errors.push(`${where}: needs a human checkpoint`)

  if (org.ownerOrg) {
    if (org.mock) errors.push(`${where}: owner org is not a sample`)
    if (!company.seats.some((seat) => seat.name === 'Miguel Rovira' && seat.type === 'human')) {
      errors.push(`${where}: owner seat Miguel Rovira is missing`)
    }
    const bots = company.seats.filter((seat) => seat.type === 'bot')
    for (const bot of bots) {
      const fields = ['owns', 'may', 'mustAskBefore', 'doneWhen'] as const
      for (const field of fields) {
        if (!filled(bot.card?.[field])) errors.push(`${where}: ${bot.name} is missing ${field}`)
        const shown = (bot.card?.[field] ?? []).map((line) => displayCardText(line)).join(' ')
        if (!shown.trim()) errors.push(`${where}: ${bot.name} ${field} is empty on screen`)
        if (/from handbook v1/i.test(shown)) errors.push(`${where}: ${bot.name} ${field} still shows the handbook tag`)
      }
      const source = bot.provenance
      if (!source?.owns || !source.may || !source.mustAskBefore || !source.doneWhen) {
        errors.push(`${where}: ${bot.name} is missing card provenance`)
      }
    }
    const log = company.log ?? []
    const types = new Set(log.map((event) => event.type))
    if (!types.has('work')) errors.push(`${where}: log is missing a work event`)
    if (!types.has('approval')) errors.push(`${where}: log is missing an approval event`)
    const exemption = org.logExemption ?? ''
    if (!exemption.includes('Hire and fire have not happened')) {
      for (const type of ['exception', 'hire', 'fire'] as const) {
        if (!types.has(type)) errors.push(`${where}: log is missing a ${type} event`)
      }
    }
    for (const bot of bots) {
      const mine = log.filter((event) => event.actorSeatId === bot.id)
      const workCount = mine.filter((event) => event.type === 'work').length
      const latest = mine.map((event) => event.timestamp).sort().at(-1) ?? ''
      if (bot.stats?.tasksDone30d !== workCount) {
        errors.push(`${where}: ${bot.id} tasksDone30d ${bot.stats?.tasksDone30d ?? 'missing'} != ${workCount} work events`)
      }
      if ((bot.stats?.usageCount30d ?? -1) !== mine.length) {
        errors.push(`${where}: ${bot.id} usageCount30d ${bot.stats?.usageCount30d ?? 'missing'} != ${mine.length} events`)
      }
      if ((bot.stats?.lastActiveAt ?? '') !== latest) {
        errors.push(`${where}: ${bot.id} lastActiveAt does not match its latest event`)
      }
    }
    errors.push(...validateDemoActivity(where, bots, log, company.demoActivity))
    return errors
  }

  if (company.demoActivity) errors.push(`${where}: sample orgs do not use demo activity`)

  if (org.mock !== true) errors.push(`${where}: mock flag must be true`)
  if (company.seats.length < 12 || company.seats.length > 25) {
    errors.push(`${where}: expected 12–25 seats, found ${company.seats.length}`)
  }
  const humans = company.seats.filter((seat) => seat.type === 'human')
  const activeBots = company.seats.filter((seat) => seat.type === 'bot' && seat.status !== 'retired')
  const retiredBots = company.seats.filter((seat) => seat.type === 'bot' && seat.status === 'retired')
  if (humans.length < 1) errors.push(`${where}: needs a human owner`)
  // One person managing bots: the founder, the bots that lead, and the bots that do the steps.
  if (activeBots.length < 3 || activeBots.length > 15) {
    errors.push(`${where}: expected 3–15 active bots, found ${activeBots.length}`)
  }
  for (const bot of [...activeBots, ...retiredBots]) {
    const card = bot.card
    if (!card || !filled(card.owns) || !filled(card.may) || !filled(card.mustAskBefore) || !filled(card.doneWhen)) {
      errors.push(`${where}: bot ${bot.id} is missing a complete seat card`)
    }
    if (!bot.stats) errors.push(`${where}: bot ${bot.id} is missing stats`)
  }

  const log = company.log ?? []
  if (log.length < 20) errors.push(`${where}: expected at least 20 log events, found ${log.length}`)
  const types = new Set(log.map((event) => event.type))
  for (const type of LOG_TYPES) {
    if (!types.has(type)) errors.push(`${where}: log is missing a ${type} event`)
  }
  const times = log.map((event) => Date.parse(event.timestamp)).filter((time) => !Number.isNaN(time))
  if (Math.min(...times) > WINDOW_START + 2 * 86400000) errors.push(`${where}: log does not reach back about 30 days`)
  if (Math.max(...times) < AS_OF - 2 * 86400000) errors.push(`${where}: log has no recent event`)

  for (const bot of [...activeBots, ...retiredBots]) {
    const mine = log.filter((event) => event.actorSeatId === bot.id && Date.parse(event.timestamp) >= WINDOW_START && Date.parse(event.timestamp) <= WINDOW_END)
    const workCount = mine.filter((event) => event.type === 'work').length
    if (bot.stats && bot.stats.tasksDone30d !== workCount) {
      errors.push(`${where}: ${bot.id} tasksDone30d ${bot.stats.tasksDone30d} != ${workCount} work events`)
    }
    const latest = mine.map((event) => event.timestamp).sort().at(-1)
    if (bot.stats && latest && bot.stats.lastActiveAt !== latest) {
      errors.push(`${where}: ${bot.id} lastActiveAt does not match its latest event`)
    }
  }

  const least = [...activeBots].sort((a, b) => (a.stats?.usageCount30d ?? 0) - (b.stats?.usageCount30d ?? 0))[0]
  if (!least?.stats || least.stats.lastActiveAt >= new Date(AS_OF - 14 * 86400000).toISOString()) {
    errors.push(`${where}: least-used bot was active within 14 days`)
  }
  const usages = activeBots.map((bot) => bot.stats?.usageCount30d ?? 0)
  if (usages.filter((usage) => usage === Math.min(...usages)).length !== 1) {
    errors.push(`${where}: least-used bot is not unique`)
  }

  for (const bot of retiredBots) {
    if (!log.some((event) => event.type === 'fire' && event.subjectSeatId === bot.id)) {
      errors.push(`${where}: retired bot ${bot.id} has no fire event`)
    }
    const staffed = company.steps.filter((step) => step.executorSeatId === bot.id && step.staffing !== 'unstaffed')
    if (staffed.length) errors.push(`${where}: retired bot ${bot.id} still staffs ${staffed[0].id}`)
  }

  if (company.activity.length < 15 || company.activity.length > 30) {
    errors.push(`${where}: expected 15–30 activity events, found ${company.activity.length}`)
  }
  for (const event of company.activity) {
    const at = Date.parse(event.at)
    if (Number.isNaN(at) || at < Date.parse('2026-09-02T00:00:00Z') || at > Date.parse('2026-10-14T23:59:59Z')) {
      errors.push(`${where}: ${event.id} is outside the activity window`)
    }
    if (!ACTIONS.has(event.action) || !STATUSES.has(event.status)) errors.push(`${where}: ${event.id} action or status is unknown`)
    if (event.approverSeatId && seats.get(event.approverSeatId)?.type !== 'human') {
      errors.push(`${where}: ${event.id} approver must be human`)
    }
  }
  return errors
}

function validateDemoActivity(where: string, bots: Seat[], log: LogEvent[], demo: CompanySeed['demoActivity']): string[] {
  const errors: string[] = []
  if (!demo || demo.label !== 'Demo activity (sample)') {
    errors.push(`${where}: real activity is too thin, so a "Demo activity (sample)" log is required and must stay separate`)
    return errors
  }
  const realIds = new Set(log.map((event) => event.id))
  for (const event of demo.events) {
    if (realIds.has(event.id)) errors.push(`${where}: demo event ${event.id} overlaps the real log`)
  }
  const demoTypes = new Set(demo.events.map((event) => event.type))
  for (const type of LOG_TYPES) {
    if (!demoTypes.has(type)) errors.push(`${where}: demo activity is missing a ${type} event`)
  }
  const usage = new Map<string, { count: number; last: string }>()
  for (const bot of bots) {
    if (bot.status === 'retired') continue
    usage.set(bot.id, { count: 0, last: '' })
  }
  for (const event of demo.events) {
    const row = usage.get(event.actorSeatId)
    if (!row) continue
    row.count += 1
    if (event.timestamp > row.last) row.last = event.timestamp
  }
  const counts = [...usage.values()].map((row) => row.count)
  const min = Math.min(...counts)
  const least = [...usage.entries()].filter((entry) => entry[1].count === min)
  if (least.length !== 1) errors.push(`${where}: demo activity least-used bot is not unique`)
  else if (Date.parse(least[0][1].last) >= AS_OF - 14 * 86400000) {
    errors.push(`${where}: demo activity least-used bot was active within 14 days`)
  }
  return errors
}

function filled(items: string[] | undefined): boolean {
  return Boolean(items?.some((item) => item.trim()))
}

function cycle(seats: Seat[]): boolean {
  const next = new Map(seats.map((seat) => [seat.id, seat.reportsTo]))
  for (const seat of seats) {
    const seen = new Set<string>()
    let cursor: string | undefined = seat.id
    while (cursor) {
      if (seen.has(cursor)) return true
      seen.add(cursor)
      cursor = next.get(cursor)
    }
  }
  return false
}
