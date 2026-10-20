import { normalizeText } from './normalize-text.ts'
import { SEAT_SLUG, type SeatDocument } from './org-files.ts'
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
  /** Absolute path of the directory prompt, or '' when the seat has none. */
  promptFile: string
  requestedAt: string
}

/** A bot the app asked the Connector to delete in Grok Bot. Found by its link, never by name alone. */
export interface GrokDelete {
  /** The bot's Grok Bot link. One request per link. */
  grokBotUrl: string
  /** The bot's name, for the log and for a Connector entry that has no link. */
  name: string
  /** Seats in this org that hold the link, so each one can be marked once Grok Bot loses the bot. */
  seats: string[]
  requestedAt: string
}

export interface RequestsFile {
  requests: GrokRequest[]
  deletes: GrokDelete[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseRequests(source: string): ({ ok: true } & RequestsFile) | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(normalizeText(source))
  } catch {
    return { ok: false, error: 'grok/requests.json is not JSON.' }
  }
  const list = data && typeof data === 'object' ? (data as { requests?: unknown }).requests : undefined
  const requests = (Array.isArray(list) ? list : []).flatMap((item): GrokRequest[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const seat = text(row.seat)
    if (!SEAT_SLUG.test(seat)) return []
    return [{ seat, name: text(row.name) || seat, seatFile: text(row.seatFile), promptFile: text(row.promptFile), requestedAt: text(row.requestedAt) }]
  })
  // Deletes sit under their own key, so a Connector on an older prompt never reads one as a create.
  const removals = data && typeof data === 'object' ? (data as { deletes?: unknown }).deletes : undefined
  const deletes = (Array.isArray(removals) ? removals : []).flatMap((item): GrokDelete[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const grokBotUrl = text(row.grokBotUrl)
    if (!grokBotUrl) return []
    const seats = Array.isArray(row.seats) ? row.seats.map(text).filter((seat) => SEAT_SLUG.test(seat)) : []
    return [{ grokBotUrl, name: text(row.name) || grokBotUrl, seats, requestedAt: text(row.requestedAt) }]
  })
  return { ok: true, requests, deletes }
}

/** Writes `deletes` only when there is one, so a file of create requests reads as before. */
export function serializeRequests(requests: GrokRequest[], deletes: GrokDelete[] = []): string {
  return `${JSON.stringify(deletes.length ? { requests, deletes } : { requests }, null, 2)}\n`
}

export function addRequest(requests: GrokRequest[], next: GrokRequest): GrokRequest[] {
  return [...requests.filter((item) => item.seat !== next.seat), next]
}

export function addDelete(deletes: GrokDelete[], next: GrokDelete): GrokDelete[] {
  return [...deletes.filter((item) => item.grokBotUrl !== next.grokBotUrl), next]
}

/** The waiting delete that covers this seat, by seat or by its link. */
export function deleteFor(deletes: GrokDelete[], seat: Pick<SeatDocument, 'slug' | 'grokBotUrl'>): GrokDelete | undefined {
  const link = seat.grokBotUrl?.trim() ?? ''
  return deletes.find((item) => item.seats.includes(seat.slug) || (link !== '' && item.grokBotUrl === link))
}

export function dropRequests(requests: GrokRequest[], seats: Set<string>): GrokRequest[] {
  return requests.filter((item) => !seats.has(item.seat))
}

/** Seats the snapshot matched, so Grok Bot has them. */
export function fulfilledSeats(plan: Pick<SyncPlan, 'rows'>): Set<string> {
  return new Set(plan.rows.flatMap((row) => (row.kind === 'updated' || row.kind === 'unchanged' ? [row.slug] : [])))
}

/** Only a bot seat with no Grok Bot link can be created. A link means the bot exists, even when a snapshot lacked it, so asking again would make a duplicate. */
export function canRequest(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokSync' | 'grokBotUrl'>): boolean {
  if (seat.kind !== 'bot' || seat.status === 'retired' || seat.grokBotUrl?.trim()) return false
  return seat.grokSync !== 'synced' && seat.grokSync !== 'new'
}

/** Only a retired bot with a Grok Bot link can be deleted there. The link is how the Connector finds the right bot. */
export function canDelete(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokBotUrl' | 'grokDeletedAt'>): boolean {
  return seat.kind === 'bot' && seat.status === 'retired' && Boolean(seat.grokBotUrl?.trim()) && !seat.grokDeletedAt
}

/** A bot the Connector reported, from a snapshot or connector.json. */
export interface ReportedBot {
  name: string
  grokBotUrl: string
}

/**
 * Whether Grok Bot still has the bot of a delete request. Strict: the link anywhere, or the same name
 * with no link, counts as still there, so a request never clears before Grok Bot lost the bot.
 */
export function stillInGrok(request: Pick<GrokDelete, 'grokBotUrl' | 'name'>, reported: ReportedBot[]): boolean {
  const name = request.name.trim().toLowerCase()
  return reported.some((bot) => {
    const link = bot.grokBotUrl.trim()
    if (link) return link === request.grokBotUrl
    const other = bot.name.trim().toLowerCase()
    return other === name || other.startsWith(`${name} · `)
  })
}
