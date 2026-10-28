import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { CONNECTOR_BOT_NAME } from '../../server/src/connector-prompt.ts'
import { scheduleFasterThanHourly, type ProcessFile } from '../../server/src/processes.ts'
import { latestStepStatus, type RunLine } from '../../server/src/run-log.ts'
import type { BoardRoutine, RoutineBoard, RoutineSource } from '../../server/src/routine-board-types.ts'
import { cronText } from './bot-profile-copy'

const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The routine a flow runs in Grok Bot: the one with the flow's name, owned by the bot on its first step. The Connector
 * has exactly one routine, which the app names itself, so its flow matches that one whatever the flow is called.
 */
export function laneRoutine(process: Pick<ProcessFile, 'name' | 'steps'>, board: RoutineBoard | null | undefined): { routine: BoardRoutine; source: RoutineSource } | null {
  const bot = board?.bots.find((item) => item.slug === process.steps[0]?.seat)
  const routine = bot?.source === 'app' && bot.routines.length === 1 ? bot.routines[0] : bot?.routines.find((item) => norm(item.name) === norm(process.name))
  return bot && routine ? { routine, source: bot.source } : null
}

/** The Work Chart's segments, and what each means, in the words the page shows. */
export const ROUTINES_HINT = 'Flows whose trigger is a schedule: a bot starts them on its own. The badge says whether its routine is on (Active) or off (Paused) in Grok Bot.'
export const HANDOFFS_HINT = "Flows whose trigger is someone handing work on, or an event like an email. Nothing runs on a timer, so there's no badge."
export const OFF_CHART_HINT = "These routines run in Grok Bot, but this Work Chart doesn't show their steps yet. Import processes from Grok Bot and each one becomes a flow with all its steps."
export const IDLE_HINT = 'Bots that do no step in any flow on this Work Chart yet.'

/** What Delete does, before it does it: it removes a flow here only. A routine keeps running in Grok Bot. */
export function deleteFlowText(process: Pick<ProcessFile, 'trigger'>): string {
  const grok = flowSegment(process) === 'routines'
    ? "Grok Bot doesn't change: the routine keeps running there and moves to Routines without a flow."
    : "Grok Bot doesn't change."
  return `This removes the flow from this Work Chart only. ${grok} Importing processes from Grok Bot again brings the flow back.`
}

/** What an import of Grok Bot's processes file did: flows new here, and flows it updated to Grok Bot's version. */
export function importSummary(imported: { replaced: boolean }[]): string {
  const updated = imported.filter((item) => item.replaced).length
  const fresh = imported.length - updated
  const noun = (count: number) => (count === 1 ? 'process' : 'processes')
  if (fresh && updated) return `Imported ${fresh} new ${noun(fresh)} and updated ${updated}`
  if (fresh) return `Imported ${fresh} new ${noun(fresh)}`
  if (updated) return `Updated ${updated} ${noun(updated)}`
  return 'Nothing imported'
}

