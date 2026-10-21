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
    return [{ seat, name: text(row.name) || seat, seatFile: text(row.seatFile), prompt: typeof row.prompt === 'string' ? row.prompt.trim() : '', ...(skills.length ? { skills } : {}), ...(routines.length ? { routines } : {}), ...(row.kind === 'update' ? { kind: 'update' as const } : {}), ...(text(row.grokBotUrl) ? { grokBotUrl: text(row.grokBotUrl) } : {}), requestedAt: text(row.requestedAt) }]
  })
  return { ok: true, requests }
}

export function serializeRequests(requests: GrokRequest[]): string {
  return `${JSON.stringify({ requests }, null, 2)}\n`
}

export function addRequest(requests: GrokRequest[], next: GrokRequest): GrokRequest[] {
  return [...requests.filter((item) => item.seat !== next.seat), next]
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
export function canDelete(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokBotUrl' | 'grokDeletedAt'>): boolean {
  return seat.kind === 'bot' && seat.status === 'retired' && Boolean(seat.grokBotUrl?.trim()) && !seat.grokDeletedAt
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
