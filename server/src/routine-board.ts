import { CONNECTOR_BOT_NAME } from './connector-prompt.ts'
import { scheduleFor } from './connector-timing.ts'
import { seatBots } from './connector-todo.ts'
import { nextCronRun } from './cron-next.ts'
import { linkedBotIds, type GrokData } from './grok-data.ts'
import type { BotRoutine, OrgBundle } from './org-files.ts'
import { latestRoutineReports } from './routine-reports.ts'

/**
 * The routines each bot runs in Grok Bot, for the Work Chart. Only a bot can read its own routines, so its own report wins;
 * without one, the Connector's reading of Grok Bot's files, which can be out of date; without that, nothing is known. The
 * Connector's own run comes from the app, which sets its interval and sees each run land.
 */
export type RoutineSource = 'bot' | 'files' | 'none' | 'app'

export interface BoardRoutine extends BotRoutine {
  /** When it runs next, for an active schedule. Absent for a paused routine or one that starts on an event. */
  nextRun?: string
}

export interface BoardBot {
  slug: string
  title: string
  source: RoutineSource
  /** When the bot sent the list shown, for a bot's own report. */
  reportedAt: string
  routines: BoardRoutine[]
}

export interface RoutineBoard {
  bots: BoardBot[]
}

export function routineBoard(input: {
  orgId: string
  bundle: OrgBundle
  data: GrokData | null
  confirmations: { line: string; from: string; at: string }[]
  /** The Connector's last run and interval, or null before its first run. */
  connector: { lastRun: string; syncMinutes: number } | null
  /** This computer's time zone, for a routine that names none. */
  timeZone: string
  now: Date
}): RoutineBoard {
  const reports = latestRoutineReports(input.confirmations)
  const found = input.data ? seatBots(input.bundle, input.data, linkedBotIds([input.bundle])).bots : new Map()
  const withNext = (routine: BotRoutine): BoardRoutine => {
    if (routine.enabled === false || routine.trigger !== 'schedule') return routine
    const next = nextCronRun(routine.schedule, routine.timeZone || input.timeZone, input.now)
    return next ? { ...routine, nextRun: next } : routine
  }
  const bots: BoardBot[] = []
  for (const seat of input.bundle.seats) {
    if (seat.kind !== 'bot' || seat.status === 'retired') continue
    const base = { slug: seat.slug, title: seat.title, reportedAt: '' }
    if (seat.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase())) {
      const run = input.connector
      const next = run && Number.isFinite(Date.parse(run.lastRun)) ? new Date(Date.parse(run.lastRun) + run.syncMinutes * 60_000).toISOString() : ''
      bots.push({ ...base, source: 'app', routines: run ? [{ name: 'BotsEverywhere sync', schedule: scheduleFor(run.syncMinutes), trigger: 'schedule', timeZone: input.timeZone, enabled: true, lastRun: run.lastRun, ...(next ? { nextRun: next } : {}) }] : [] })
      continue
    }
    const report = reports.get(`${input.orgId}|${seat.slug}`)
    if (report) {
      bots.push({ ...base, source: 'bot', reportedAt: report.at, routines: report.routines.map(withNext) })
      continue
    }
    const bot = found.get(seat.slug)
    if (bot?.routinesVisible) {
      bots.push({ ...base, source: 'files', routines: (bot.routines ?? []).map(withNext) })
      continue
    }
    bots.push({ ...base, source: 'none', routines: [] })
  }
  return { bots: bots.sort((a, b) => a.title.localeCompare(b.title)) }
}
