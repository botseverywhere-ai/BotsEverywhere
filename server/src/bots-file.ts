import { SEAT_SLUG, cleanSkills, isSeatGrokLink, publicLink, type BotRoutine, type BotRunStatus, type BotSkill, type SeatDocument } from './org-files.ts'

/** One bot from a bots file, after the field names are normalized. */
export interface BotsFileRow {
  name: string
  grokBotUrl: string
  /** Seat name. Missing values become "You". */
  reportsTo: string
  owns: string[]
  may: string[]
  needsApproval: string[]
  doneWhen: string[]
  createdAt: string
  lastActive: string
  runs30d?: number
  tasksDone30d?: number
  routines: BotRoutine[]
  /** Reusable workflows Grok Bot lists on the bot. */
  skills: BotSkill[]
  /** The bot's public share link, when it is public. '' otherwise. */
  publicUrl: string
  botStatus: '' | BotRunStatus
  /** Soft issues. The bot still imports. */
  note: string
  error: string
}

export const BOTS_FILE_TEMPLATE = `{
  "bots": [
    {
      "name": "Invoice Bot",
      "grokBotUrl": "",
      "reportsTo": "You",
      "owns": ["Match the invoice to the purchase order"],
      "may": ["Read the bill and the purchase order"],
      "needsApproval": ["Pay the vendor"],
      "doneWhen": "The match is recorded"
    },
    {
      "name": "Collections Bot",
      "reportsTo": "Invoice Bot",
      "owns": ["Chase the unpaid invoice"],
      "may": ["Read the open invoices"],
      "needsApproval": ["Send a legal notice"],
      "doneWhen": "The reminder is sent or the invoice is marked paid"
    }
  ]
}
`

/** Reads a bots file. A bad document fails the whole file. A bot fails only when it has no name. */
export function parseBotsFile(text: string): { ok: true; rows: BotsFileRow[] } | { ok: false; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['This file is not JSON.'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['The file must be a JSON object with a bots list.'] }
  }
  const bots = (parsed as { bots?: unknown }).bots
  if (!Array.isArray(bots)) return { ok: false, errors: ['The file needs a bots list.'] }
  if (bots.length === 0) return { ok: false, errors: ['Add at least one bot.'] }
  return { ok: true, rows: bots.map((entry, index) => readRow(entry, index)) }
}

function readRow(entry: unknown, index: number): BotsFileRow {
  const fallback = `Bot ${index + 1}`
  const blank: BotsFileRow = {
    name: fallback,
    grokBotUrl: '',
    reportsTo: 'You',
    owns: [],
    may: [],
    needsApproval: [],
    doneWhen: [],
    createdAt: '',
    lastActive: '',
    routines: [],
    skills: [],
    publicUrl: '',
    botStatus: '',
    note: '',
    error: '',
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ...blank, error: `${fallback} must be an object.` }
  }
  const record = entry as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  blank.name = name || fallback
  if (!name) {
    blank.error = 'Name is required.'
    return blank
  }
  const link = readLink(record.grokBotUrl)
  blank.grokBotUrl = link.link
  blank.note = link.note
  blank.reportsTo = managerName(record.reportsTo)
  blank.owns = stringList(record.owns)
  blank.may = stringList(record.may)
  blank.needsApproval = stringList(record.needsApproval)
  blank.doneWhen = doneWhenLines(record.doneWhen)
  const performance = readPerformance(record)
  blank.createdAt = performance.createdAt
  blank.lastActive = performance.lastActive
  blank.runs30d = performance.runs30d
  blank.tasksDone30d = performance.tasksDone30d
  blank.routines = performance.routines
  blank.botStatus = performance.botStatus
  blank.note = joinNotes(blank.note, performance.note)
  blank.skills = cleanSkills(record.skills)
  blank.publicUrl = publicLink(record.publicUrl)
  if (typeof record.publicUrl === 'string' && record.publicUrl.trim() && !blank.publicUrl) blank.note = joinNotes(blank.note, 'publicUrl was left out.')
  return blank
}

