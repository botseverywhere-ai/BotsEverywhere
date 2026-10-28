import { normalizeText } from './normalize-text.ts'
import type { BotRoutine, BotSkill } from './org-files.ts'
import type { AppUse, Handoff } from './routine-board-types.ts'

/**
 * A bot's own profile: its routines, the private skills turned on for it, and the work it regularly hands on or gets.
 * Grok Bot lets only a bot see these for itself, so each bot sends its full profile to the Connector whenever it changes
 * (its BotsEverywhere block says how), and the Connector keeps the message as it came, in the confirmations of
 * connector-results.json. The newest profile for a seat is what that bot has in Grok Bot.
 */
export const PROFILE_HEADER = 'BotsEverywhere profile:'
/** The routines-only form asked for before profiles. Still read, so a list sent that way is not lost. */
const ROUTINES_HEADER = 'BotsEverywhere routines:'

/** The form a bot fills in. */
export function profileForm(orgId: string, seat: string): string[] {
  return [
    `${PROFILE_HEADER} ${orgId} | ${seat}`,
    'Routines:',
    '- <routine name> | <cron line, or the event that starts it> | <time zone> | active or paused | <last run in ISO 8601, or never> | <times it ran in the last 30 days, from its Run history>',
    'Skills:',
    '- <private skill turned on for you, not a built-in one> | <what it does, in one line>',
    'Apps used:',
    '- <app connected to the account that you use> | <what you use it for>',
    'Sends:',
    '- <bot or person you hand work to> | <what you send> | <when>',
    'Receives:',
    '- <bot or person who hands you work> | <what you get> | <when>',
    'Under a heading with nothing in it, write: - none',
  ]
}

export interface ProfileReport {
  org: string
  seat: string
  at: string
  from: string
  routines: BotRoutine[]
  /** Times its routines ran in the last 30 days, from its Run history when it reported. Absent unless every routine gave a count. */
  routineRuns30d?: number
  /** Absent when the bot did not report this heading: unknown, not none. */
  skills?: BotSkill[]
  apps?: AppUse[]
  sends?: Handoff[]
  receives?: Handoff[]
}

type Section = 'routines' | 'skills' | 'apps' | 'sends' | 'receives'

const CRON = /^[\d*/,-]+(?: [\d*/,-]+){4}$/
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

function routineFrom(parts: string[]): BotRoutine | null {
  // A sixth part is the run count, read apart; the earlier form had five.
  if ((parts.length !== 5 && parts.length !== 6) || !parts[0] || !parts[1] || !/^(active|paused)$/i.test(parts[3]!)) return null
  const [name, starts, zone, state, last] = parts as [string, string, string, string, string]
  return {
    name,
    schedule: starts,
    ...(CRON.test(starts) ? { trigger: 'schedule' as const } : {}),
    ...(zone && zone !== '-' ? { timeZone: zone } : {}),
    enabled: /^active$/i.test(state),
    ...(Number.isFinite(Date.parse(last)) ? { lastRun: last } : {}),
  }
}

function handoffFrom(parts: string[]): Handoff | null {
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) return null
  return { who: parts[0], what: parts[1], ...(parts[2] ? { when: parts[2] } : {}) }
}

/** One profile, or null when the text has no header naming an organization and a seat. A line that does not read is skipped. */
export function parseProfileReport(text: string, at = '', from = ''): ProfileReport | null {
  const lines = normalizeText(text).split('\n')
  const start = lines.findIndex((line) => line.includes(PROFILE_HEADER) || line.includes(ROUTINES_HEADER))
  if (start < 0) return null
  const header = lines[start]!
  const older = !header.includes(PROFILE_HEADER)
  const marker = older ? ROUTINES_HEADER : PROFILE_HEADER
  const head = header.slice(header.indexOf(marker) + marker.length).split('|').map(collapse)
  if (head.length !== 2 || !head[0] || !head[1]) return null
  const report: ProfileReport = { org: head[0], seat: head[1], at, from, routines: [] }
  // The earlier form had no headings: every line in it is a routine.
  let section: Section | null = older ? 'routines' : null
  let listed = older
  let ran = 0
  let uncounted = false
  for (const line of lines.slice(start + 1).map((item) => item.trim())) {
    const named = older ? undefined : /^(routines|skills|apps used|sends|receives):?$/i.exec(line)?.[1]?.toLowerCase()
    const heading = (named === 'apps used' ? 'apps' : named) as Section | undefined
    if (heading) {
      section = heading
      if (heading === 'routines') listed = true
      if (heading === 'skills') report.skills = report.skills ?? []
      else if (heading === 'apps') report.apps = report.apps ?? []
      else if (heading !== 'routines') report[heading] = report[heading] ?? []
      continue
    }
    if (!section || !line.startsWith('- ')) continue
    const parts = line.slice(2).split('|').map(collapse)
    if (parts.length === 1 && /^none$/i.test(parts[0]!)) continue
    if (section === 'routines') {
      const routine = routineFrom(parts)
      if (routine) {
        report.routines.push(routine)
        if (/^\d+$/.test(parts[5] ?? '')) ran += Number(parts[5])
        else uncounted = true
      }
    } else if (section === 'skills') {
      if (parts[0] && parts.length <= 2) report.skills!.push({ name: parts[0], ...(parts[1] ? { description: parts[1] } : {}) })
    } else if (section === 'apps') {
      if (parts[0] && parts.length <= 2) report.apps!.push({ name: parts[0], ...(parts[1] ? { use: parts[1] } : {}) })
    } else {
      const handoff = handoffFrom(parts)
      if (handoff) report[section]!.push(handoff)
    }
  }
  if (listed && !uncounted) report.routineRuns30d = ran
  return report
}

/** The newest profile for each seat, keyed `<org>|<seat>`. Later in the file wins a tie. */
export function latestProfileReports(confirmations: { line: string; from: string; at: string }[]): Map<string, ProfileReport> {
  const latest = new Map<string, ProfileReport>()
  for (const item of confirmations) {
    const report = parseProfileReport(item.line, item.at, item.from)
    if (!report) continue
    const key = `${report.org}|${report.seat}`
    const before = latest.get(key)
    if (before && (Date.parse(before.at) || 0) > (Date.parse(report.at) || 0)) continue
    latest.set(key, report)
  }
  return latest
}
