import { SEAT_SLUG, quote, unquote } from './org-files.ts'
import { normalizeText } from './normalize-text.ts'
import { logInstructions } from './connector-prompt.ts'

export const EVENT_SOURCES = ['email', 'slack', 'github', 'webhook', 'form'] as const
export type EventSource = (typeof EVENT_SOURCES)[number]
export type TriggerType = 'schedule' | 'event' | 'manual'

const CHECKPOINT_VERBS = ['send', 'pay', 'post', 'book', 'merge', 'publish', 'delete'] as const

export interface ProcessTrigger {
  type: TriggerType
  schedule: string
  source: EventSource | ''
  description: string
}

export interface ProcessStep {
  seat: string
  action: string
}

export interface ProcessFile {
  slug: string
  name: string
  trigger: ProcessTrigger
  steps: ProcessStep[]
  doneWhen: string
  next: string
  notes: string
}

export interface DerivedStep extends ProcessStep {
  checkpoint: boolean
  because: string
  approver: string
}

export interface SeatRef {
  slug: string
  title: string
  kind?: string
  mustAskBefore?: string[]
}

export interface ProcessImportRow {
  name: string
  trigger: ProcessTrigger
  steps: ProcessStep[]
  doneWhen: string
  next: string
  notes: string[]
  error: string
}

export function processSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

export function checkpointBecause(action: string, needsApproval: string[] = []): string {
  const lower = action.toLowerCase()
  const verb = CHECKPOINT_VERBS.find((item) => lower.includes(item))
  if (verb) return verb
  for (const line of needsApproval) {
    const text = line.trim()
    if (!text) continue
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
    if (words.some((word) => lower.includes(word))) return text
  }
  return ''
}

export function approverSlug(seats: SeatRef[]): string {
  const you = seats.find((seat) => seat.slug === 'you')
    ?? seats.find((seat) => seat.title.trim().toLowerCase() === 'you')
    ?? seats.find((seat) => seat.kind === 'human')
  return you?.slug || 'you'
}

/** How Grok Bot marks a step that must ask the owner first, at the start of its action. */
const NEEDS_APPROVAL = /^\s*needs approval:\s*/i

/** A step's action as people read it: without Grok Bot's "Needs approval:" mark, which shows as a checkpoint instead. */
export function stepText(action: string): string {
  return action.replace(NEEDS_APPROVAL, '')
}

export function deriveSteps(steps: ProcessStep[], seats: SeatRef[]): DerivedStep[] {
  const approver = approverSlug(seats)
  return steps.map((step) => {
    const seat = seats.find((item) => item.slug === step.seat)
    // Grok Bot's mark adds a checkpoint and never removes one: the seat's Needs approval list and the risky verbs always
    // count, whatever another step says, so a step the import forgot to mark still asks.
    const because = NEEDS_APPROVAL.test(step.action) ? 'Needs approval' : checkpointBecause(stepText(step.action), seat?.mustAskBefore ?? [])
    return { ...step, checkpoint: Boolean(because), because, approver }
  })
}

/**
 * Whether a step waits for you today: Grok Bot marked it "Needs approval:", or you do it yourself. The Work Chart tags
 * these. A checkpoint is wider, the asks a copied routine adds for safety, and those stay out of the tag.
 */
export function waitsForYou(step: DerivedStep): boolean {
  return NEEDS_APPROVAL.test(step.action) || step.seat === step.approver
}

/** True when a schedule can fire more than once in an hour. */
export function scheduleFasterThanHourly(schedule: string): boolean {
  const text = schedule.trim()
  if (!text) return false
  const cron = text.split(/\s+/)
  if (cron.length === 5 && cron.every((field) => /^[\d*,/-]+$/.test(field))) return minuteHits(cron[0]!) > 1
  if (/\bevery\s+(second|minute)\b/i.test(text)) return true
  const every = /\bevery\s+(\d+)\s*(seconds?|secs?|minutes?|mins?)\b/i.exec(text)
  if (!every) return false
  const count = Number(every[1])
  const unit = every[2]!.toLowerCase()
  if (unit.startsWith('sec')) return true
  return count > 0 && count < 60
}

