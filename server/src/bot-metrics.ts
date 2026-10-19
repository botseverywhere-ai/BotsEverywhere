const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface MetricLogLine {
  date: string
  time: string
  bot: string
  status: string
}

export interface ShownBotMetrics {
  createdAt: string
  /** ISO datetime. Empty when neither the import nor the live log has a time. */
  lastActive: string
  /** null when Grok Bot did not report it and the log adds nothing. */
  usage: number | null
  tasks: number | null
}

/**
 * Imported baseline plus live log lines after that snapshot.
 * A hire event is not a last-active time; this function never reads one.
 */
export function shownBotMetrics(input: {
  title: string
  slug: string
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  log: MetricLogLine[]
  now?: number
}): ShownBotMetrics {
  const now = input.now ?? Date.now()
  const windowStart = now - WINDOW_MS
  const watermark = input.lastActive ? Date.parse(input.lastActive) : Number.NaN
  const mine = input.log.filter((line) => matchesBot(line.bot, input.title, input.slug))
  const stamped = mine
    .map((line) => ({ line, at: logInstant(line) }))
    .filter((item) => item.at > 0)
  const newest = stamped.reduce((max, item) => Math.max(max, item.at), 0)
  const importedAt = Number.isNaN(watermark) ? 0 : watermark
  const last = Math.max(importedAt, newest)
  const fresh = stamped.filter((item) => {
    if (item.at < windowStart || item.at > now) return false
    if (!Number.isNaN(watermark)) return item.at > watermark
    return input.runs30d === undefined && input.tasksDone30d === undefined
  })
  return {
    createdAt: input.createdAt || '',
    lastActive: last ? new Date(last).toISOString() : '',
    usage: combine(input.runs30d, fresh.length),
    tasks: combine(input.tasksDone30d, fresh.filter((item) => item.line.status === 'done').length),
  }
}

function combine(baseline: number | undefined, extra: number): number | null {
  if (baseline === undefined) return extra > 0 ? extra : null
  return baseline + extra
}

function matchesBot(bot: string, title: string, slug: string): boolean {
  const name = bot.trim().toLowerCase()
  return name === title.trim().toLowerCase() || name === slug.trim().toLowerCase()
}

/** Run-log lines carry the wall-clock time of this computer, so they are read in local time. */
function logInstant(line: MetricLogLine): number {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(line.date.trim())
  const clock = /^(\d{1,2}):(\d{2})$/.exec(line.time.trim())
  if (!day || !clock) return Number.NaN
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2])).getTime()
}

/** 17 Oct 2026, or 17 Oct 2026, 19:32 when a time is present. UTC, so the text is stable. */
export function formatShortDate(iso: string): string {
  const text = iso.trim()
  const date = new Date(text)
  if (!text || Number.isNaN(date.getTime())) return '—'
  const day = date.getUTCDate()
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${day} ${month} ${year}`
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year}, ${hours}:${minutes}`
}
