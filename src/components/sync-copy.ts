import { formatShortDate } from '../../server/src/bot-metrics.ts'
import type { ProjectInfo, SyncPlan, SyncRow, SyncStatus } from '../../server/src/grok-sync.ts'
import { canRequest, fulfilledSeats, type GrokDelete, type GrokRequest } from '../../server/src/grok-requests.ts'
import type { FileActivity, SeatDocument } from '../../server/src/org-files.ts'
import type { NoticeInput } from '../live/notices.ts'

/** Changes to apply first; otherwise how many bots Grok Bot still lacks. Only the number. */
export function syncButtonLabel(writes: number, missing = 0): string {
  const count = writes > 0 ? writes : missing
  return count > 0 ? `Sync with Grok Bot · ${count}` : 'Sync with Grok Bot'
}

/** One line per preview row: the name, then what the sync would do. */
export function rowLine(row: SyncRow): string {
  switch (row.kind) {
    case 'new':
      return `${row.name} → new seat, reports to ${row.bot.reportsTo}${row.note ? `. ${row.note}` : ''}`
    case 'updated':
      return `${row.name} → ${row.changes.join(', ')}`
    case 'missing':
      return row.write ? `${row.name} → not found in Grok Bot` : `${row.name} → still not found`
    case 'new-process':
      return `${row.name} → new process`
    case 'schedule':
      return `${row.name} → Grok Bot runs it "${row.routine}", the process says "${row.process}"`
    case 'skipped':
      return `${row.name} → ${row.error}`
    case 'unchanged':
      return `${row.name} → unchanged`
  }
}

export function statusLine(status: Pick<SyncStatus, 'snapshot' | 'error' | 'lastConfirmed'>, slug: string): string {
  if (status.error) return `The snapshot could not be read: ${status.error}`
  if (!status.snapshot) return `No snapshot yet. The Connector writes orgs/${slug}/grok/snapshot.json on each run.`
  const confirmed = status.lastConfirmed ? ` Last confirmed ${formatShortDate(status.lastConfirmed)}.` : ' Not confirmed yet.'
  return `Snapshot from ${formatShortDate(status.snapshot.syncedAt)}.${confirmed}`
}

type SyncSeat = { grokSync?: 'new' | 'synced' | 'missing'; grokSyncedAt?: string; grokMissingSince?: string; grokBotUrl?: string | null }

/** A seat with a Grok Bot link was imported from Grok Bot, so it counts as there until a snapshot lacks it. */
function linked(seat: Pick<SyncSeat, 'grokBotUrl'>): boolean {
  return Boolean(seat.grokBotUrl && seat.grokBotUrl.trim())
}

/**
 * Tag on the org-chart card. "Not in Grok Bot" is a fact from a snapshot that lacked the bot.
 * A bot no sync has stamped yet is unknown, so it says so instead of claiming absence.
 */
export function grokSyncTag(seat: Pick<SyncSeat, 'grokSync' | 'grokBotUrl'>): string {
  if (seat.grokSync === 'new') return 'New in Grok Bot'
  if (seat.grokSync === 'synced') return 'In Grok Bot'
  if (seat.grokSync === 'missing') return 'Not in Grok Bot'
  return linked(seat) ? 'In Grok Bot' : 'Not synced yet'
}

/** Card state: green when Grok Bot runs this bot or linked to it, dashed when a snapshot lacked it, muted when nothing is known. */
export function grokSyncClass(seat: Pick<SyncSeat, 'grokSync' | 'grokBotUrl'>): 'is-in-grok' | 'is-off-grok' | 'is-unsynced' {
  if (seat.grokSync === 'new' || seat.grokSync === 'synced') return 'is-in-grok'
  if (seat.grokSync === 'missing') return 'is-off-grok'
  return linked(seat) ? 'is-in-grok' : 'is-unsynced'
}

/** Numbers beside the org chart legend. Open seats are not counted; a bot nothing is known about is in neither Grok Bot count. */
export function legendCounts(
  seats: ({ id: string; type: 'human' | 'bot' | 'system' } & Pick<SyncSeat, 'grokSync' | 'grokBotUrl'>)[],
  emptyIds: readonly string[] = [],
): { human: number; bot: number; system: number; inGrok: number; offGrok: number } {
  const counts = { human: 0, bot: 0, system: 0, inGrok: 0, offGrok: 0 }
  for (const seat of seats) {
    if (emptyIds.includes(seat.id)) continue
    counts[seat.type] += 1
    if (seat.type !== 'bot') continue
    const state = grokSyncClass(seat)
    if (state === 'is-in-grok') counts.inGrok += 1
    if (state === 'is-off-grok') counts.offGrok += 1
  }
  return counts
}