function minuteHits(field: string): number {
  if (field === '*' || field === '') return 60
  const stepped = /^\*\/(\d+)$/.exec(field)
  if (stepped) {
    const step = Number(stepped[1])
    if (!Number.isFinite(step) || step <= 0) return 60
    return Math.ceil(60 / step)
  }
  let count = 0
  for (const part of field.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part)
    if (range) {
      count += Math.max(0, Number(range[2]) - Number(range[1]) + 1)
      continue
    }
    if (/^\d+$/.test(part)) {
      count += 1
      continue
    }
    return 60
  }
  return count
}

export function serializeProcess(process: ProcessFile): string {
  const lines = [
    '---',
    `name: ${quote(process.name.trim())}`,
    `trigger: ${process.trigger.type}`,
  ]
  if (process.trigger.type === 'schedule') lines.push(`schedule: ${quote(process.trigger.schedule.trim())}`)
  if (process.trigger.type === 'event') lines.push(`source: ${process.trigger.source || ''}`)
  if (process.trigger.description.trim()) lines.push(`description: ${quote(process.trigger.description.trim())}`)
  lines.push(`doneWhen: ${quote(process.doneWhen.trim())}`)
  if (process.next.trim()) lines.push(`next: ${quote(process.next.trim())}`)
  lines.push('---', '', '## Steps', '')
  for (const step of process.steps) {
    lines.push(`- ${step.seat.trim()} | ${step.action.trim()}`)
  }
  lines.push('', '## Notes', '', process.notes.trim(), '')
  return lines.join('\n').replace(/\n+$/, '\n')
}

export function parseProcessMarkdown(slug: string, source: string): { ok: true; process: ProcessFile } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!SEAT_SLUG.test(slug)) errors.push(`${slug}: filename must be a lowercase slug.`)
  const text = normalizeText(source)
  if (!text.startsWith('---')) return { ok: false, errors: [`${slug}.md: missing opening frontmatter.`] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: [`${slug}.md: missing closing frontmatter.`] }
  const raw = rest.slice(0, close)
  const body = rest.slice(close).replace(/^\r?\n---\r?\n?/, '')
  const data: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (!field) {
      errors.push(`${slug}.md: cannot read frontmatter line: ${line}`)
      continue
    }
    data[field[1]!] = unquote(field[2] ?? '')
  }
  const name = data.name?.trim() ?? ''
  if (!name) errors.push(`${slug}.md: name is required.`)
  const type = data.trigger?.trim() || ''
  if (type !== 'schedule' && type !== 'event' && type !== 'manual') errors.push(`${slug}.md: trigger must be schedule, event, or manual.`)
  const sourceName = data.source?.trim() ?? ''
  if (type === 'event' && sourceName && !EVENT_SOURCES.includes(sourceName as EventSource)) {
    errors.push(`${slug}.md: source must be email, slack, github, webhook, or form.`)
  }
  const steps = parseSteps(body)
  const notes = notesOf(body)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    process: {
      slug,
      name,
      trigger: {
        type: type as TriggerType,
        schedule: data.schedule?.trim() ?? '',
        source: (EVENT_SOURCES.includes(sourceName as EventSource) ? sourceName : '') as EventSource | '',
        description: data.description?.trim() ?? '',
      },
      steps,
      doneWhen: data.doneWhen?.trim() ?? '',
      next: data.next?.trim() ?? '',
      notes,
    },
  }
}

function parseSteps(body: string): ProcessStep[] {
  const section = sectionBody(body, 'Steps')
  const steps: ProcessStep[] = []
  for (const line of section.split(/\r?\n/)) {
    const item = /^-\s+(.+)$/.exec(line.trim())
    if (!item) continue
    const split = item[1]!.split(/\s+\|\s+/)
    const seat = (split[0] ?? '').trim()
    const action = split.slice(1).join(' | ').trim() || seat
    const seatOnly = split.length === 1 ? '' : seat
    if (!seat) continue
    steps.push(split.length === 1 ? { seat, action: '' } : { seat: seatOnly, action })
  }
  return steps
}

