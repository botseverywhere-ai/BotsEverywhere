import { normalizeText } from './normalize-text.ts'

export const GROK_BOT_URL = /^https:\/\/x\.ai\/bot\/[A-Za-z0-9][A-Za-z0-9_-]*$/
export const SEAT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const CARD_HEADS = ['Owns', 'May', 'Needs approval', 'Done when'] as const

export interface OrgCompany {
  name: string
  tagline?: string
  industry?: string
  mark?: string
  markColor?: string
}

export interface OrgDepartment {
  id: string
  name: string
}

export interface OrgPerson {
  id: string
  name: string
  title?: string
  department?: string
  email?: string
  phone?: string
  location?: string
  bio?: string
  startedOn?: string
}

export interface OrgSeatRef {
  slug: string
  reportsTo?: string | null
}

export interface OrgDocument {
  company: OrgCompany
  departments: OrgDepartment[]
  people: OrgPerson[]
  seats: OrgSeatRef[]
  /** Process that catches work no other process claimed. Defaults to triage, owned by You. */
  fallbackProcess?: string
}

export type SeatKind = 'human' | 'bot' | 'system'
export type StepLevel = 2 | 3 | 4

export interface WorkStepFile {
  id: string
  workstreamId: string
  name: string
  level: StepLevel
  executorSeatId: string
  inputs?: string[]
  outputs?: string[]
  checkpointId?: string
}

export interface WorkDocument {
  triggers: { id: string; source: string; label: string; example: string }[]
  workstreams: {
    id: string
    triggerId: string
    outcome: string
    ownerSeatId: string
    kind: 'main' | 'contingency'
    stepIds: string[]
  }[]
  steps: WorkStepFile[]
  handoffs: { id: string; fromStepId: string; toStepId: string; condition?: string }[]
  checkpoints: { id: string; stepId: string; rule: string; approverSeatId: string; required: boolean }[]
}

export type BotRunStatus = 'active' | 'paused' | 'retired'

export type GrokSyncState = 'new' | 'synced' | 'missing'
const GROK_SYNC_STATES = new Set<GrokSyncState>(['new', 'synced', 'missing'])

/** One routine reported by Grok Bot or typed in Profile. `schedule` is the schedule or the trigger. */
export interface BotRoutine {
  name: string
  schedule: string
  lastRun?: string
  /** One line on what it does. Never the instructions. */
  description?: string
}

/** A reusable workflow the bot runs. */
export interface BotSkill {
  name: string
  description?: string
}

export interface SeatDocument {
  slug: string
  title: string
  department: string
  reportsTo: string
  addToGrokBotUrl: string
  status: 'active' | 'retired'
  kind: SeatKind
  role: string
  /** Optional chart blurb. The org chart prefers this over the first Owns line. */
  description?: string
  personId: string
  hiredAt: string
  retiredAt: string
  directoryId: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
  /** `existing` when the seat file was added from a bot the user already has. */
  seatOrigin?: '' | 'existing'
  /** Any http(s) link. Separate from addToGrokBotUrl, which stays an x.ai bot link. */
  grokBotUrl?: string
  /** ISO date from a bots-file import. Empty when Grok Bot did not report it. */
  createdAt?: string
  /** ISO datetime from a bots-file import. Not the time the file was imported. */
  lastActive?: string
  /** Runs in the last 30 days. Absent when Grok Bot did not report it. */
  runs30d?: number
  /** Tasks done in the last 30 days. Absent when Grok Bot did not report it. */
  tasksDone30d?: number
  routines?: BotRoutine[]
  /** Reusable workflows: from Grok Bot for an imported bot, typed in Profile for one added by hand. */
  skills?: BotSkill[]
  /** The prompt Grok Bot gets, written in Profile. A directory bot starts from its directory prompt. */
  instructions?: string
  /** The bot's public share link from Grok Bot, when it is public. Shown, never edited in the app. */
  publicUrl?: string
  /** Run status from the bots file. Separate from seat status, which is only active or retired. */
  botStatus?: BotRunStatus
  /** Set by Sync with Grok Bot. new: created by a sync. synced: seen in the last confirmed snapshot. missing: not in it. */
  grokSync?: GrokSyncState
  /** ISO datetime of the snapshot that last confirmed this seat. */
  grokSyncedAt?: string
  /** ISO datetime of the snapshot that first missed this seat. */
  grokMissingSince?: string
  /** ISO datetime of the Connector run that showed this retired bot gone from Grok Bot after a delete request. */
  grokDeletedAt?: string
  source: string
}