export function retiredKindLabel(kind: SeatDocument['kind']): string {
  if (kind === 'human') return 'Human'
  return kind === 'system' ? 'System' : 'Bot'
}

/** A retired bot's line in the Retired list: deleted, waiting for the owner to delete it, or still in Grok Bot. */
export function retiredGrokLine(seat: Pick<SeatDocument, 'grokBotUrl' | 'grokDeletedAt'>, waiting?: Pick<GrokDelete, 'requestedAt'>): string {
  if (seat.grokDeletedAt) return `Deleted from Grok Bot on ${formatShortDate(seat.grokDeletedAt)}`
  if (waiting) return 'Waiting for you to delete it in Grok Bot. This updates on the Connector\'s next run.'
  if (!seat.grokBotUrl?.trim()) return 'No Grok Bot link, so the app cannot tell when it is gone'
  return 'Still in Grok Bot'
}

/** Which way a logged change went. Sync events written before the field existed came from Grok Bot. */
export function grokDirection(event: Pick<FileActivity, 'id' | 'grok'>): 'in' | 'out' | undefined {
  if (event.grok) return event.grok
  return event.id.startsWith('sync-') ? 'in' : undefined
}

export function grokDirectionLabel(direction: 'in' | 'out'): string {
  return direction === 'in' ? 'From Grok Bot' : 'To Grok Bot'
}

/**
 * Bots Grok Bot lacks: already asked for (waiting for the Connector), or ready to send.
 * Ready means a bot the snapshot lacked, or any active bot seat with no link and no sync stamp,
 * so a template copy or a hand-built org can send its bots before any snapshot exists.
 */
export function outgoing(plan: Pick<SyncPlan, 'rows'> | null, requests: GrokRequest[] = [], seats: SeatDocument[] = []): {
  waiting: { slug: string; name: string; requestedAt: string }[]
  ready: { slug: string; name: string }[]
} {
  const asked = new Map(requests.map((item) => [item.seat, item]))
  const waiting = requests.map((item) => ({ slug: item.seat, name: item.name, requestedAt: item.requestedAt }))
  const matched = plan ? fulfilledSeats(plan) : new Set<string>()
  const ready: { slug: string; name: string }[] = []
  const seen = new Set<string>()
  const add = (slug: string, name: string) => {
    if (asked.has(slug) || matched.has(slug) || seen.has(slug)) return
    seen.add(slug)
    ready.push({ slug, name })
  }
  const bySlug = new Map(seats.map((seat) => [seat.slug, seat]))
  for (const row of plan?.rows ?? []) {
    const seat = bySlug.get(row.kind === 'missing' ? row.slug : '')
    if (row.kind === 'missing' && (!seat || canRequest(seat))) add(row.slug, row.name)
  }
  for (const seat of seats) if (canRequest(seat)) add(seat.slug, seat.title)
  return { waiting, ready }
}

export { CONNECTOR_STALE_MINUTES } from '../../server/src/connector-timing.ts'
import { DEFAULT_SYNC_MINUTES, everyLabel, staleMinutes } from '../../server/src/connector-timing.ts'

const KIND_LABELS: Record<string, string> = {
  connected: 'Connected',
  stopped: 'Stopped',
  'connector-run': 'Connector',
  'connector-error': 'Error',
  'bot-connected': 'Bot connected',
  'bot-disconnected': 'Bot left',
  sync: 'Sync',
  request: 'Request',
  created: 'Created',
  deleted: 'Deleted',
  added: 'Added',
}

const TYPE_LABELS: Record<string, string> = { hire: 'Hire', fire: 'Retired', edit: 'Edit', work: 'Work', approval: 'Approval', exception: 'Exception' }

/** The word in front of a log line. Older lines have no kind, so their id says what they were. */
export function logLabel(event: Pick<FileActivity, 'id' | 'type' | 'kind'>): string {
  if (event.kind && KIND_LABELS[event.kind]) return KIND_LABELS[event.kind]!
  if (event.id.startsWith('sync-adopt-')) return 'Added'
  if (event.id.startsWith('sync-')) return 'Sync'
  if (event.id.startsWith('grok-request-')) return 'Request'
  if (event.id.startsWith('grok-created-')) return 'Created'
  return TYPE_LABELS[event.type] ?? event.type
}

/** Anything the Connector or Grok Bot did, or the app sent to it. */
export function isGrokEvent(event: Pick<FileActivity, 'id' | 'kind' | 'grok'>): boolean {
  return Boolean(event.grok) || Boolean(event.kind && KIND_LABELS[event.kind]) || event.id.startsWith('sync-') || event.id.startsWith('grok-')
}

