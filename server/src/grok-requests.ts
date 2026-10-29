import { normalizeText } from './normalize-text.ts'
import { SEAT_SLUG, cleanRoutines, cleanSkills, type BotRoutine, type BotSkill, type SeatDocument } from './org-files.ts'
import type { SyncPlan } from './grok-sync.ts'

/** The app writes this file; the Connector reads it and creates each bot in Grok Bot. */
export const REQUESTS_PATH = 'grok/requests.json'

export interface GrokRequest {
  /** Seat slug, so the next sync can clear the request. */
  seat: string
  /** The bot name to create. The sync matches the new bot by this name. */
  name: string
  /** Absolute path of the seat file: Owns, May, Needs approval, Done when. */
  seatFile: string
  /** The directory prompt text, or '' when the seat has none. Inline, because the Connector never reads outside the orgs folder. */
  prompt: string
  /** Skills from Profile, for the Connector to add to the new bot. */
  skills?: BotSkill[]
  /** Routines from Profile, for the Connector to create for the new bot. */
  routines?: BotRoutine[]
  /** update: the bot is already in Grok Bot; send it these skills and routines. Absent: create the bot. */
  kind?: 'update'
  /** For an update: the bot's Grok Bot link, so the Connector finds the right bot. */
  grokBotUrl?: string
  /** For an update: the name of the bot's new manager, for the Connector to tell the bot. */
  reportsTo?: string
  /** For an update: the manager Grok Bot knew before, so Sync and the logs say what changed. */
  previousReportsTo?: string
  /** For an update: the names of the bot's extra managers, set in the app. Empty when they were all taken away. */
  alsoReportsTo?: string[]
  requestedAt: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads the create requests. A `deletes` list an earlier version wrote is ignored and dropped on the next write. */
export function parseRequests(source: string): { ok: true; requests: GrokRequest[] } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(normalizeText(source))
  } catch {
    return { ok: false, error: 'grok/requests.json is not JSON.' }
  }
  const list = data && typeof data === 'object' ? (data as { requests?: unknown }).requests : undefined
  if (!Array.isArray(list)) return { ok: true, requests: [] }
  const requests = list.flatMap((item): GrokRequest[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const seat = text(row.seat)
    if (!SEAT_SLUG.test(seat)) return []
    const skills = cleanSkills(row.skills)
    const routines = cleanRoutines(row.routines)
    const also = Array.isArray(row.alsoReportsTo) ? row.alsoReportsTo.map(text).filter(Boolean) : null
    return [{ seat, name: text(row.name) || seat, seatFile: text(row.seatFile), prompt: typeof row.prompt === 'string' ? row.prompt.trim() : '', ...(skills.length ? { skills } : {}), ...(routines.length ? { routines } : {}), ...(row.kind === 'update' ? { kind: 'update' as const } : {}), ...(text(row.grokBotUrl) ? { grokBotUrl: text(row.grokBotUrl) } : {}), ...(text(row.reportsTo) ? { reportsTo: text(row.reportsTo) } : {}), ...(text(row.previousReportsTo) ? { previousReportsTo: text(row.previousReportsTo) } : {}), ...(also ? { alsoReportsTo: also } : {}), requestedAt: text(row.requestedAt) }]
  })
  return { ok: true, requests }
}

export function serializeRequests(requests: GrokRequest[]): string {
  return `${JSON.stringify({ requests }, null, 2)}\n`
}

export function addRequest(requests: GrokRequest[], next: GrokRequest): GrokRequest[] {
  return [...requests.filter((item) => item.seat !== next.seat), next]
}

/**
 * A new manager for a bot already in Grok Bot, joined to the update waiting for that bot. The manager Grok Bot knew stays
 * the first one, so moving the bot back leaves nothing to send about it. A bot waiting to be created is left alone: the
 * Connector creates it with the manager in its seat file.
 */
export function addManagerChange(requests: GrokRequest[], change: GrokRequest & { reportsTo: string; previousReportsTo: string }): GrokRequest[] {
  if (requests.some((item) => item.seat === change.seat && item.kind !== 'update')) return requests
  const waiting = requests.find((item) => item.seat === change.seat && item.kind === 'update')
  const known = waiting?.reportsTo ? waiting.previousReportsTo ?? '' : change.previousReportsTo
  const { reportsTo: _sent, previousReportsTo: _known, ...base } = waiting ?? change
  const others = requests.filter((item) => item.seat !== change.seat)
  if (change.reportsTo === known) {
    // Back to the manager Grok Bot has. Skills, routines, or extra managers still waiting still go.
    return base.skills?.length || base.routines?.length || base.alsoReportsTo ? [...others, { ...base, requestedAt: change.requestedAt }] : others
  }
  return [...others, { ...base, reportsTo: change.reportsTo, ...(known ? { previousReportsTo: known } : {}), requestedAt: change.requestedAt }]
}