function joinNotes(current: string, extra: string): string {
  if (!extra) return current
  return current ? `${current} ${extra}` : extra
}

function readPerformance(record: Record<string, unknown>): {
  createdAt: string
  lastActive: string
  runs30d?: number
  tasksDone30d?: number
  routines: BotRoutine[]
  botStatus: '' | BotRunStatus
  note: string
} {
  const notes: string[] = []
  const created = readDate(record.createdAt, 'createdAt', true)
  const active = readDate(record.lastActive, 'lastActive', false)
  const runs = readCount(record.runs30d, 'runs30d')
  const tasks = readCount(record.tasksDone30d, 'tasksDone30d')
  const status = readBotStatus(record.status)
  const routines = readRoutines(record.routines)
  for (const note of [created.note, active.note, runs.note, tasks.note, status.note, routines.note]) {
    if (note) notes.push(note)
  }
  return {
    createdAt: created.value,
    lastActive: active.value,
    runs30d: runs.value,
    tasksDone30d: tasks.value,
    routines: routines.routines,
    botStatus: status.value,
    note: notes.join(' '),
  }
}

function readDate(value: unknown, field: string, dateOnly: boolean): { value: string; note: string } {
  if (value === undefined || value === null || value === '') return { value: '', note: '' }
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
    return { value: '', note: `${field} was left out.` }
  }
  const text = value.trim()
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: text, note: '' }
  return { value: new Date(text).toISOString(), note: '' }
}

function readCount(value: unknown, field: string): { value?: number; note: string } {
  if (value === undefined || value === null || value === '') return { note: '' }
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(text)) return { note: `${field} was left out.` }
  return { value: Number(text), note: '' }
}

function readBotStatus(value: unknown): { value: '' | BotRunStatus; note: string } {
  if (value === undefined || value === null || value === '') return { value: '', note: '' }
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === 'active' || text === 'paused' || text === 'retired') return { value: text, note: '' }
  return { value: '', note: 'status was left out.' }
}

function readRoutines(value: unknown): { routines: BotRoutine[]; note: string } {
  if (value === undefined || value === null || value === '') return { routines: [], note: '' }
  if (!Array.isArray(value)) return { routines: [], note: 'routines was left out.' }
  const routines: BotRoutine[] = []
  let skipped = 0
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      skipped += 1
      continue
    }
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) {
      skipped += 1
      continue
    }
    const scheduleValue = record.schedule ?? record.trigger
    const schedule = typeof scheduleValue === 'string' ? scheduleValue.trim() : scheduleValue === undefined || scheduleValue === null ? '' : ''
    if (scheduleValue !== undefined && scheduleValue !== null && scheduleValue !== '' && !schedule) skipped += 1
    const last = readDate(record.lastRun, 'lastRun', false)
    if (last.note) skipped += 1
    const routine: BotRoutine = { name, schedule }
    if (last.value) routine.lastRun = last.value
    routines.push(routine)
  }
  return { routines, note: skipped ? 'routines: some entries were left out.' : '' }
}

/** An http(s) URL or a grokbot:// app link. Anything else is dropped, with a note. */
function readLink(value: unknown): { link: string; note: string } {
  if (value === undefined || value === null) return { link: '', note: '' }
  if (typeof value !== 'string') return { link: '', note: 'grokBotUrl was left out.' }
  const link = value.trim()
  if (link === '') return { link: '', note: '' }
  if (isSeatGrokLink(link)) return { link, note: '' }
  return { link: '', note: 'grokBotUrl was left out.' }
}

function managerName(value: unknown): string {
  if (typeof value === 'string') return value.trim() || 'You'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'You'
}

/** A list, a single string, or bullet text. Missing values are an empty list. */
function stringList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value === 'string') return splitPieces(value)
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item))
  const text = JSON.stringify(value)
  return text ? [text] : []
}

function splitPieces(value: string): string[] {
  return value
    .split(/\r?\n|; /)
    .map((part) => part.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean)
}