/** One log event's figures, from `Label=value|Label=value`. A piece without `=` is dropped. */
export function parseStats(text: string | undefined): [string, string][] {
  if (!text) return []
  return text.split('|').flatMap((piece) => {
    const at = piece.indexOf('=')
    if (at <= 0) return []
    const label = piece.slice(0, at).trim()
    const value = piece.slice(at + 1).trim()
    return label && value ? [[label, value] as [string, string]] : []
  })
}

export type ConnectorState = 'checking' | 'connected' | 'stale' | 'never' | 'broken' | 'unknown'

/** When the snapshot file was last written: its modified time from the stamp, else the date inside it. */
function lastRunAt(snapshot: { stamp: string; syncedAt: string }): number {
  const written = Number(snapshot.stamp.split(':')[0])
  if (snapshot.stamp && Number.isFinite(written) && written > 0) return written
  const dated = Date.parse(snapshot.syncedAt)
  return Number.isNaN(dated) ? NaN : dated
}

function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `on ${formatShortDate(new Date(ms).toISOString())}`
}

/** Whether the Connector is writing to this org folder. The app only knows from grok/snapshot.json. */
export function connectorState(
  status: Pick<SyncStatus, 'snapshot' | 'error' | 'project'> | null,
  now = Date.now(),
  syncMinutes = runMinutes(status?.project),
): { state: ConnectorState; line: string } {
  if (!status) return { state: 'checking', line: 'Checking the Connector…' }
  // The project Connector writes orgs/connector.json every run. An older per-org Connector only writes the org snapshot.
  const project = status.project?.connector
  if (project) return connectorState({ snapshot: { stamp: project.stamp, syncedAt: project.syncedAt }, error: project.error }, now, syncMinutes)
  if (!status.snapshot) {
    if (status.error) return { state: 'unknown', line: `Connector status unknown · ${status.error}` }
    if (status.project) return { state: 'never', line: 'Not connected · no Connector has written to this project yet' }
    return { state: 'never', line: 'Not connected · the Connector has never written to this folder' }
  }
  const ran = lastRunAt(status.snapshot)
  if (Number.isNaN(ran)) return { state: 'broken', line: `The Connector's snapshot could not be read: ${status.error || 'it has no date.'}` }
  if (status.error) return { state: 'broken', line: `Connector ran ${ago(ran, now)}, but its snapshot could not be read: ${status.error}` }
  if (now - ran > staleMinutes(syncMinutes) * 60_000) return { state: 'stale', line: `Connector stopped · last run ${ago(ran, now)}` }
  return { state: 'connected', line: `Connected · last run ${ago(ran, now)}` }
}

/** How often the Connector really runs: what it reports, else what was saved. Disconnected is judged by this. */
export function runMinutes(project: Pick<ProjectInfo, 'syncMinutes' | 'connector'> | undefined): number {
  return project?.connector?.syncMinutes ?? project?.syncMinutes ?? DEFAULT_SYNC_MINUTES
}

/**
 * Whether Grok Bot runs the Connector at the saved interval. The app can only change the prompt, so a saved
 * interval that was never pasted shows here. Empty when they match or no Connector has run.
 */
export function intervalWarning(project: Pick<ProjectInfo, 'syncMinutes' | 'connector'> | undefined): string {
  if (!project?.connector || project.connector.error) return ''
  const saved = project.syncMinutes ?? DEFAULT_SYNC_MINUTES
  const reported = project.connector.syncMinutes
  if (reported === undefined) return 'Grok Bot has not said how often it runs the Connector yet. Paste the prompt from Connect bots into the Connector once.'
  if (reported !== saved) return `Grok Bot still runs the Connector every ${everyLabel(reported)}, not every ${everyLabel(saved)}. Copy the prompt on Connect bots and paste it into the Connector.`
  return ''
}

const DETAIL_TITLES: Record<ConnectorState, string> = {
  checking: 'Checking the Connector',
  connected: 'Connected to Grok Bot',
  stale: 'Connector stopped',
  never: 'Not connected',
  broken: 'Connector error',
  unknown: 'File writer off',
}

/** The header dropdown: a title, one sentence, and the facts beside their labels. */
export function connectorDetails(status: Pick<SyncStatus, 'snapshot' | 'error' | 'project'> | null, now = Date.now()): { state: ConnectorState; title: string; note: string; facts: [string, string][]; warning: string } {
  const { state, line } = connectorState(status, now)
  const minutes = runMinutes(status?.project)
  const ran = connectorRanAt(status)
  const note = state === 'connected'
    ? `The Connector syncs your organizations with Grok Bot every ${everyLabel(minutes)}.`
    : state === 'stale'
      ? `It missed two runs. Check in Grok Bot that the Connector still exists and runs every ${everyLabel(minutes)}.`
      : `${line}.`
  const facts: [string, string][] = [['Runs every', everyLabel(minutes)]]
  if (ran !== undefined) {
    facts.push(['Last sync', `${lastRunShort(ran, now)}, ${ago(ran, now)}`])
    if (state === 'connected') facts.push(['Next sync', `around ${lastRunShort(ran + minutes * 60_000, now)}`])
  }
  return { state, title: DETAIL_TITLES[state], note, facts, warning: intervalWarning(status?.project) }
}