function notesOf(body: string): string {
  return sectionBody(body, 'Notes').trim()
}

function sectionBody(body: string, heading: string): string {
  const match = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`).exec(`\n${body}`)
  return match?.[1] ?? ''
}

export function parseProcessesFile(text: string): { ok: true; rows: ProcessImportRow[] } | { ok: false; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['That file is not JSON.'] }
  }
  const record = parsed && typeof parsed === 'object' ? parsed as { processes?: unknown } : null
  if (!record || !Array.isArray(record.processes)) return { ok: false, errors: ['Expected a processes array.'] }
  return { ok: true, rows: record.processes.map((item) => importRow(item)) }
}

function importRow(item: unknown): ProcessImportRow {
  const notes: string[] = []
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return blankRow('', 'Each process must be an object.', notes)
  }
  const row = item as Record<string, unknown>
  const name = typeof row.name === 'string' ? row.name.trim() : row.name == null ? '' : String(row.name).trim()
  if (!name) return blankRow('', 'Name is required.', notes)
  const trigger = looseTrigger(row.trigger, notes)
  const steps = looseSteps(row.steps, notes)
  const doneWhen = looseText(row.doneWhen)
  const next = row.next == null ? '' : looseText(row.next)
  return { name, trigger, steps, doneWhen, next, notes, error: '' }
}

function blankRow(name: string, error: string, notes: string[]): ProcessImportRow {
  return {
    name,
    trigger: { type: 'manual', schedule: '', source: '', description: '' },
    steps: [],
    doneWhen: '',
    next: '',
    notes,
    error,
  }
}

function looseTrigger(value: unknown, notes: string[]): ProcessTrigger {
  if (value == null || value === '') {
    notes.push('trigger was left out.')
    return { type: 'manual', schedule: '', source: '', description: '' }
  }
  if (typeof value === 'string') {
    const type = value.trim()
    if (type === 'schedule' || type === 'event' || type === 'manual') {
      notes.push('trigger details were left out.')
      return { type, schedule: '', source: '', description: '' }
    }
    notes.push('trigger type was left out.')
    return { type: 'manual', schedule: '', source: '', description: '' }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    notes.push('trigger was left out.')
    return { type: 'manual', schedule: '', source: '', description: '' }
  }
  const trigger = value as Record<string, unknown>
  const typeText = typeof trigger.type === 'string' ? trigger.type.trim() : ''
  const type: TriggerType = typeText === 'schedule' || typeText === 'event' || typeText === 'manual' ? typeText : 'manual'
  if (!typeText) notes.push('trigger type was left out.')
  else if (typeText !== type) notes.push('trigger type was left out.')
  const sourceText = looseText(trigger.source)
  const source = EVENT_SOURCES.includes(sourceText as EventSource) ? (sourceText as EventSource) : ''
  if (sourceText && !source) notes.push('source was left out.')
  return {
    type,
    schedule: looseText(trigger.schedule),
    source,
    description: looseText(trigger.description),
  }
}

function looseSteps(value: unknown, notes: string[]): ProcessStep[] {
  if (value == null || value === '') return []
  if (typeof value === 'string') return value.split(/\r?\n/).map(stepFromText).filter((step) => step.seat || step.action)
  if (!Array.isArray(value)) {
    notes.push('steps were left out.')
    return []
  }
  return value.map((item) => {
    if (typeof item === 'string') return stepFromText(item)
    if (!item || typeof item !== 'object') return { seat: '', action: '' }
    const step = item as Record<string, unknown>
    return { seat: looseText(step.seat), action: looseText(step.action) }
  }).filter((step) => step.seat || step.action)
}

function stepFromText(value: string): ProcessStep {
  const split = value.split(/\s+\|\s+|\s+:\s+|:\s+/)
  if (split.length === 1) return { seat: split[0]!.trim(), action: '' }
  return { seat: split[0]!.trim(), action: split.slice(1).join(': ').trim() }
}

function looseText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => looseText(item)).filter(Boolean).join(' ')
  return ''
}

export function matchStepSeats(steps: ProcessStep[], seats: { slug: string; title: string }[]): { steps: ProcessStep[]; notes: string[] } {
  const notes: string[] = []
  const next = steps.map((step) => {
    const matched = matchSeat(step.seat, seats)
    if (!step.seat.trim()) return step
    if (!matched) {
      notes.push(`Unknown seat ${step.seat}.`)
      return step
    }
    return { ...step, seat: matched }
  })
  return { steps: next, notes }
}

function matchSeat(value: string, seats: { slug: string; title: string }[]): string {
  const text = value.trim()
  if (!text) return ''
  const exact = seats.find((seat) => seat.slug === text)
  if (exact) return exact.slug
  const named = seats.find((seat) => seat.title.trim().toLowerCase() === text.toLowerCase())
  if (named) return named.slug
  const slug = processSlug(text)
  const slugged = seats.find((seat) => seat.slug === slug)
  return slugged?.slug ?? ''
}

export function routinePrompt(process: Pick<ProcessFile, 'name' | 'slug' | 'trigger' | 'steps' | 'doneWhen'>, seats: SeatRef[], ownerSlug = '', folder = 'orgs/<slug>'): string {
  const owner = seats.find((seat) => seat.slug === (ownerSlug || process.steps[0]?.seat || ''))
  const ownerName = owner?.title || 'the owning bot'
  const derived = deriveSteps(process.steps, seats)
  const lines = [
    `You are ${ownerName}.`,
    '',
    `Routine: ${process.name}`,
    '',
    triggerLine(process.trigger),
    '',
    'Steps:',
  ]
  derived.forEach((step, index) => {
    const seat = seats.find((item) => item.slug === step.seat)
    lines.push(`${index + 1}. ${seat?.title || step.seat || 'Unassigned'}: ${stepText(step.action)}`)
    if (step.checkpoint) lines.push(`Ask me before ${stepText(step.action) || step.because}.`)
  })
  lines.push('', `Done when: ${process.doneWhen.trim() || 'Say what finished.'}`, '')
  const seatFile = owner ? `seats/${owner.slug}.md` : 'seats/<seat>.md'
  lines.push(...logInstructions(folder, `processes/${process.slug || processSlug(process.name)}.md`, seatFile))
  return lines.join('\n')
}

function triggerLine(trigger: ProcessTrigger): string {
  if (trigger.type === 'schedule') return `Schedule: ${trigger.schedule || 'not set'}${trigger.description ? ` — ${trigger.description}` : ''}`
  if (trigger.type === 'event') {
    const source = trigger.source || 'event'
    return `Trigger: ${source}${trigger.description ? ` — ${trigger.description}` : ''}`
  }
  return `Trigger: manual${trigger.description ? ` — ${trigger.description}` : ''}`
}

export function triggerLabel(trigger: ProcessTrigger): string {
  if (trigger.type === 'schedule') return trigger.schedule || 'Schedule'
  if (trigger.type === 'event') return trigger.source ? trigger.source : 'Event'
  return 'Manual'
}

/** The work chart import prompt. With bot names, Grok Bot lists only those bots' routines, since one account runs bots for every organization. */
export function grokProcessesPrompt(botNames: string[] = []): string {
  const names = [...new Set(botNames.map((name) => name.trim()).filter(Boolean))]
  const scope = names.length
    ? `List the routines and handoffs that these bots already run: ${names.join(', ')}. Leave out every other bot.`
    : 'List the routines and handoffs your bots already run for this organization.'
  return `${scope} Save them as one file named botseverywhere-processes.json so I can import them into the BotsEverywhere Work Chart.

Use exactly this JSON format and nothing else:
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
}

export const GROK_PROCESSES_PROMPT = grokProcessesPrompt()