/** One doneWhen string. A list is joined with a space. A number is kept as text. */
function doneWhenLines(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (typeof value === 'string') return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (Array.isArray(value)) {
    const joined = value.flatMap((item) => doneWhenLines(item)).join(' ').trim()
    return joined ? [joined] : []
  }
  const text = JSON.stringify(value)
  return text ? [text] : []
}

/** Finds the seat a bot reports to: You, an existing seat by title or slug, or another bot in the same file. */
export function resolveManager(
  reportsTo: string,
  ownName: string,
  existing: { slug: string; title: string }[],
  batch: Map<string, string>,
): { ok: true; slug: string; isNew: boolean } | { ok: false; error: string } {
  const name = reportsTo.trim() || 'You'
  if (name.toLowerCase() === ownName.trim().toLowerCase()) return { ok: false, error: `${ownName} cannot report to itself.` }
  if (name.toLowerCase() === 'you') {
    const titled = existing.find((seat) => seat.title.trim().toLowerCase() === 'you')
    const founder = titled ?? existing.find((seat) => seat.slug === 'you')
    if (!founder) return { ok: false, error: 'You is not a seat in this org.' }
    return { ok: true, slug: founder.slug, isNew: false }
  }
  const titled = existing.find((seat) => seat.title.trim().toLowerCase() === name.toLowerCase())
  if (titled) return { ok: true, slug: titled.slug, isNew: false }
  const batched = batch.get(name.toLowerCase())
  if (batched) return { ok: true, slug: batched, isNew: true }
  if (SEAT_SLUG.test(name) && existing.some((seat) => seat.slug === name)) {
    return { ok: true, slug: name, isNew: false }
  }
  return { ok: false, error: `${name} is not a seat in this org or in this file.` }
}

export interface BotsFileBot {
  name: string
  grokBotUrl?: string
  reportsTo: string
  owns: string[]
  may: string[]
  needsApproval: string[]
  doneWhen: string
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  routines?: { name: string; schedule: string; lastRun?: string }[]
  skills?: BotSkill[]
  publicUrl?: string
  status?: BotRunStatus
}

/** The same JSON Import bots file reads, built from seat files. Humans stay out. */
export function exportBotsFile(seats: SeatDocument[]): string {
  const bySlug = new Map(seats.map((seat) => [seat.slug, seat]))
  const bots = seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired').map((seat) => {
    const manager = seat.reportsTo ? bySlug.get(seat.reportsTo) : undefined
    const reportsTo = !manager || manager.kind === 'human' || manager.title.trim().toLowerCase() === 'you'
      ? 'You'
      : manager.title
    const link = readLink(seat.grokBotUrl).link || readLink(seat.addToGrokBotUrl).link
    const bot: BotsFileBot = {
      name: seat.title,
      reportsTo,
      owns: seat.owns,
      may: seat.may,
      needsApproval: seat.mustAskBefore,
      doneWhen: seat.doneWhen.join('\n'),
    }
    if (link) bot.grokBotUrl = link
    if (seat.createdAt) bot.createdAt = seat.createdAt
    if (seat.lastActive) bot.lastActive = seat.lastActive
    if (seat.runs30d !== undefined) bot.runs30d = seat.runs30d
    if (seat.tasksDone30d !== undefined) bot.tasksDone30d = seat.tasksDone30d
    if (seat.skills?.length) bot.skills = seat.skills
    if (seat.publicUrl) bot.publicUrl = seat.publicUrl
    if (seat.botStatus) bot.status = seat.botStatus
    if (seat.routines?.length) {
      bot.routines = seat.routines.map((routine) => {
        const item: { name: string; schedule: string; lastRun?: string } = { name: routine.name, schedule: routine.schedule }
        if (routine.lastRun) item.lastRun = routine.lastRun
        return item
      })
    }
    return bot
  })
  return `${JSON.stringify({ bots }, null, 2)}\n`
}
