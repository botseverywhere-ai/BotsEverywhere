import type { BotRoutine } from './org-files.ts'

/** What GET /api/orgs/<slug>/routines returns. Types only, so the browser can read them without the writer's code. */
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
