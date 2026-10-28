import { formatShortDate } from '../../server/src/bot-metrics.ts'
import type { BoardBot, BoardRoutine, RoutineBoard } from '../../server/src/routine-board-types.ts'

/** Routines in Grok Bot on the Work Chart: bots with routines one by one, the rest named in two short lines. */
export function boardGroups(board: RoutineBoard): { withRoutines: BoardBot[]; noRoutines: string[]; waiting: string[] } {
  return {
    withRoutines: board.bots.filter((bot) => bot.routines.length),
    noRoutines: board.bots.filter((bot) => !bot.routines.length && (bot.source === 'bot' || bot.source === 'files')).map((bot) => bot.title),
    waiting: board.bots.filter((bot) => !bot.routines.length && (bot.source === 'none' || bot.source === 'app')).map((bot) => bot.title),
  }
}

/** Where a bot's routines come from. Only the bot can read its own; Grok Bot's files can be out of date. */
export function sourceLine(bot: Pick<BoardBot, 'source' | 'reportedAt'>): string {
  if (bot.source === 'bot') return `Reported by the bot ${formatShortDate(bot.reportedAt)}`
  if (bot.source === 'files') return "From Grok Bot's files · may be out of date"
  if (bot.source === 'app') return 'Set by BotsEverywhere'
  return 'Not reported yet'
}

/** When a routine last ran and runs next, on the same clock as Logs. A paused routine has no next run. */
export function whenLine(routine: Pick<BoardRoutine, 'enabled' | 'lastRun' | 'nextRun'>): string {
  if (routine.enabled === false) return `Paused · ${routine.lastRun ? `last run ${formatShortDate(routine.lastRun)}` : 'never run'}`
  return [routine.lastRun ? `Last run ${formatShortDate(routine.lastRun)}` : 'Not run yet', routine.nextRun ? `Next run ${formatShortDate(routine.nextRun)}` : ''].filter(Boolean).join(' · ')
}
