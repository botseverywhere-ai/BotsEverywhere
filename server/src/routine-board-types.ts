import type { BotRoutine, BotSkill } from './org-files.ts'

/** An app connected to the account that a bot says it uses, and what for. */
export interface AppUse {
  name: string
  use?: string
}

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
  /** Times its routines ran in the 30 days before reportedAt, as the bot counted them. Absent when it gave no count. */
  routineRuns30d?: number
  /** From the bot's own profile. Absent when it has not reported them. */
  skills?: BotSkill[]
  /**
   * The skills in Grok Bot for this bot, from the Connector's reading: the names on the "Skills to use" line of its block
   * for this organization that are saved in the library, each with the library's description. Absent until the dump
   * shows that block.
   */
  grokSkills?: BotSkill[]
  apps?: AppUse[]
  sends?: Handoff[]
  receives?: Handoff[]
}

export interface RoutineBoard {
  bots: BoardBot[]
}
