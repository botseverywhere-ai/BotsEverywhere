import { CONNECTOR_BOT_NAME, CONNECTOR_LOG_BOT } from './connector-prompt.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface MetricLogLine {
  date: string
  time: string
  bot: string
  /** `chat` when someone used the bot in a chat; otherwise the routine it ran. */
  process?: string
  /** What was asked or done. One chat logged twice (waiting, then done) keeps the same step. */
  step?: string
  status: string
}

/** The process name a bot writes for a chat, so chats and routine work are counted apart. */
export const CHAT_PROCESS = 'chat'
/** The process the app writes when a Connector report shows a bot became active and the bot logged nothing itself. */
export const GROK_ACTIVITY_PROCESS = 'grok-activity'

export interface ShownBotMetrics {
  createdAt: string
  /** ISO datetime. Empty when neither the import nor the live log has a time. */
  lastActive: string
  /** Times used: chats the bot logged. null when Grok Bot did not report it and the log adds nothing. */
  usage: number | null
  /** Automated tasks done: routine steps the bot logged as done. */
  tasks: number | null
}

/**
 * Times used and automated tasks done in the last 30 days, from the run log, plus any count Grok Bot reported.
 * A chat (process `chat`) is one use, counted once per day and step however many times it was logged, unless it only
 * says running. A `grok-activity` line, written when the Connector saw the bot become active, is one use. A done line
 * of any other process is one automated task. When Grok Bot reported counts, only lines after its report add to them;
 * otherwise every line counts.
 * A hire event is not a last-active time; this function never reads one.
 */
export function shownBotMetrics(input: {
  title: string
  slug: string
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  /** When the counts above were reported (the snapshot's syncedAt). Lines after it are not in them yet. */
  reportedAt?: string
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
  const inWindow = stamped.filter((item) => item.at >= windowStart && item.at <= now)
  // A reported count already holds everything up to its report, so only later lines add to it. The report time is the
  // cut; before the snapshot carried one, Grok Bot's last-active time stood in for it.
  const reportedAt = input.reportedAt ? Date.parse(input.reportedAt) : Number.NaN
  const cut = Number.isNaN(reportedAt) ? watermark : reportedAt
  const afterReport = Number.isNaN(cut) ? inWindow : inWindow.filter((item) => item.at > cut)
  const usageLines = input.runs30d === undefined ? inWindow : afterReport
  const taskLines = input.tasksDone30d === undefined ? inWindow : afterReport
  const process = (item: { line: MetricLogLine }) => (item.line.process ?? '').trim().toLowerCase()
  const chats = new Set(
    usageLines
      .filter((item) => process(item) === CHAT_PROCESS && item.line.status !== 'running')
      .map((item) => `${item.line.date}|${(item.line.step ?? '').trim().toLowerCase() || item.line.time}`),
  )
  const seen = usageLines.filter((item) => process(item) === GROK_ACTIVITY_PROCESS).length
  const done = taskLines.filter((item) => process(item) !== CHAT_PROCESS && process(item) !== GROK_ACTIVITY_PROCESS && item.line.status === 'done').length
  return {
    createdAt: input.createdAt || '',
    lastActive: last ? new Date(last).toISOString() : '',
    usage: combine(input.runs30d, chats.size + seen),
    tasks: combine(input.tasksDone30d, done),
  }
}

function combine(baseline: number | undefined, extra: number): number | null {
  if (baseline === undefined) return extra > 0 ? extra : null
  return baseline + extra
}

function matchesBot(bot: string, title: string, slug: string): boolean {
  const name = bot.trim().toLowerCase()
  const seat = title.trim().toLowerCase()
  if (name === seat || name === slug.trim().toLowerCase()) return true
  // The Connector signs its own lines with the short name, whatever its seat is called.
  return name === CONNECTOR_LOG_BOT.toLowerCase() && seat.startsWith(CONNECTOR_BOT_NAME.toLowerCase())
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
  // A date alone is read as midnight UTC, so it keeps its UTC day: the same day everywhere.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  // A moment shows in the time zone of the computer showing it, the same clock as Logs.
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`
}