/** When the Connector last ran, from the same file connectorState reads. Undefined when nothing says. */
export function connectorRanAt(status: Pick<SyncStatus, 'snapshot' | 'project'> | null): number | undefined {
  const project = status?.project?.connector
  const source = project ? { stamp: project.stamp, syncedAt: project.syncedAt } : status?.snapshot
  if (!source) return undefined
  const ran = lastRunAt(source)
  return Number.isNaN(ran) ? undefined : ran
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The Connector's last run under the header badge, in local time: 15:01 today, else 19 Oct, 18:25. */
export function lastRunShort(ran: number, now = Date.now()): string {
  const date = new Date(ran)
  if (Number.isNaN(date.getTime())) return ''
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return date.toDateString() === new Date(now).toDateString() ? time : `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}, ${time}`
}

/** The one word in the header badge, above "Grok Bot". Empty while loading. */
export function headerBadgeLabel(state: ConnectorState): string {
  if (state === 'connected') return 'Connected'
  if (state === 'stale') return 'Disconnected'
  if (state === 'never') return 'Not connected'
  if (state === 'broken') return 'Error'
  if (state === 'unknown') return 'Writer off'
  return ''
}

/**
 * The alert card for a change in the Connector's state, or null when nothing changed.
 * The first state seen, and anything to or from checking, is not a change.
 */
export function connectorChangeNotice(before: ConnectorState | null, after: ConnectorState, name: string, slug: string): NoticeInput | null {
  if (!before || before === 'checking' || after === 'checking' || before === after) return null
  const setUp = { label: 'Set up the Connector', href: `#/org/${slug}/connect-bots` }
  if (after === 'connected') {
    const again = before === 'stale' || before === 'broken' || before === 'unknown'
    return { kind: 'ok', live: true, message: `Connected to Grok Bot${again ? ' again' : ''}. ${name} just ran.`, link: { label: 'Review the sync', openSync: slug } }
  }
  if (after === 'stale') return { kind: 'warn', live: true, message: `${name} stopped. It missed its last two runs. Check it in Grok Bot.`, link: setUp }
  if (after === 'broken') return { kind: 'bad', live: true, message: `${name} wrote a file the app cannot read. Your organization keeps working.`, link: setUp }
  if (after === 'unknown') return { kind: 'bad', live: true, message: 'The file writer stopped answering. Restart npm run dev.' }
  return { kind: 'warn', live: true, message: 'Grok Bot is no longer connected to this folder.', link: setUp }
}

/** Not an official Grok Bot number; the count we recommend staying under per account. */
export const GROK_BOT_LIMIT = 50

const LIMIT_NOTE = `Grok Bot limits how many bots one account can have. We recommend up to ${GROK_BOT_LIMIT}.`

export function overBotLimit(bots: number, adding = 0): boolean {
  return bots + adding > GROK_BOT_LIMIT
}

/** The note in the Sync drawer and on Add a seat; it names the count once it passes the limit. */
export function botLimitLine(bots: number, adding = 0, scope: 'organization' | 'project' = 'organization'): string {
  if (!overBotLimit(bots, adding)) return LIMIT_NOTE
  if (adding > 0) return `This would make ${bots + adding} bots. ${LIMIT_NOTE}`
  return scope === 'project' ? `The organizations in this folder have ${bots} bots. ${LIMIT_NOTE}` : `This organization has ${bots} bots. ${LIMIT_NOTE}`
}

export function activeBotCount(seats: Pick<SeatDocument, 'kind' | 'status'>[]): number {
  return seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired').length
}

/** Under Create in Grok Bot once the request is written. */
export function grokRequestLine(requestedAt: string): string {
  return `Asked the Connector on ${formatShortDate(requestedAt)}. It creates this bot on its next run, then Sync with Grok Bot links it.`
}

/** The Grok Bot line on the seat drawer's Performance tab. */
export function grokSyncLine(seat: SyncSeat): string {
  if (seat.grokSync === 'synced') return `synced ${formatShortDate(seat.grokSyncedAt ?? '')}`
  if (seat.grokSync === 'new') return `new since ${formatShortDate(seat.grokSyncedAt ?? '')}`
  if (seat.grokSync === 'missing') return `not found since ${formatShortDate(seat.grokMissingSince ?? '')}`
  return 'not synced yet'
}