/** Names the bots without work that still run routines with no flow, as one line; '' when none do. */
export function idleWithRoutines(idle: string[], offChart: { bot: string }[]): string {
  const names = idle.filter((title) => offChart.some((routine) => routine.bot === title))
  if (!names.length) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${list} still ${names.length === 1 ? 'runs' : 'run'} routines in Grok Bot, listed under Routines without a flow.`
}

/** A scheduled flow is a routine a bot starts on its own; a manual or event flow is a handoff. */
export function flowSegment(process: Pick<ProcessFile, 'trigger'>): 'routines' | 'handoffs' {
  return process.trigger.type === 'schedule' ? 'routines' : 'handoffs'
}

/**
 * Whether a routine flow is paused, or null for no badge. The bot's own report decides; without one, only the "(paused)"
 * mark Grok Bot's import writes at the end of a trigger's description. Nothing is guessed: Grok Bot's files still said
 * active for routines paused weeks earlier. A handoff runs on no timer, so it has no state.
 */
export function lanePaused(process: Pick<ProcessFile, 'trigger'>, live: ReturnType<typeof laneRoutine>): boolean | null {
  if (flowSegment(process) !== 'routines') return null
  if (live && (live.source === 'bot' || live.source === 'app')) return live.routine.enabled === false
  if (/\(paused\)\s*$/i.test(process.trigger.description)) return true
  return null
}

/** Why a routine flow has no badge, when nothing else on it says so. */
export function laneNoRoutine(process: Pick<ProcessFile, 'trigger'>, live: ReturnType<typeof laneRoutine>): string {
  if (lanePaused(process, live) !== null || flowSegment(process) !== 'routines' || live) return ''
  return "No badge yet: the bot hasn't reported a routine with this name."
}

/** A flow's runs: from the bot's own report, last and next; from Grok Bot's files only the last run, marked unconfirmed. */
export function laneWhen(live: ReturnType<typeof laneRoutine>): string {
  if (!live) return ''
  if (live.source !== 'files') return whenLine(live.routine)
  return live.routine.lastRun ? `Last run ${formatShortDate(live.routine.lastRun)} · not confirmed by the bot yet` : 'Not confirmed by the bot yet'
}

/** A schedule in words, with its time zone. A cron line stays as it is only when it has no words. */
export function scheduleWords(schedule: string, timeZone = ''): string {
  const words = cronText(schedule)
  return [words && words !== 'Custom schedule' ? words : schedule, timeZone].filter(Boolean).join(' · ')
}

/** When a routine last ran and runs next, on the same clock as Logs. A paused routine has no next run. */
export function whenLine(routine: Pick<BoardRoutine, 'enabled' | 'lastRun' | 'nextRun'>): string {
  const last = routine.lastRun ? `Last run ${formatShortDate(routine.lastRun)}` : ''
  if (routine.enabled === false) return last || 'Never run'
  return [last || 'Not run yet', routine.nextRun ? `Next run ${formatShortDate(routine.nextRun)}` : ''].filter(Boolean).join(' · ')
}

/**
 * What needs your attention in a flow, in plain words: a step with no seat, or whose seat is gone or retired; a last run
 * that failed; a schedule that runs more than once an hour. The Connector's own run is meant to run often.
 */
export function laneProblems(process: ProcessFile, seats: { slug: string; title: string; status: string }[], runLines: RunLine[]): string[] {
  const problems: string[] = []
  for (const step of process.steps) {
    const seat = seats.find((item) => item.slug === step.seat)
    if (!step.seat) problems.push('A step has no seat')
    else if (!seat) problems.push(`${step.seat} is not a seat in this organization`)
    else if (seat.status === 'retired') problems.push(`${seat.title} is retired`)
  }
  const failed = [...latestStepStatus(runLines, process.name, process.steps).values()].filter((line) => line.status === 'failed').map((line) => line.step)
  if (failed.length) problems.push(`The last run failed at: ${failed.join(', ')}`)
  const first = seats.find((item) => item.slug === process.steps[0]?.seat)
  const connector = Boolean(first?.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase()))
  if (process.trigger.type === 'schedule' && scheduleFasterThanHourly(process.trigger.schedule) && !connector) problems.push('Runs more than once an hour')
  return [...new Set(problems)]
}

/**
 * Routines this organization's bots run in Grok Bot that no flow describes yet: the routine, its bot, and its schedule in
 * words or the event that starts it. Paused only when the bot says so. The Connector's own run is not one.
 */
export function routinesOffChart(board: RoutineBoard | null | undefined, processes: Pick<ProcessFile, 'name'>[]): { bot: string; name: string; schedule: string; paused: boolean }[] {
  const names = new Set(processes.map((process) => norm(process.name)))
  return (board?.bots ?? [])
    .filter((bot) => bot.source === 'bot' || bot.source === 'files')
    .flatMap((bot) => bot.routines.filter((routine) => !names.has(norm(routine.name))).map((routine) => ({
      bot: bot.title,
      name: routine.name,
      schedule: routine.trigger === 'schedule' ? scheduleWords(routine.schedule, routine.timeZone) : routine.event || routine.schedule,
      paused: bot.source === 'bot' && routine.enabled === false,
    })))
}