export type ActivityType = 'work' | 'approval' | 'exception' | 'hire' | 'fire' | 'edit'

export interface FileActivity {
  id: string
  orgId: string
  type: ActivityType
  actorSeatId: string
  actorType: SeatKind
  timestamp: string
  summary: string
  subjectSeatId?: string
  stepId?: string
  workstreamId?: string
  status?: string
  approverSeatId?: string
  /** in: a change that came from Grok Bot. out: a change sent to Grok Bot through the Connector. */
  grok?: 'in' | 'out'
  /** What the Logs tab labels it, such as connected, bot-connected, connector-run, sync. Older events have none. */
  kind?: string
  /** Figures shown as tiles, written as `Label=value|Label=value`. */
  stats?: string
}

export interface OrgBundle {
  id: string
  org: OrgDocument
  seats: SeatDocument[]
  work: WorkDocument
  activity: FileActivity[]
  /** One file per process. Absent on older in-memory bundles. */
  processes?: import('./processes.ts').ProcessFile[]
  /** Unmatched work falls here. Defaults to triage, owned by You. */
  fallbackProcess?: string
  processNotes?: string[]
  /** Bundled sample run log. The writer serves live lines separately. */
  runLog?: import('./run-log.ts').RunLine[]
}

export interface OrgProfile {
  name: string
  description: string
  purpose: string
  industry: string
  size: string
  people: number
  bots: number
}

export function isGrokBotUrl(value: string): boolean {
  return value === '' || GROK_BOT_URL.test(value)
}

/** Empty, or an http(s) URL. Rejects javascript: and other schemes. */
export function isHttpUrl(value: string): boolean {
  if (value === '') return true
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

/** Empty, an http(s) URL, or a grokbot:// app link. */
export function isSeatGrokLink(value: string): boolean {
  const link = value.trim()
  if (link === '') return true
  if (/^grokbot:\/\//i.test(link)) return true
  return isHttpUrl(link) && link !== ''
}

export function parseSeatMarkdown(slug: string, source: string): { ok: true; seat: SeatDocument } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!SEAT_SLUG.test(slug)) errors.push(`${slug}: filename must be a lowercase slug.`)
  const text = normalizeText(source)
  if (!text.startsWith('---')) return { ok: false, errors: [`${slug}.md: missing opening frontmatter.`] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: [`${slug}.md: missing closing frontmatter.`] }
  const raw = rest.slice(0, close)
  const body = rest.slice(close).replace(/^\r?\n---\r?\n?/, '').trim()
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
  const title = (data.title ?? data.name ?? '').trim()
  const department = (data.department ?? '').trim() || 'general'
  const reportsTo = data.reportsTo?.trim() ?? ''
  const addToGrokBotUrl = (data.addToGrokBotUrl ?? data.grokShareUrl ?? '').trim()
  const statusRaw = data.status?.trim() || 'active'
  const kindRaw = data.kind?.trim() || 'bot'
  const role = data.role?.trim() || title
  const description = (data.description ?? '').trim()
  const personId = data.personId?.trim() ?? ''
  const hiredAt = data.hiredAt?.trim() ?? ''
  const retiredAt = data.retiredAt?.trim() ?? ''
  const directoryId = (data.directoryId ?? data.directorySlug ?? '').trim()
  const grokBotUrl = (data.grokBotUrl ?? '').trim()
  const originRaw = (data.source ?? '').trim()
  const seatOrigin = originRaw === 'existing' && (kindRaw === 'bot' || kindRaw === '') ? 'existing' : ''
  if (!title) errors.push(`${slug}.md: title is required.`)
  if (!department) errors.push(`${slug}.md: department is required.`)
  if (statusRaw !== 'active' && statusRaw !== 'retired') errors.push(`${slug}.md: status must be active or retired.`)
  if (kindRaw !== 'human' && kindRaw !== 'bot' && kindRaw !== 'system') errors.push(`${slug}.md: kind must be human, bot, or system.`)
  if (!isGrokBotUrl(addToGrokBotUrl)) errors.push(`${slug}.md: addToGrokBotUrl must be empty or https://x.ai/bot/…`)
  if (!isSeatGrokLink(grokBotUrl)) errors.push(`${slug}.md: grokBotUrl must be an http, https, or grokbot:// link.`)
  if (originRaw && originRaw !== 'existing') errors.push(`${slug}.md: source must be existing.`)
  if (originRaw === 'existing' && kindRaw !== 'bot') errors.push(`${slug}.md: source existing is only for a bot.`)
  if (data.grokShareUrl !== undefined && data.addToGrokBotUrl !== undefined && data.grokShareUrl.trim() !== data.addToGrokBotUrl.trim()) {
    errors.push(`${slug}.md: addToGrokBotUrl: rename grokShareUrl and keep a single value.`)
  }
  if (reportsTo && !SEAT_SLUG.test(reportsTo)) errors.push(`${slug}.md: reportsTo must be a seat slug.`)
  if (hiredAt && Number.isNaN(Date.parse(hiredAt))) errors.push(`${slug}.md: hiredAt must be an ISO timestamp.`)
  if (retiredAt && Number.isNaN(Date.parse(retiredAt))) errors.push(`${slug}.md: retiredAt must be an ISO timestamp.`)
  const card = cardSections(body)
  if (errors.length) return { ok: false, errors }
  const seat: SeatDocument = {
    slug,
    title,
    department,
    reportsTo,
    addToGrokBotUrl,
    status: statusRaw as 'active' | 'retired',
    kind: kindRaw as SeatKind,
    role,
    ...(description ? { description } : {}),
    personId,
    hiredAt,
    retiredAt,
    directoryId,
    seatOrigin,
    grokBotUrl,
    ...readBotMetrics(data),
    ...readSyncFields(data),
    ...card,
    source: '',
  }
  seat.source = serializeSeat(seat)
  return { ok: true, seat }
}

