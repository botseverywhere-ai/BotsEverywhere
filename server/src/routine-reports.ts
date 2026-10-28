import { normalizeText } from './normalize-text.ts'
import type { BotRoutine } from './org-files.ts'

/**
 * A bot's own list of its routines. Grok Bot lets only a bot read its own routines, so each bot sends the Connector its
 * full list whenever one changes (its BotsEverywhere block says how), and the Connector keeps the message as it came, in
 * the confirmations of connector-results.json. The newest list for a seat is what Grok Bot runs for it.
 */
export const ROUTINES_HEADER = 'BotsEverywhere routines:'

/** The form a bot fills in: its organization and seat, one line per routine, or none. */
export function routineListForm(orgId: string, seat: string): string[] {
  return [
    `${ROUTINES_HEADER} ${orgId} | ${seat}`,
    '- <routine name> | <cron line, or the event that starts it> | <time zone> | active or paused | <last run in ISO 8601, or never>',
    'With no routines, send the first line and then: - none',
  ]
}

export interface RoutineReport {
  org: string
  seat: string
  at: string
  from: string
  routines: BotRoutine[]
}

const CRON = /^[\d*/,-]+(?: [\d*/,-]+){4}$/
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

/** One list, or null when the text has no header naming an organization and a seat. A line that does not read is skipped. */
export function parseRoutineReport(text: string, at = '', from = ''): RoutineReport | null {
  const lines = normalizeText(text).split('\n')
  const start = lines.findIndex((line) => line.includes(ROUTINES_HEADER))
  if (start < 0) return null
  const head = lines[start]!.slice(lines[start]!.indexOf(ROUTINES_HEADER) + ROUTINES_HEADER.length).split('|').map(collapse)
  if (head.length !== 2 || !head[0] || !head[1]) return null
  const routines: BotRoutine[] = []
  for (const line of lines.slice(start + 1).map((item) => item.trim())) {
    if (!line.startsWith('- ')) continue
    const parts = line.slice(2).split('|').map(collapse)
    if (parts.length !== 5 || !parts[0] || !parts[1] || !/^(active|paused)$/i.test(parts[3]!)) continue
    const [name, starts, zone, state, last] = parts as [string, string, string, string, string]
    routines.push({
      name,
      schedule: starts,
      ...(CRON.test(starts) ? { trigger: 'schedule' as const } : {}),
      ...(zone && zone !== '-' ? { timeZone: zone } : {}),
      enabled: /^active$/i.test(state),
      ...(Number.isFinite(Date.parse(last)) ? { lastRun: last } : {}),
    })
  }
  return { org: head[0], seat: head[1], at, from, routines }
}

/** The newest list for each seat, keyed `<org>|<seat>`. Later in the file wins a tie. */
export function latestRoutineReports(confirmations: { line: string; from: string; at: string }[]): Map<string, RoutineReport> {
  const latest = new Map<string, RoutineReport>()
  for (const item of confirmations) {
    const report = parseRoutineReport(item.line, item.at, item.from)
    if (!report) continue
    const key = `${report.org}|${report.seat}`
    const before = latest.get(key)
    if (before && (Date.parse(before.at) || 0) > (Date.parse(report.at) || 0)) continue
    latest.set(key, report)
  }
  return latest
}
