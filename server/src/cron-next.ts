/**
 * When a routine's cron line next fires, in its own IANA time zone. Grok Bot keeps routines as five-field cron lines with
 * a time zone; this walks the coming days on that zone's wall clock, so a change to or from summer time moves the run
 * with the clock, as it does in Grok Bot.
 */

const LIMITS: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
const DAYS_AHEAD = 8

/** The values a cron field allows, or null when it does not read. Day of week 7 is Sunday, like 0. */
function field(text: string, [low, high]: [number, number]): Set<number> | null {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match) return null
    const [from, to] = match[1] === '*' ? [low, high] : match[1]!.split('-').map(Number).concat(Number.NaN).slice(0, 2) as [number, number]
    const end = Number.isNaN(to) ? (match[2] ? high : from) : to
    const step = match[2] ? Number(match[2]) : 1
    if (from < low || end > high || from > end || step < 1) return null
    for (let value = from; value <= end; value += step) values.add(value)
  }
  return values
}

/** Milliseconds the zone is ahead of UTC at that moment. Throws for a zone that does not exist. */
function offset(timeZone: string, at: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at)).map((part) => [part.type, Number(part.value)]))
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - Math.floor(at / 1000) * 1000
}

/** The next time after `from` the cron line fires, as an ISO string, or '' when it is not a cron line, the zone is unknown, or it does not fire within eight days. */
export function nextCronRun(cron: string, timeZone: string, from: Date): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return ''
  const sets = parts.map((part, index) => field(part, LIMITS[index]!))
  if (sets.some((set) => !set)) return ''
  const [minutes, hours, days, months, weekdays] = sets as Set<number>[]
  if (weekdays!.has(7)) weekdays!.add(0)
  // Cron's rule: when both day fields are restricted, either one matching is enough.
  const anyDay = parts[2] === '*', anyWeekday = parts[4] === '*'
  try {
    const start = from.getTime()
    const local = new Date(start + offset(timeZone, start))
    const hourList = [...hours!].sort((a, b) => a - b)
    const minuteList = [...minutes!].sort((a, b) => a - b)
    for (let ahead = 0; ahead <= DAYS_AHEAD; ahead++) {
      const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead))
      if (!months!.has(day.getUTCMonth() + 1)) continue
      const dayMatch = days!.has(day.getUTCDate()), weekdayMatch = weekdays!.has(day.getUTCDay())
      if (!(anyDay && anyWeekday) && !(anyDay ? weekdayMatch : anyWeekday ? dayMatch : dayMatch || weekdayMatch)) continue
      for (const hour of hourList) {
        for (const minute of minuteList) {
          const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute)
          const at = wall - offset(timeZone, wall - offset(timeZone, wall))
          if (at > start) return new Date(at).toISOString()
        }
      }
    }
  } catch {
    return ''
  }
  return ''
}
