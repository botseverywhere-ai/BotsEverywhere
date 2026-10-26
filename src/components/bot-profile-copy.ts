import type { BotRoutine, RoutineStart } from '../../server/src/org-files.ts'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { grokSyncClass } from './sync-copy.ts'

/** Where a bot seat came from: hired from the directory, imported from Grok Bot, or added by hand with Add a seat. */
export type BotOrigin = 'directory' | 'imported' | 'manual'

export const IMPORTED_TITLE = 'Imported from Grok Bot'
export const IMPORTED_NOTE = 'This seat is not in the directory. It was imported from Grok Bot.'
export const INSTRUCTIONS_LABEL = 'Instructions for Grok Bot'
export const INSTRUCTIONS_PLACEHOLDER = 'What this bot should do, in your words…'

/** What Profile shows for one bot. Profile is how the bot works; the Seat card is its place in the organization. */
export interface ProfileParts {
  note: string
  /** none: Grok Bot owns the prompt. directory: the directory prompt, editable after hiring. instructions: typed by hand. */
  prompt: 'none' | 'directory' | 'instructions'
  /** Skills and routines can be added on every bot of your own; a Connector report merges into them. */
  listsEditable: boolean
  /** A bot added by hand and not in Grok Bot yet can be sent there from Profile. */
  addToGrok: boolean
}

export function profileParts(seat: { origin?: BotOrigin; grokSync?: 'new' | 'synced' | 'missing'; grokBotUrl?: string | null }): ProfileParts {
  if (seat.origin === 'imported') return { note: IMPORTED_NOTE, prompt: 'none', listsEditable: true, addToGrok: false }
  if (seat.origin === 'directory') return { note: '', prompt: 'directory', listsEditable: true, addToGrok: false }
  return { note: '', prompt: 'instructions', listsEditable: true, addToGrok: grokSyncClass({ grokSync: seat.grokSync, grokBotUrl: seat.grokBotUrl ?? '' }) !== 'is-in-grok' }
}

/** The prompt to store. An unedited directory prompt is not stored, so the directory stays its source. */
export function promptToSave(edited: string, directoryPrompt: string): string {
  const text = edited.trim()
  return text === directoryPrompt.trim() ? '' : text
}

/** Skill or routine rows as Profile saves them: trimmed, empty fields dropped, and a row without a name left out. */
export function draftRows<T extends { name: string }>(rows: T[]): T[] {
  return rows.flatMap((row) => {
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text) kept[key] = text
    }
    return kept.name ? [kept as unknown as T] : []
  })
}

/** The Starts choices, in the order Profile lists them. */
export const START_LABELS: Record<RoutineStart, string> = {
  schedule: 'Schedule',
  slack: 'Slack',
  github: 'GitHub',
  email: 'Email',
  webhook: 'Webhook',
  microsoftTeams: 'Microsoft Teams',
  linear: 'Linear',
  sentry: 'Sentry',
  pagerduty: 'PagerDuty',
  origin: 'Cursor Origin',
}

const START_PHRASES: Record<Exclude<RoutineStart, 'schedule'>, string> = {
  slack: 'On a Slack message',
  github: 'On a GitHub event',
  email: 'On an email',
  webhook: 'On a webhook call',
  microsoftTeams: 'On a Microsoft Teams message',
  linear: 'On a Linear issue',
  sentry: 'On a Sentry issue',
  pagerduty: 'On a PagerDuty incident',
  origin: 'On a Cursor Origin event',
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A five-field cron line in plain words. '' for anything that is not cron, like an older schedule in words. */
export function cronText(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5 || !parts.every((part) => /^[\d*/,-]+$/.test(part))) return ''
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string]
  const number = (value: string) => /^\d+$/.test(value)
  const step = (value: string) => /^\*\/(\d+)$/.exec(value)?.[1]
  if (month !== '*') return 'Custom schedule'
  const everyMinutes = step(minute)
  if (everyMinutes && hour === '*' && day === '*' && weekday === '*') return `Every ${everyMinutes} minutes`
  const everyHours = step(hour)
  if (number(minute) && everyHours && day === '*' && weekday === '*') return `Every ${everyHours} hours`
  if (number(minute) && hour === '*' && day === '*' && weekday === '*') return Number(minute) === 0 ? 'Every hour' : `Every hour at :${minute.padStart(2, '0')}`
  if (!number(minute) || !number(hour) || Number(minute) > 59 || Number(hour) > 23) return 'Custom schedule'
  const at = clock(Number(hour), Number(minute))
  if (day === '*' && weekday === '*') return `Every day at ${at}`
  if (day === '*') {
    const days = dayNames(weekday)
    return days ? `Every ${days} at ${at}` : 'Custom schedule'
  }
  if (number(day) && weekday === '*' && Number(day) >= 1 && Number(day) <= 31) return `On day ${Number(day)} of every month at ${at}`
  return 'Custom schedule'
}

