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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

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
    return [{ seat, name: text(row.name) || seat, seatFile: text(row.seatFile), promptFile: text(row.promptFile), requestedAt: text(row.requestedAt) }]
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

/** Same rule as the card tag: a snapshot that lacked the bot wins over a link; a link alone counts as in Grok Bot. */
export function canRequest(seat: Pick<SeatDocument, 'kind' | 'status' | 'grokSync' | 'grokBotUrl'>): boolean {
  if (seat.kind !== 'bot' || seat.status === 'retired') return false
  if (seat.grokSync === 'missing') return true
  return !seat.grokSync && !seat.grokBotUrl?.trim()
}
