import { CONNECTOR_BOT_NAME } from './connector-prompt.ts'
import { scheduleFor } from './connector-timing.ts'
import { seatBots } from './connector-todo.ts'
import { nextCronRun } from './cron-next.ts'
import { linkedBotIds, type GrokData } from './grok-data.ts'
import type { BotRoutine, BotSkill, OrgBundle } from './org-files.ts'
import type { BoardBot, BoardRoutine, RoutineBoard } from './routine-board-types.ts'
import { latestProfileReports } from './profile-reports.ts'

export type { BoardBot, BoardRoutine, RoutineBoard, RoutineSource } from './routine-board-types.ts'

const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The skills the Connector's reading shows for a bot in this organization: the names on the "Skills to use" line of its
 * block, kept when the library has them, with the library's description. A name the library lacks was never saved, so it
 * is not in Grok Bot. Undefined when the description has no block for this organization.
 */
export function skillsInBlock(description: string, orgId: string, library: BotSkill[]): BotSkill[] | undefined {
  const start = new RegExp(`^=== BotsEverywhere [a-z0-9]+ ${orgId} ===\\r?$`, 'm').exec(description)
  if (!start) return undefined
  const rest = description.slice(start.index)
  const end = /^=== end BotsEverywhere [a-z0-9]+ [a-z0-9-]+ ===\r?$/m.exec(rest)
  const block = end ? rest.slice(0, end.index) : rest
  const line = /^Skills to use: (.*)$/m.exec(block)?.[1] ?? ''
  const named = line.split(',').map((name) => norm(name)).filter(Boolean)
  return library.filter((skill) => named.includes(norm(skill.name))).map((skill) => ({ name: skill.name, ...(skill.description ? { description: skill.description } : {}) }))
}

/**
 * The routines each bot runs in Grok Bot, for the Work Chart. Only a bot can read its own routines, so its own report wins;
 * without one, the Connector's reading of Grok Bot's files, which can be out of date; without that, nothing is known. The
 * Connector's own run comes from the app, which sets its interval and sees each run land.
 */
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
  const reports = latestProfileReports(input.confirmations)
  const found = input.data ? seatBots(input.bundle, input.data, linkedBotIds([input.bundle])).bots : new Map()
  const withNext = (routine: BotRoutine): BoardRoutine => {
    if (routine.enabled === false || routine.trigger !== 'schedule') return routine
    const next = nextCronRun(routine.schedule, routine.timeZone || input.timeZone, input.now)
    return next ? { ...routine, nextRun: next } : routine
  }
  const bots: BoardBot[] = []
  for (const seat of input.bundle.seats) {
    if (seat.kind !== 'bot' || seat.status === 'retired') continue
    let base: Pick<BoardBot, 'slug' | 'title' | 'reportedAt' | 'grokSkills'> = { slug: seat.slug, title: seat.title, reportedAt: '' }
    if (seat.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase())) {
      const run = input.connector
      const next = run && Number.isFinite(Date.parse(run.lastRun)) ? new Date(Date.parse(run.lastRun) + run.syncMinutes * 60_000).toISOString() : ''
      bots.push({ ...base, source: 'app', routines: run ? [{ name: 'BotsEverywhere sync', schedule: scheduleFor(run.syncMinutes), trigger: 'schedule', timeZone: input.timeZone, enabled: true, lastRun: run.lastRun, ...(next ? { nextRun: next } : {}) }] : [] })
      continue
    }
    const report = reports.get(`${input.orgId}|${seat.slug}`)
    // What Grok Bot holds for this bot, from the Connector's reading, whatever the bot itself reports.
    const inGrok = found.get(seat.slug)
    const grokSkills = inGrok && input.data ? skillsInBlock(inGrok.description ?? '', input.orgId, input.data.skills) : undefined
    if (grokSkills) base = { ...base, grokSkills }
    if (report) {
      bots.push({
        ...base,
        source: 'bot',
        reportedAt: report.at,
        routines: report.routines.map(withNext),
        ...(report.routineRuns30d !== undefined ? { routineRuns30d: report.routineRuns30d } : {}),
        ...(report.skills ? { skills: report.skills } : {}),
        ...(report.apps ? { apps: report.apps } : {}),
        ...(report.sends ? { sends: report.sends } : {}),
        ...(report.receives ? { receives: report.receives } : {}),
      })
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