/** New extra managers for a bot already in Grok Bot, joined to the update waiting for that bot. A bot waiting to be created is left alone. */
export function addAlsoChange(requests: GrokRequest[], change: GrokRequest & { alsoReportsTo: string[] }): GrokRequest[] {
  if (requests.some((item) => item.seat === change.seat && item.kind !== 'update')) return requests
  const waiting = requests.find((item) => item.seat === change.seat && item.kind === 'update')
  const others = requests.filter((item) => item.seat !== change.seat)
  return [...others, { ...(waiting ?? change), alsoReportsTo: change.alsoReportsTo, requestedAt: change.requestedAt }]
}

/** What a request sends, as log figures: its skills and routines by name, and the new manager. */
export function requestStats(request: Pick<GrokRequest, 'skills' | 'routines' | 'reportsTo' | 'previousReportsTo' | 'alsoReportsTo'>): string[] {
  const clean = (value: string) => value.replace(/\|/g, '/')
  const named = (items: { name: string }[] | undefined) => (items?.length ? `${items.length}: ${items.map((item) => clean(item.name)).join(', ')}` : '0')
  const stats: string[] = []
  if (request.skills?.length || request.routines?.length || (!request.reportsTo && !request.alsoReportsTo)) stats.push(`Skills=${named(request.skills)}`, `Routines=${named(request.routines)}`)
  if (request.reportsTo) stats.push(`Reports to=${clean(request.reportsTo)}`)
  if (request.reportsTo && request.previousReportsTo) stats.push(`Was=${clean(request.previousReportsTo)}`)
  if (request.alsoReportsTo) stats.push(`Also reports to=${request.alsoReportsTo.length ? request.alsoReportsTo.map(clean).join(', ') : 'none'}`)
  return stats
}

export function dropRequests(requests: GrokRequest[], seats: Set<string>): GrokRequest[] {
  return requests.filter((item) => !seats.has(item.seat))
}

/** Seats the snapshot matched, so Grok Bot has them. */
export function fulfilledSeats(plan: Pick<SyncPlan, 'rows'>): Set<string> {
  return new Set(plan.rows.flatMap((row) => (row.kind === 'updated' || row.kind === 'unchanged' ? [row.slug] : [])))
}

/** A bot already in Grok Bot can be sent its skills and routines: an active bot seat a sync saw or that carries a link. */
export function canUpdate(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokSync' | 'grokBotUrl'>): boolean {
  if (seat.kind !== 'bot' || seat.status === 'retired') return false
  return seat.grokSync === 'synced' || seat.grokSync === 'new' || Boolean(seat.grokBotUrl?.trim())
}

/** Only a bot seat with no Grok Bot link can be created. A link means the bot exists, even when a snapshot lacked it, so asking again would make a duplicate. */
export function canRequest(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokSync' | 'grokBotUrl'>): boolean {
  if (seat.kind !== 'bot' || seat.status === 'retired' || seat.grokBotUrl?.trim()) return false
  return seat.grokSync !== 'synced' && seat.grokSync !== 'new'
}

/**
 * A retired bot the person can still delete in Grok Bot: it has a link to open, and no Connector run has shown it gone.
 * Grok Bot gives the Connector no delete tool, so the person deletes it there; the app only notices it is gone.
 */
export function canDelete(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokBotUrl' | 'grokDeletedAt' | 'movedTo'>): boolean {
  // A bot that moved to another organization still works there: it is not to be deleted.
  return seat.kind === 'bot' && seat.status === 'retired' && Boolean(seat.grokBotUrl?.trim()) && !seat.grokDeletedAt && !seat.movedTo
}

/** A bot the Connector reported, from a snapshot or connector.json. */
export interface ReportedBot {
  name: string
  grokBotUrl: string
}

/**
 * Whether Grok Bot still has a bot. Strict: the link anywhere, or the same name with no link, counts as still there,
 * so a retired bot is never marked deleted before Grok Bot lost it.
 */
export function stillInGrok(bot: { grokBotUrl: string; name: string }, reported: ReportedBot[]): boolean {
  const name = bot.name.trim().toLowerCase()
  return reported.some((item) => {
    const link = item.grokBotUrl.trim()
    if (link) return link === bot.grokBotUrl.trim()
    const other = item.name.trim().toLowerCase()
    return other === name || other.startsWith(`${name} · `)
  })
}