export function serializeSeat(seat: Omit<SeatDocument, 'source'> & { source?: string }): string {
  if (seat.seatOrigin === 'existing') {
    return serializeExistingSeat({
      name: seat.title,
      grokBotUrl: seat.grokBotUrl ?? '',
      reportsTo: seat.reportsTo,
      addToGrokBotUrl: seat.addToGrokBotUrl,
      description: seat.description,
      owns: seat.owns,
      may: seat.may,
      mustAskBefore: seat.mustAskBefore,
      doneWhen: seat.doneWhen,
      createdAt: seat.createdAt,
      lastActive: seat.lastActive,
      runs30d: seat.runs30d,
      tasksDone30d: seat.tasksDone30d,
      routines: seat.routines,
      skills: seat.skills,
      instructions: seat.instructions,
      publicUrl: seat.publicUrl,
      botStatus: seat.botStatus,
      grokSync: seat.grokSync,
      grokSyncedAt: seat.grokSyncedAt,
      grokMissingSince: seat.grokMissingSince,
      grokDeletedAt: seat.grokDeletedAt,
      status: seat.status,
      retiredAt: seat.retiredAt,
    })
  }
  const lines = [
    '---',
    `title: ${quote(seat.title)}`,
    `department: ${quote(seat.department)}`,
    `reportsTo: ${quote(seat.reportsTo)}`,
    `addToGrokBotUrl: ${quote(seat.addToGrokBotUrl ?? '')}`,
    `status: ${seat.status}`,
    `kind: ${seat.kind}`,
    `role: ${quote(seat.role)}`,
    ...(seat.description?.trim() ? [`description: ${quote(seat.description.trim())}`] : []),
    `personId: ${quote(seat.personId)}`,
    `hiredAt: ${quote(seat.hiredAt ?? '')}`,
    `retiredAt: ${quote(seat.retiredAt ?? '')}`,
    `directoryId: ${quote(seat.directoryId ?? '')}`,
    ...(seat.grokBotUrl?.trim() ? [`grokBotUrl: ${quote(seat.grokBotUrl.trim())}`] : []),
    ...metricLines(seat),
    '---',
    '',
  ]
  const sections: [string, string[]][] = [
    ['Owns', seat.owns],
    ['May', seat.may],
    ['Needs approval', seat.mustAskBefore],
    ['Done when', seat.doneWhen],
  ]
  for (const [heading, items] of sections) {
    lines.push(`## ${heading}`)
    if (items.length === 0) lines.push('')
    for (const item of items) lines.push(item)
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

/** Markdown for a bot the user already has. `source: existing` is not the markdown body. */
export function serializeExistingSeat(seat: {
  name: string
  grokBotUrl: string
  reportsTo: string
  addToGrokBotUrl?: string
  description?: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  routines?: BotRoutine[]
  skills?: BotSkill[]
  instructions?: string
  publicUrl?: string
  botStatus?: BotRunStatus
  grokSync?: GrokSyncState
  grokSyncedAt?: string
  grokMissingSince?: string
  grokDeletedAt?: string
  /** Written only when retired. An imported bot with no status line is active. */
  status?: 'active' | 'retired'
  retiredAt?: string
}): string {
  const lines = [
    '---',
    `name: ${quote(seat.name)}`,
    'kind: bot',
    'source: existing',
    `grokBotUrl: ${quote(seat.grokBotUrl ?? '')}`,
    `reportsTo: ${quote(seat.reportsTo)}`,
  ]
  if (seat.status === 'retired') lines.push('status: retired', `retiredAt: ${quote(seat.retiredAt ?? '')}`)
  if (seat.addToGrokBotUrl) lines.push(`addToGrokBotUrl: ${quote(seat.addToGrokBotUrl)}`)
  const described = seat.description?.trim()
  if (described) lines.push(`description: ${quote(described)}`)
  lines.push(...metricLines(seat))
  lines.push('---', '', cardBody(seat))
  return lines.join('\n').replace(/\n+$/, '\n')
}

/** Markdown written when a bot is hired. `name` and `directorySlug` are the on-disk fields. */
export function serializeHiredSeat(seat: {
  name: string
  kind: SeatKind
  directorySlug: string
  reportsTo: string
  addToGrokBotUrl: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
}): string {
  const lines = [
    '---',
    `name: ${quote(seat.name)}`,
    `kind: ${seat.kind}`,
    `directorySlug: ${quote(seat.directorySlug)}`,
    `reportsTo: ${quote(seat.reportsTo)}`,
    `addToGrokBotUrl: ${quote(seat.addToGrokBotUrl ?? '')}`,
    '---',
    '',
    cardBody(seat),
  ]
  return lines.join('\n').replace(/\n+$/, '\n')
}

export function replaceSeatCardBody(
  slug: string,
  source: string,
  card: Pick<SeatDocument, 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>,
  addToGrokBotUrl?: string,
): { ok: true; source: string } | { ok: false; errors: string[] } {
  const parsed = parseSeatMarkdown(slug, source)
  if (!parsed.ok) return parsed
  const next: SeatDocument = {
    ...parsed.seat,
    owns: cleanLines(card.owns),
    may: cleanLines(card.may),
    mustAskBefore: cleanLines(card.mustAskBefore),
    doneWhen: cleanLines(card.doneWhen),
    addToGrokBotUrl: addToGrokBotUrl === undefined ? parsed.seat.addToGrokBotUrl : addToGrokBotUrl.trim(),
    source: '',
  }
  const gaps = activeBotCardErrors(next)
  if (gaps.length) return { ok: false, errors: gaps }
  if (!isGrokBotUrl(next.addToGrokBotUrl)) return { ok: false, errors: [`${slug}.md: addToGrokBotUrl must be empty or https://x.ai/bot/…`] }
  const text = source.replace(/^\uFEFF/, '')
  const front = /^---\r?\n[\s\S]*?\r?\n---/.exec(text)
  if (!front) return { ok: false, errors: [`${slug}.md: missing frontmatter.`] }
  let head = front[0]
  if (addToGrokBotUrl !== undefined) head = setFrontmatterField(head, 'addToGrokBotUrl', next.addToGrokBotUrl)
  const written = `${head}\n\n${cardBody(next)}`
  const check = parseSeatMarkdown(slug, written)
  if (!check.ok) return check
  return { ok: true, source: written.endsWith('\n') ? written : `${written}\n` }
}

function cardBody(seat: Pick<SeatDocument, 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>): string {
  const lines: string[] = []
  const sections: [string, string[]][] = [
    ['Owns', seat.owns],
    ['May', seat.may],
    ['Needs approval', seat.mustAskBefore],
    ['Done when', seat.doneWhen],
  ]
  for (const [heading, items] of sections) {
    lines.push(`## ${heading}`)
    if (items.length === 0) lines.push('')
    for (const item of items) lines.push(item)
    lines.push('')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}

function cleanLines(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

function setFrontmatterField(front: string, key: string, value: string): string {
  const line = `${key}: ${quote(value)}`
  const pattern = new RegExp(`^${key}:\\s*.*$`, 'm')
  if (pattern.test(front)) return front.replace(pattern, line)
  return front.replace(/\r?\n---$/, `\n${line}\n---`)
}

const CARD_FIELDS = [
  ['owns', 'Owns'],
  ['may', 'May'],
  ['mustAskBefore', 'Needs approval'],
  ['doneWhen', 'Done when'],
] as const

export function activeBotCardGaps(seat: Pick<SeatDocument, 'kind' | 'status' | 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>): { key: (typeof CARD_FIELDS)[number][0]; label: string }[] {
  if (seat.kind !== 'bot' || seat.status !== 'active') return []
  return CARD_FIELDS.filter(([key]) => !seat[key].some((line) => line.trim())).map(([key, label]) => ({ key, label }))
}

/** True when `before` already had this seat active with the same card. A card already on disk is not judged again on every save. */
export function cardUnchanged(seat: Pick<SeatDocument, 'status' | 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>, before?: Pick<SeatDocument, 'status' | 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>): boolean {
  if (!before || before.status !== seat.status) return false
  return CARD_FIELDS.every(([key]) => JSON.stringify(before[key]) === JSON.stringify(seat[key]))
}

export function activeBotCardErrors(seat: Pick<SeatDocument, 'slug' | 'kind' | 'status' | 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>): string[] {
  return activeBotCardGaps(seat).map((gap) => `${seat.slug}.md: ${gap.label}: an active bot needs at least one line.`)
}

export function validateBundle(bundle: OrgBundle): string[] {
  const errors: string[] = []
  const slugs = new Set(bundle.seats.map((seat) => seat.slug))
  const listed = new Set(bundle.org.seats.map((seat) => seat.slug))
  if (!bundle.org.company?.name?.trim()) errors.push(`${bundle.id}: Organization name is required.`)
  for (const seat of bundle.org.seats) {
    if (!SEAT_SLUG.test(seat.slug)) errors.push(`${bundle.id}: bad seat slug ${seat.slug}.`)
    if (!slugs.has(seat.slug)) errors.push(`${bundle.id}: ${seat.slug} is listed in the org chart but has no markdown file.`)
    const reportsTo = seat.reportsTo ?? ''
    if (reportsTo && !slugs.has(reportsTo)) errors.push(`${bundle.id}: ${seat.slug} reports to missing seat ${reportsTo}.`)
  }
  for (const seat of bundle.seats) {
    if (!listed.has(seat.slug)) errors.push(`${bundle.id}: ${seat.slug}.md is not listed in the org chart.`)
    const ref = bundle.org.seats.find((item) => item.slug === seat.slug)
    const treeParent = ref?.reportsTo ?? ''
    if ((treeParent ?? '') !== seat.reportsTo) {
      errors.push(`${bundle.id}: ${seat.slug} reportsTo does not match the org chart.`)
    }
    if (seat.personId && !bundle.org.people.some((person) => person.id === seat.personId)) {
      errors.push(`${bundle.id}: ${seat.slug} personId ${seat.personId} is not in the org chart.`)
    }
    if (seat.reportsTo === seat.slug) errors.push(`${bundle.id}: ${seat.slug} cannot report to itself.`)
  }
  if (hasCycle(bundle.org.seats)) errors.push(`${bundle.id}: the seat tree has a cycle.`)
  if (bundle.seats.some((seat) => seat.kind === 'human') && !bundle.seats.some((seat) => seat.kind === 'human' && seat.status !== 'retired')) {
    errors.push(`${bundle.id}: keep at least one person in the organization.`)
  }
  const stepIds = new Set(bundle.work.steps.map((step) => step.id))
  for (const stream of bundle.work.workstreams) {
    if (!bundle.work.triggers.some((trigger) => trigger.id === stream.triggerId)) {
      errors.push(`${bundle.id}: workstream ${stream.id} has no trigger.`)
    }
    if (stream.ownerSeatId && !slugs.has(stream.ownerSeatId)) {
      errors.push(`${bundle.id}: workstream owner ${stream.ownerSeatId} is not a seat.`)
    }
    for (const stepId of stream.stepIds) {
      if (!stepIds.has(stepId)) errors.push(`${bundle.id}: missing step ${stepId}.`)
    }
  }
  for (const step of bundle.work.steps) {
    if (step.executorSeatId && !slugs.has(step.executorSeatId)) {
      errors.push(`${bundle.id}: step ${step.id} executor ${step.executorSeatId} is not a seat.`)
    }
  }
  for (const checkpoint of bundle.work.checkpoints) {
    const approver = bundle.seats.find((seat) => seat.slug === checkpoint.approverSeatId)
    if (!approver) errors.push(`${bundle.id}: checkpoint ${checkpoint.id}: approverSeatId is not a seat.`)
    else if (approver.kind !== 'human') errors.push(`${bundle.id}: checkpoint ${checkpoint.id}: approverSeatId must be a human.`)
  }
  for (const event of bundle.activity) {
    errors.push(...validateActivity(event, bundle.id).map((error) => `${bundle.id}: ${error}`))
  }
  return errors
}

export function bundleFromState(id: string, org: OrgDocument, seats: SeatDocument[], work: WorkDocument, activity: FileActivity[] = []): OrgBundle {
  const ordered = sortBySlug(seats)
  const synced: OrgDocument = {
    ...org,
    seats: ordered.map((seat) => ({ slug: seat.slug, reportsTo: seat.reportsTo || null })),
  }
  const rewritten = ordered.map((seat) => {
    const source = serializeSeat(seat)
    return { ...seat, source }
  })
  return { id, org: synced, seats: rewritten, work, activity }
}

function sortBySlug<T extends { slug: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

const ACTIVITY_TYPES = new Set<ActivityType>(['work', 'approval', 'exception', 'hire', 'fire', 'edit'])

export function validateActivity(event: FileActivity, orgId = event.orgId): string[] {
  const errors: string[] = []
  if (!event.id?.trim()) errors.push('activity.jsonl: id is required.')
  if (event.orgId !== orgId) errors.push('activity.jsonl: orgId does not match this org.')
  if (!ACTIVITY_TYPES.has(event.type)) errors.push(`activity.jsonl: type ${event.type} is not allowed.`)
  if (!event.actorSeatId?.trim()) errors.push('activity.jsonl: actorSeatId is required.')
  if (event.actorType !== 'human' && event.actorType !== 'bot' && event.actorType !== 'system') {
    errors.push('activity.jsonl: actorType must be human, bot, or system.')
  }
  if (!event.timestamp || Number.isNaN(Date.parse(event.timestamp))) errors.push('activity.jsonl: timestamp must be ISO 8601.')
  if (!event.summary?.trim()) errors.push('activity.jsonl: summary is required.')
  return errors
}

export function parseActivityLog(text: string, orgId: string): { ok: true; events: FileActivity[] } | { ok: false; errors: string[] } {
  const events: FileActivity[] = []
  const errors: string[] = []
  const lines = normalizeText(text).split('\n')
  lines.forEach((line, index) => {
    if (line.trim() === '') return
    let parsed: FileActivity
    try {
      parsed = JSON.parse(line) as FileActivity
    } catch {
      errors.push(`activity.jsonl: line ${index + 1}: not JSON.`)
      return
    }
    const problems = validateActivity(parsed, orgId)
    if (problems.length) errors.push(...problems.map((problem) => problem.replace('activity.jsonl:', `activity.jsonl line ${index + 1}:`)))
    else events.push(parsed)
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, events }
}

export function seatStats(events: FileActivity[], seatId: string, now = Date.now()): { usageCount30d: number; tasksDone30d: number; lastActiveAt: string } {
  const related = events.filter((event) => event.actorSeatId === seatId || event.subjectSeatId === seatId)
  const times = related.map((event) => Date.parse(event.timestamp)).filter((time) => !Number.isNaN(time))
  const last = times.length ? Math.max(...times) : 0
  const windowStart = now - 30 * 24 * 60 * 60 * 1000
  const usage = related.filter((event) => {
    const time = Date.parse(event.timestamp)
    return event.actorSeatId === seatId && time >= windowStart && time <= now
  })
  return {
    usageCount30d: usage.length,
    tasksDone30d: usage.filter((event) => event.type === 'work').length,
    lastActiveAt: last ? new Date(last).toISOString() : '',
  }
}

function cardSections(body: string): Pick<SeatDocument, 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'> {
  const found: Record<string, string[]> = { Owns: [], May: [], 'Needs approval': [], 'Done when': [] }
  let current: string | null = null
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line.trim())
    if (heading && CARD_HEADS.includes(heading[1] as (typeof CARD_HEADS)[number])) {
      current = heading[1]!
      continue
    }
    if (!current || line.trim() === '') continue
    found[current]!.push(line.trim())
  }
  return {
    owns: found.Owns ?? [],
    may: found.May ?? [],
    mustAskBefore: found['Needs approval'] ?? [],
    doneWhen: found['Done when'] ?? [],
  }
}

function hasCycle(seats: OrgSeatRef[]): boolean {
  const parent = new Map(seats.map((seat) => [seat.slug, seat.reportsTo || '']))
  for (const seat of seats) {
    const seen = new Set<string>()
    let cursor: string | undefined = seat.slug
    while (cursor) {
      if (seen.has(cursor)) return true
      seen.add(cursor)
      cursor = parent.get(cursor) || ''
      if (!cursor) break
    }
  }
  return false
}

export function seatCounts(seats: Pick<SeatDocument, 'kind' | 'status'>[]): { people: number; bots: number } {
  const active = seats.filter((seat) => seat.status !== 'retired')
  return {
    people: active.filter((seat) => seat.kind === 'human').length,
    bots: active.filter((seat) => seat.kind === 'bot').length,
  }
}

export function profileFromOrg(org: OrgDocument, seats: Pick<SeatDocument, 'kind' | 'status'>[]): OrgProfile {
  const counts = seatCounts(seats)
  return {
    name: org.company.name,
    description: org.company.tagline ?? '',
    purpose: '',
    industry: org.company.industry ?? '',
    size: '',
    people: counts.people,
    bots: counts.bots,
  }
}

export function parseOrgProfile(source: string): { ok: true; profile: OrgProfile } | { ok: false; errors: string[] } {
  const text = normalizeText(source)
  if (!text.startsWith('---')) return { ok: false, errors: ['org.md: missing opening frontmatter.'] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: ['org.md: missing closing frontmatter.'] }
  const raw = rest.slice(0, close)
  const body = rest.slice(close).replace(/^\r?\n---\r?\n?/, '').replace(/\s+$/, '')
  const purpose = (body.startsWith('## ') ? '' : body.split(/\r?\n(?=## )/)[0] ?? '').trim()
  const data: Record<string, string> = {}
  const errors: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (!field) {
      errors.push(`org.md: cannot read frontmatter line: ${line}`)
      continue
    }
    data[field[1]!] = unquote(field[2] ?? '')
  }
  const name = data.name?.trim() ?? ''
  if (!name) errors.push('org.md: name is required.')
  const people = countField(data.people, 'people', errors)
  const bots = countField(data.bots, 'bots', errors)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    profile: {
      name,
      description: data.description?.trim() ?? '',
      purpose,
      industry: data.industry?.trim() ?? '',
      size: data.size?.trim() ?? '',
      people,
      bots,
    },
  }
}

export function serializeOrgProfile(profile: OrgProfile): string {
  const body = profile.purpose.trim()
  return [
    '---',
    `name: ${quote(profile.name.trim())}`,
    `description: ${quote(profile.description.trim())}`,
    `industry: ${quote(profile.industry.trim())}`,
    `size: ${quote(profile.size.trim())}`,
    `people: ${Math.max(0, Math.trunc(profile.people))}`,
    `bots: ${Math.max(0, Math.trunc(profile.bots))}`,
    '---',
    '',
    body,
    body ? '\n' : '',
  ].join('\n')
}

function countField(value: string | undefined, label: string, errors: string[]): number {
  if (value === undefined || value.trim() === '') return 0
  if (!/^\d+$/.test(value.trim())) {
    errors.push(`org.md: ${label} must be a whole number.`)
    return 0
  }
  return Number(value)
}

const BOT_STATUSES = new Set<BotRunStatus>(['active', 'paused', 'retired'])

function metricLines(seat: {
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  routines?: BotRoutine[]
  skills?: BotSkill[]
  instructions?: string
  publicUrl?: string
  botStatus?: BotRunStatus
  grokSync?: GrokSyncState
  grokSyncedAt?: string
  grokMissingSince?: string
  grokDeletedAt?: string
}): string[] {
  const lines: string[] = []
  if (seat.createdAt) lines.push(`createdAt: ${quote(seat.createdAt)}`)
  if (seat.lastActive) lines.push(`lastActive: ${quote(seat.lastActive)}`)
  if (seat.runs30d !== undefined) lines.push(`runs30d: ${seat.runs30d}`)
  if (seat.tasksDone30d !== undefined) lines.push(`tasksDone30d: ${seat.tasksDone30d}`)
  if (seat.botStatus) lines.push(`botStatus: ${seat.botStatus}`)
  if (seat.routines?.length) lines.push(`routines: ${quote(JSON.stringify(seat.routines))}`)
  if (seat.skills?.length) lines.push(`skills: ${quote(JSON.stringify(seat.skills))}`)
  if (seat.instructions?.trim()) lines.push(`instructions: ${quote(seat.instructions.trim())}`)
  if (seat.publicUrl) lines.push(`publicUrl: ${quote(seat.publicUrl)}`)
  if (seat.grokSync) lines.push(`grokSync: ${seat.grokSync}`)
  if (seat.grokSyncedAt) lines.push(`grokSyncedAt: ${quote(seat.grokSyncedAt)}`)
  if (seat.grokMissingSince) lines.push(`grokMissingSince: ${quote(seat.grokMissingSince)}`)
  if (seat.grokDeletedAt) lines.push(`grokDeletedAt: ${quote(seat.grokDeletedAt)}`)
  return lines
}

function readSyncFields(data: Record<string, string>): Pick<SeatDocument, 'grokSync' | 'grokSyncedAt' | 'grokMissingSince' | 'grokDeletedAt'> {
  const fields: Pick<SeatDocument, 'grokSync' | 'grokSyncedAt' | 'grokMissingSince' | 'grokDeletedAt'> = {}
  const state = data.grokSync?.trim() || ''
  if (GROK_SYNC_STATES.has(state as GrokSyncState)) fields.grokSync = state as GrokSyncState
  const syncedAt = data.grokSyncedAt?.trim() || ''
  if (syncedAt && !Number.isNaN(Date.parse(syncedAt))) fields.grokSyncedAt = syncedAt
  const missingSince = data.grokMissingSince?.trim() || ''
  if (missingSince && !Number.isNaN(Date.parse(missingSince))) fields.grokMissingSince = missingSince
  const deletedAt = data.grokDeletedAt?.trim() || ''
  if (deletedAt && !Number.isNaN(Date.parse(deletedAt))) fields.grokDeletedAt = deletedAt
  return fields
}

type BotFields = Pick<SeatDocument, 'createdAt' | 'lastActive' | 'runs30d' | 'tasksDone30d' | 'routines' | 'botStatus' | 'skills' | 'instructions' | 'publicUrl'>

function readBotMetrics(data: Record<string, string>): BotFields {
  const createdAt = data.createdAt?.trim() || ''
  const lastActive = data.lastActive?.trim() || ''
  const runs30d = readWholeNumber(data.runs30d)
  const tasksDone30d = readWholeNumber(data.tasksDone30d)
  const status = data.botStatus?.trim() || ''
  const metrics: BotFields = {}
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) metrics.createdAt = createdAt
  if (lastActive && !Number.isNaN(Date.parse(lastActive))) metrics.lastActive = lastActive
  if (runs30d !== undefined) metrics.runs30d = runs30d
  if (tasksDone30d !== undefined) metrics.tasksDone30d = tasksDone30d
  if (BOT_STATUSES.has(status as BotRunStatus)) metrics.botStatus = status as BotRunStatus
  const routines = readRoutineField(data.routines)
  if (routines.length) metrics.routines = routines
  const skills = readSkillField(data.skills)
  if (skills.length) metrics.skills = skills
  const instructions = (data.instructions ?? '').trim()
  if (instructions) metrics.instructions = instructions
  const link = publicLink(data.publicUrl)
  if (link) metrics.publicUrl = link
  return metrics
}

function readWholeNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (!/^\d+$/.test(value.trim())) return undefined
  return Number(value.trim())
}

function readRoutineField(value: string | undefined): BotRoutine[] {
  if (!value?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const routines: BotRoutine[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const schedule = typeof record.schedule === 'string' ? record.schedule.trim() : ''
    const lastRun = typeof record.lastRun === 'string' ? record.lastRun.trim() : ''
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    const routine: BotRoutine = { name, schedule }
    if (lastRun) routine.lastRun = lastRun
    if (description) routine.description = description
    routines.push(routine)
  }
  return routines
}

/** Skills as the seat file keeps them: a JSON list. A skill without a name, or a value that is not a list, is left out. */
function readSkillField(value: string | undefined): BotSkill[] {
  if (!value?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  return cleanSkills(parsed)
}

export function cleanSkills(value: unknown): BotSkill[] {
  if (!Array.isArray(value)) return []
  const skills: BotSkill[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    skills.push(description ? { name, description } : { name })
  }
  return skills
}

/** An https link, or '' for anything else. */
export function publicLink(value: unknown): string {
  const link = typeof value === 'string' ? value.trim() : ''
  return link.startsWith('https://') && isHttpUrl(link) ? link : ''
}

export function quote(value: string): string {
  if (value === '') return '""'
  // Control characters are JSON-encoded so a value can never start a new frontmatter line.
  if (/[:#"\u0000-\u001f\u007f]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) return JSON.stringify(value)
  return value
}

export function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return typeof parsed === 'string' ? parsed : trimmed
    } catch {
      return trimmed.replace(/^"|"$/g, '')
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}
