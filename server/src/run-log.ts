import { deriveSteps, type ProcessFile, type SeatRef } from './processes.ts'
import { normalizeText } from './normalize-text.ts'

export const RUN_STATUSES = ['done', 'failed', 'skipped', 'waiting', 'running'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export interface RunLine {
  date: string
  time: string
  bot: string
  process: string
  step: string
  status: RunStatus
  note: string
  index: number
}

const STATUS_SET = new Set<string>(RUN_STATUSES)

/** Read one daily run log. Bad lines are skipped and counted. The header is not a line. */
export function parseRunLog(source: string, date: string): { lines: RunLine[]; skipped: number } {
  const lines: RunLine[] = []
  let skipped = 0
  for (const raw of normalizeText(source).split('\n')) {
    const text = raw.trim()
    if (!text || text.startsWith('#')) continue
    const body = text.startsWith('- ') ? text.slice(2) : text.replace(/^-/, '').trim()
    const parts = body.split(' | ')
    if (parts.length !== 6) {
      skipped += 1
      continue
    }
    const time = (parts[0] ?? '').trim()
    const bot = (parts[1] ?? '').trim()
    const process = (parts[2] ?? '').trim()
    const step = (parts[3] ?? '').trim()
    const status = (parts[4] ?? '').trim()
    const note = (parts[5] ?? '').trim() || '-'
    const clock = /^(\d{1,2}):(\d{2})$/.exec(time)
    if (!clock || !STATUS_SET.has(status) || !bot || !process || !step) {
      skipped += 1
      continue
    }
    lines.push({
      date,
      time: `${clock[1]!.padStart(2, '0')}:${clock[2]}`,
      bot,
      process,
      step,
      status: status as RunStatus,
      note,
      index: lines.length,
    })
  }
  return { lines, skipped }
}

export function formatRunLine(line: Pick<RunLine, 'time' | 'bot' | 'process' | 'step' | 'status' | 'note'>): string {
  return `- ${line.time} | ${line.bot} | ${line.process} | ${line.step} | ${line.status} | ${line.note || '-'}`
}

export function runLogHeader(date: string): string {
  return `# Run log ${date}`
}

export function isRunLogName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.md$/.test(name)
}

/** Newest first. Same minute keeps file order, later lines first. */
export function newestFirst(lines: RunLine[]): RunLine[] {
  return [...lines].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.index - a.index)
}

export function activitySentence(line: RunLine): string {
  const note = line.note && line.note !== '-' ? ` ${line.note}` : ''
  if (line.status === 'waiting') return `${line.time} ${line.bot} ${line.step}${note}, waiting for your approval`
  if (line.status === 'failed') return `${line.time} ${line.bot} ${line.step}${note}, failed`
  if (line.status === 'skipped') return `${line.time} ${line.bot} skipped ${line.step}${note}`
  if (line.status === 'running') return `${line.time} ${line.bot} started ${line.step}${note}`
  return `${line.time} ${line.bot} ${line.step}${note}`
}

export function linesForCurrentRun(lines: RunLine[], processName: string, firstAction: string): RunLine[] {
  const mine = lines.filter((line) => line.process.trim().toLowerCase() === processName.trim().toLowerCase())
  let start = 0
  const first = firstAction.trim().toLowerCase()
  mine.forEach((line, index) => {
    if (line.step.trim().toLowerCase() === first && line.status === 'running') start = index
  })
  return mine.slice(start)
}

export function latestStepStatus(lines: RunLine[], processName: string, steps: { action: string }[]): Map<string, RunLine> {
  const current = linesForCurrentRun(lines, processName, steps[0]?.action ?? '')
  const map = new Map<string, RunLine>()
  for (const line of current) map.set(line.step.trim().toLowerCase(), line)
  return map
}

export function waitingLines(lines: RunLine[], processes: { name: string; steps: { action: string }[] }[]): RunLine[] {
  const waiting: RunLine[] = []
  for (const process of processes) {
    for (const line of latestStepStatus(lines, process.name, process.steps).values()) {
      if (line.status === 'waiting') waiting.push(line)
    }
  }
  return newestFirst(waiting)
}

export interface SeatLive {
  running: boolean
  reporting: boolean
  last: string
}

export function liveSeats(lines: RunLine[], seats: { slug: string; title: string; reportsTo: string }[]): Map<string, SeatLive> {
  const bySeat = new Map<string, RunLine>()
  for (const line of lines) {
    const seat = matchBot(line.bot, seats)
    if (!seat) continue
    const prev = bySeat.get(seat.slug)
    if (!prev || line.date > prev.date || (line.date === prev.date && (line.time > prev.time || (line.time === prev.time && line.index > prev.index)))) {
      bySeat.set(seat.slug, line)
    }
  }
  let reporter = ''
  let reporterKey = ''
  for (const [slug, line] of bySeat) {
    if (line.status !== 'done' && line.status !== 'waiting') continue
    const seat = seats.find((item) => item.slug === slug)
    if (!seat?.reportsTo) continue
    const key = `${line.date} ${line.time} ${String(line.index).padStart(6, '0')}`
    if (key >= reporterKey) {
      reporterKey = key
      reporter = slug
    }
  }
  const live = new Map<string, SeatLive>()
  for (const [slug, line] of bySeat) {
    live.set(slug, { running: line.status === 'running', reporting: slug === reporter, last: line.time })
  }
  return live
}

function matchBot(bot: string, seats: { slug: string; title: string }[]): { slug: string } | undefined {
  const text = bot.trim().toLowerCase()
  if (!text) return undefined
  return seats.find((seat) => seat.title.trim().toLowerCase() === text) ?? seats.find((seat) => seat.slug === text)
}

export function planRun(process: ProcessFile, seats: SeatRef[], now = new Date()): RunLine[] {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const derived = deriveSteps(process.steps, seats)
  const lines: RunLine[] = []
  let cursor = new Date(now)
  const push = (action: string, seatSlug: string, status: RunStatus) => {
    const seat = seats.find((item) => item.slug === seatSlug)
    lines.push({
      date,
      time: `${pad(cursor.getHours())}:${pad(cursor.getMinutes())}`,
      bot: seat?.title || seatSlug || 'Unassigned',
      process: process.name,
      step: action || 'step',
      status,
      note: '-',
      index: lines.length,
    })
    cursor = new Date(cursor.getTime() + 60_000)
  }
  for (const step of derived) {
    push(step.action, step.seat, 'running')
    if (step.checkpoint) {
      push(step.action, step.seat, 'waiting')
      break
    }
    push(step.action, step.seat, 'done')
  }
  return lines
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
