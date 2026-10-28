import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { CONNECTOR_BOT_NAME } from '../../server/src/connector-prompt.ts'
import { scheduleFasterThanHourly, type ProcessFile } from '../../server/src/processes.ts'
import { latestStepStatus, type RunLine } from '../../server/src/run-log.ts'
import type { BoardRoutine, RoutineBoard, RoutineSource } from '../../server/src/routine-board-types.ts'
import { cronText } from './bot-profile-copy'

const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** The routine a flow runs in Grok Bot: the one with the flow's name, owned by the bot on its first step. */
export function laneRoutine(process: Pick<ProcessFile, 'name' | 'steps'>, board: RoutineBoard | null | undefined): { routine: BoardRoutine; source: RoutineSource } | null {
  const bot = board?.bots.find((item) => item.slug === process.steps[0]?.seat)
  const routine = bot?.routines.find((item) => norm(item.name) === norm(process.name))
  return bot && routine ? { routine, source: bot.source } : null
}

/**
 * Whether a flow is paused. The bot's own report decides; without one, the "(paused)" mark Grok Bot's import writes at
 * the end of a trigger's description; without that, a routine is active. Grok Bot's files never decide: they still said
 * active for routines paused weeks earlier. A manual flow is not a routine, so it has no state: null.
 */
export function lanePaused(process: Pick<ProcessFile, 'trigger'>, live: ReturnType<typeof laneRoutine>): boolean | null {
  if (live && (live.source === 'bot' || live.source === 'app')) return live.routine.enabled === false
  if (/\(paused\)\s*$/i.test(process.trigger.description)) return true
  return process.trigger.type === 'manual' ? null : false
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

/** Routines bots report that have no flow on the Work Chart yet, as "Bot: routine". The Connector's own run is not one. */
export function routinesOffChart(board: RoutineBoard | null | undefined, processes: Pick<ProcessFile, 'name'>[]): string[] {
  const names = new Set(processes.map((process) => norm(process.name)))
  return (board?.bots ?? [])
    .filter((bot) => bot.source === 'bot' || bot.source === 'files')
    .flatMap((bot) => bot.routines.filter((routine) => !names.has(norm(routine.name))).map((routine) => `${bot.title}: ${routine.name}`))
}
