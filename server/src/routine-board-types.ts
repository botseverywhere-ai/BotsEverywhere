import type { BotRoutine, BotSkill } from './org-files.ts'

/** Work a bot regularly hands to someone, or gets from someone, as the bot itself reports it. */
export interface Handoff {
  /** The bot or person on the other end. */
  who: string
  what: string
  when?: string
}

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
  /** When the bot sent the profile shown, for a bot's own report. */
  reportedAt: string
  routines: BoardRoutine[]
  /** From the bot's own profile. Absent when it has not reported them. */
  skills?: BotSkill[]
  sends?: Handoff[]
  receives?: Handoff[]
}

export interface RoutineBoard {
  bots: BoardBot[]
}