function clock(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

function dayNames(field: string): string {
  if (field === '1-5') return 'weekday'
  const days: string[] = []
  for (const part of field.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part)
    const numbers = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, at) => Number(range[1]) + at) : /^\d$/.test(part) ? [Number(part)] : []
    if (!numbers.length || numbers.some((value) => value > 7)) return ''
    days.push(...numbers.map((value) => DAYS[value % 7]!))
  }
  if (days.length <= 2) return days.join(' and ')
  return `${days.slice(0, -1).join(', ')}, and ${days[days.length - 1]}`
}

/** Schedules offered under Presets, each labelled the way cronText reads it. */
export const CRON_PRESETS = ['0 9 * * 1-5', '0 9 * * *', '0 9 * * 1', '0 * * * *', '0 9 1 * *'].map((cron) => ({ cron, label: cronText(cron) }))

/** How a routine starts, in one line: the schedule in words and its time zone, or the event. */
export function startLine(routine: Pick<BotRoutine, 'schedule' | 'trigger' | 'event' | 'timeZone'>): string {
  if (!routine.trigger || routine.trigger === 'schedule') {
    // An older routine has no start; its schedule may be cron, which reads in words, or words already.
    const words = cronText(routine.schedule)
    return [words && words !== 'Custom schedule' ? words : routine.schedule, routine.timeZone].filter(Boolean).join(' · ')
  }
  return [START_PHRASES[routine.trigger], routine.event].filter(Boolean).join(' · ')
}

/**
 * Routines as Profile saves them: trimmed, a row without a name left out, and only what fits the start kept,
 * a schedule and time zone for a schedule, an event rule for an event. A paused routine keeps enabled: false.
 */
export function draftRoutines(rows: BotRoutine[]): BotRoutine[] {
  return rows.flatMap((row) => {
    const name = row.name.trim()
    if (!name) return []
    const onEvent = Boolean(row.trigger && row.trigger !== 'schedule')
    const routine: BotRoutine = { name, schedule: onEvent ? '' : row.schedule.trim() }
    const description = row.description?.trim()
    if (description) routine.description = description
    if (row.trigger) routine.trigger = row.trigger
    if (onEvent && row.event?.trim()) routine.event = row.event.trim()
    if (!onEvent && row.timeZone?.trim()) routine.timeZone = row.timeZone.trim()
    if (row.enabled === false) routine.enabled = false
    if (row.lastRun) routine.lastRun = row.lastRun
    return [routine]
  })
}

export const UPDATE_LABEL = 'Update bot'
export const UPDATE_HINT = "Sends these skills and routines to Grok Bot on the Connector's next run. Skills go to the library every bot shares."

/** Under the waiting mark once Update bot was clicked or the bot moved. With a count, the waiting changes are listed below it. */
export function updateWaitingLine(requestedAt: string, count = 0): string {
  if (!count) return `Asked ${formatShortDate(requestedAt)}. The Connector sends them on its next run.`
  return `Asked ${formatShortDate(requestedAt)}. The Connector sends these on its next run:`
}
