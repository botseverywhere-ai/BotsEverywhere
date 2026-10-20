import { parseBotsFile, resolveManager, type BotsFileRow } from './bots-file.ts'
import { formatShortDate } from './bot-metrics.ts'
import { normalizeText } from './normalize-text.ts'
import { parseSeatMarkdown, serializeSeat, type BotRoutine, type BotRunStatus, type GrokSyncState, type SeatDocument } from './org-files.ts'
import { parseProcessesFile, processSlug, type ProcessFile, type ProcessImportRow } from './processes.ts'
import type { GrokDelete, GrokRequest } from './grok-requests.ts'

/** What the Connector writes to grok/snapshot.json, after parsing. */
export interface Snapshot {
  syncedAt: string
  bots: BotsFileRow[]
  processes: ProcessImportRow[]
}

/** Fields a confirmed sync writes onto one seat file. Structure is never in here. */
export interface SeatPatch {
  title?: string
  role?: string
  grokBotUrl?: string
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  routines?: BotRoutine[]
  botStatus?: BotRunStatus
  owns?: string[]
  may?: string[]
  mustAskBefore?: string[]
  doneWhen?: string[]
  grokSync: GrokSyncState
  grokSyncedAt?: string
  /** null clears the field. */
  grokMissingSince?: string | null
}

export type SyncRow =
  | { kind: 'new'; name: string; bot: BotsFileRow; note: string }
  | { kind: 'updated'; name: string; slug: string; renamed: boolean; changes: string[]; patch: SeatPatch }
  | { kind: 'unchanged'; name: string; slug: string }
  | { kind: 'missing'; name: string; slug: string; write: boolean; patch: SeatPatch }
  | { kind: 'new-process'; name: string; row: ProcessImportRow }
  | { kind: 'schedule'; name: string; slug: string; process: string; routine: string }
  | { kind: 'skipped'; name: string; error: string }

export interface SyncCounts {
  new: number
  missing: number
  updated: number
  processes: number
  warnings: number
  unchanged: number
}

export interface SyncPlan {
  syncedAt: string
  rows: SyncRow[]
  counts: SyncCounts
  /** Rows that write a file when confirmed. */
  writes: number
}

/** What GET /api/orgs/<slug>/sync returns. */
export interface SyncStatus {
  snapshot: { stamp: string; syncedAt: string } | null
  error: string
  plan: SyncPlan | null
  lastConfirmed: string
  /** Absolute path of the org folder on this computer, so prompts can name it. Empty when the writer did not say. */
  folder: string
  /** Bots the app asked the Connector to create in Grok Bot. */
  requests?: GrokRequest[]
  /** Retired bots the app asked the Connector to delete in Grok Bot. */
  deletes?: GrokDelete[]
  /** The copy of BotsEverywhere this org lives in. One Connector serves every org in it. */
  project?: ProjectInfo
}

export interface ProjectInfo {
  id: string
  connectorName: string
  /** Absolute path of orgs/, the only folder the Connector uses. */
  orgsFolder: string
  /** orgs/connector.json, or null when the project Connector never wrote it. */
  connector: { stamp: string; syncedAt: string; error: string } | null
  /** Names of bots in Grok Bot that belong to no organization. */
  unassigned: string[]
  /** Active bot seats across every org: they share one Grok Bot account. */
  bots: number
  /** Seat slug → the name Grok Bot gets, when another org already uses the title. */
  renamed: Record<string, string>
}

export function parseSnapshot(text: string, fallbackSyncedAt: string): { ok: true; snapshot: Snapshot } | { ok: false; error: string } {
  const clean = normalizeText(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch {
    return { ok: false, error: 'This file is not JSON.' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The snapshot must be a JSON object with a bots list.' }
  }
  const record = parsed as { syncedAt?: unknown; bots?: unknown; processes?: unknown }
  if (!Array.isArray(record.bots)) return { ok: false, error: 'The snapshot needs a bots list.' }
  // The project Connector does not list itself, so an org with no bots in Grok Bot yet is an empty list, not a failed run.
  let bots: BotsFileRow[] = []
  if (record.bots.length > 0) {
    const read = parseBotsFile(clean)
    if (!read.ok) return { ok: false, error: read.errors.join(' ') }
    bots = read.rows
  }
  let processes: ProcessImportRow[] = []
  if (record.processes !== undefined && record.processes !== null) {
    const read = parseProcessesFile(clean)
    if (!read.ok) return { ok: false, error: read.errors.join(' ') }
    processes = read.rows
  }
  const stamp = typeof record.syncedAt === 'string' && !Number.isNaN(Date.parse(record.syncedAt))
    ? new Date(record.syncedAt).toISOString()
    : fallbackSyncedAt
  return { ok: true, snapshot: { syncedAt: stamp, bots, processes } }
}

/** The merge, as rows. The app owns structure; Grok Bot owns facts. Nothing here deletes. */
/**
 * `elsewhere`: other bots in the Grok Bot account: listed under no organization, in another org's snapshot, or the Connector itself.
 * One account runs every bot and a bot may sit in several orgs, so a seat matching one of them is in Grok Bot and never called missing.
 */
export function planSync(snapshot: Snapshot, seats: SeatDocument[], processes: ProcessFile[], orgName = '', elsewhere: Pick<BotsFileRow, 'name' | 'grokBotUrl'>[] = []): SyncPlan {
  const rows: SyncRow[] = []
  const claimed = new Set<string>()
  const matched: { bot: BotsFileRow; seat: SeatDocument; byUrl: boolean }[] = []
  const fresh: BotsFileRow[] = []
  for (const bot of snapshot.bots) {
    if (bot.error) {
      rows.push({ kind: 'skipped', name: bot.name, error: bot.error })
      continue
    }
    const found = findSeat(bot, seats, claimed, orgName)
    if (!found) {
      fresh.push(bot)
      continue
    }
    claimed.add(found.seat.slug)
    matched.push({ bot, seat: found.seat, byUrl: found.byUrl })
  }

  const existing = seats.map((item) => ({ slug: item.slug, title: item.title }))
  const batch = new Map<string, string>()
  const cleaned = fresh.map(sanitizeBot)
  for (const bot of cleaned) batch.set(bot.name.toLowerCase(), slugify(bot.name))
  for (const bot of cleaned) {
    const resolved = resolveManager(bot.reportsTo, bot.name, existing, batch)
    if (resolved.ok) {
      rows.push({ kind: 'new', name: bot.name, bot, note: bot.note })
      continue
    }
    const note = `${bot.reportsTo.trim() || 'You'} is not a seat here, placed under You.`
    rows.push({ kind: 'new', name: bot.name, bot: { ...bot, reportsTo: 'You' }, note: bot.note ? `${bot.note} ${note}` : note })
  }

  for (const { bot, seat, byUrl } of matched) {
    rows.push(diffSeat(bot, seat, byUrl, snapshot.syncedAt))
  }

  // A second seat for a bot this snapshot lists is still that bot, so it is in Grok Bot too.
  const account = [...elsewhere, ...snapshot.bots]
  const elsewhereLinks = new Set(account.map((bot) => bot.grokBotUrl.trim()).filter(Boolean))
  const elsewhereNames = new Set(account.map((bot) => bot.name.trim().toLowerCase()))
  const snapshotAt = Date.parse(snapshot.syncedAt)
  for (const seat of seats) {
    if (seat.kind !== 'bot' || seat.status === 'retired' || claimed.has(seat.slug)) continue
    if (elsewhereLinks.has((seat.grokBotUrl ?? '').trim()) || elsewhereNames.has(seat.title.trim().toLowerCase())) {
      // A seat an earlier sync called missing goes back to In Grok Bot.
      if (seat.grokSync === 'missing') {
        rows.push({ kind: 'updated', name: seat.title, slug: seat.slug, renamed: false, changes: ['in Grok Bot'], patch: { grokSync: 'synced', grokSyncedAt: snapshot.syncedAt, grokMissingSince: null } })
      }
      continue
    }
    // Added from Grok Bot data at least as new as this snapshot, so this snapshot cannot say it is gone.
    const stamped = seat.grokSync === 'new' || seat.grokSync === 'synced' ? Date.parse(seat.grokSyncedAt ?? '') : NaN
    if (!Number.isNaN(stamped) && !Number.isNaN(snapshotAt) && stamped >= snapshotAt) continue
    const already = seat.grokSync === 'missing'
    rows.push({
      kind: 'missing',
      name: seat.title,
      slug: seat.slug,
      write: !already,
      patch: { grokSync: 'missing', grokMissingSince: already ? seat.grokMissingSince ?? snapshot.syncedAt : snapshot.syncedAt },
    })
  }

  const bySlug = new Map(processes.map((process) => [process.slug, process]))
  const seen = new Set<string>()
  for (const row of snapshot.processes) {
    if (row.error) {
      rows.push({ kind: 'skipped', name: row.name || 'Process', error: row.error })
      continue
    }
    const slug = processSlug(row.name)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const current = bySlug.get(slug) ?? processes.find((process) => process.name.trim().toLowerCase() === row.name.trim().toLowerCase())
    if (!current) {
      rows.push({ kind: 'new-process', name: row.name, row })
      continue
    }
    const routine = row.trigger.schedule.trim()
    const process = current.trigger.schedule.trim()
    if (row.trigger.type === 'schedule' && current.trigger.type === 'schedule' && routine && routine !== process) {
      rows.push({ kind: 'schedule', name: row.name, slug: current.slug, process, routine })
    }
  }

  const counts: SyncCounts = {
    new: rows.filter((row) => row.kind === 'new').length,
    missing: rows.filter((row) => row.kind === 'missing' && row.write).length,
    updated: rows.filter((row) => row.kind === 'updated').length,
    processes: rows.filter((row) => row.kind === 'new-process').length,
    warnings: rows.filter((row) => row.kind === 'schedule').length,
    unchanged: rows.filter((row) => row.kind === 'unchanged').length,
  }
  return { syncedAt: snapshot.syncedAt, rows, counts, writes: counts.new + counts.missing + counts.updated + counts.processes }
}

export function summaryLine(counts: SyncCounts): string {
  const parts: string[] = []
  if (counts.new) parts.push(`${counts.new} new`)
  if (counts.missing) parts.push(`${counts.missing} missing`)
  if (counts.updated) parts.push(`${counts.updated} updated`)
  if (counts.processes) parts.push(`${counts.processes} new ${counts.processes === 1 ? 'process' : 'processes'}`)
  return parts.length ? parts.join(', ') : 'Nothing to sync'
}

/** Applies one patch to a seat file's text. Comes back as UTF-8 without a BOM and with LF, whatever went in. */
export function patchSeatSource(slug: string, source: string, patch: SeatPatch): { ok: true; source: string } | { ok: false; errors: string[] } {
  const parsed = parseSeatMarkdown(slug, source)
  if (!parsed.ok) return parsed
  const next: SeatDocument = { ...parsed.seat, grokSync: patch.grokSync, source: '' }
  if (patch.title !== undefined) {
    next.title = patch.title
    next.role = patch.role ?? patch.title
  }
  if (patch.grokBotUrl !== undefined) next.grokBotUrl = patch.grokBotUrl
  if (patch.createdAt !== undefined) next.createdAt = patch.createdAt
  if (patch.lastActive !== undefined) next.lastActive = patch.lastActive
  if (patch.runs30d !== undefined) next.runs30d = patch.runs30d
  if (patch.tasksDone30d !== undefined) next.tasksDone30d = patch.tasksDone30d
  if (patch.routines !== undefined) next.routines = patch.routines
  if (patch.botStatus !== undefined) next.botStatus = patch.botStatus
  if (patch.owns !== undefined) next.owns = patch.owns
  if (patch.may !== undefined) next.may = patch.may
  if (patch.mustAskBefore !== undefined) next.mustAskBefore = patch.mustAskBefore
  if (patch.doneWhen !== undefined) next.doneWhen = patch.doneWhen
  if (patch.grokSyncedAt !== undefined) next.grokSyncedAt = patch.grokSyncedAt
  if (patch.grokMissingSince === null) delete next.grokMissingSince
  else if (patch.grokMissingSince !== undefined) next.grokMissingSince = patch.grokMissingSince
  const written = serializeSeat(next)
  const check = parseSeatMarkdown(slug, written)
  if (!check.ok) return check
  return { ok: true, source: written }
}

/** Only bot seats can match. A human or system seat is never touched by a snapshot, whatever it is called. */
function findSeat(bot: BotsFileRow, all: SeatDocument[], claimed: Set<string>, orgName = ''): { seat: SeatDocument; byUrl: boolean } | null {
  const seats = all.filter((seat) => seat.kind === 'bot')
  const link = bot.grokBotUrl.trim()
  if (link) {
    const byUrl = seats.find((seat) => !claimed.has(seat.slug) && (seat.grokBotUrl ?? '').trim() === link)
    if (byUrl) return { seat: byUrl, byUrl: true }
  }
  const name = bot.name.trim().toLowerCase()
  // A name another org of the project also used was created in Grok Bot as "Title · Org name".
  const suffix = orgName.trim() ? ` · ${orgName.trim().toLowerCase()}` : ''
  const byName = seats.find((seat) => !claimed.has(seat.slug) && (seat.title.trim().toLowerCase() === name || (suffix !== '' && `${seat.title.trim().toLowerCase()}${suffix}` === name)))
  if (byName) return { seat: byName, byUrl: false }
  const slug = slugify(bot.name)
  const bySlug = seats.find((seat) => !claimed.has(seat.slug) && seat.slug === slug)
  return bySlug ? { seat: bySlug, byUrl: false } : null
}

/** One line of plain text. Newlines and tabs become spaces so a value can never start a frontmatter line. */
function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Card lines from a snapshot. A line that would read as a heading or a frontmatter fence is dropped. */
function cleanLines(lines: string[]): string[] {
  return lines.map(cleanText).filter((line) => line && !line.startsWith('#') && line !== '---')
}

function sanitizeBot(bot: BotsFileRow): BotsFileRow {
  return {
    ...bot,
    name: cleanText(bot.name),
    reportsTo: cleanText(bot.reportsTo),
    owns: cleanLines(bot.owns),
    may: cleanLines(bot.may),
    needsApproval: cleanLines(bot.needsApproval),
    doneWhen: cleanLines(bot.doneWhen),
  }
}

function diffSeat(raw: BotsFileRow, seat: SeatDocument, byUrl: boolean, syncedAt: string): SyncRow {
  const bot = sanitizeBot(raw)
  const changes: string[] = []
  const patch: SeatPatch = { grokSync: 'synced' }
  const name = bot.name
  if (byUrl && name !== seat.title.trim()) {
    patch.title = name
    patch.role = seat.role.trim() === seat.title.trim() ? name : seat.role
    changes.push(`name → ${name}`)
  }
  if (bot.grokBotUrl && bot.grokBotUrl !== (seat.grokBotUrl ?? '')) {
    patch.grokBotUrl = bot.grokBotUrl
    changes.push('link')
  }
  if (bot.createdAt && bot.createdAt !== (seat.createdAt ?? '')) {
    patch.createdAt = bot.createdAt
    changes.push(`created ${formatShortDate(bot.createdAt)}`)
  }
  if (bot.lastActive && bot.lastActive !== (seat.lastActive ?? '')) {
    patch.lastActive = bot.lastActive
    changes.push(`last active ${formatShortDate(bot.lastActive)}`)
  }
  if (bot.runs30d !== undefined && bot.runs30d !== seat.runs30d) {
    patch.runs30d = bot.runs30d
    changes.push(`${bot.runs30d} runs`)
  }
  if (bot.tasksDone30d !== undefined && bot.tasksDone30d !== seat.tasksDone30d) {
    patch.tasksDone30d = bot.tasksDone30d
    changes.push(`${bot.tasksDone30d} tasks`)
  }
  if (bot.routines.length && JSON.stringify(bot.routines) !== JSON.stringify(seat.routines ?? [])) {
    patch.routines = bot.routines
    changes.push(`${bot.routines.length} ${bot.routines.length === 1 ? 'routine' : 'routines'}`)
  }
  if (bot.botStatus && bot.botStatus !== seat.botStatus) {
    patch.botStatus = bot.botStatus
    changes.push(bot.botStatus)
  }
  const fills: [keyof Pick<SeatPatch, 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'>, string, string[]][] = [
    ['owns', 'Owns', bot.owns],
    ['may', 'May', bot.may],
    ['mustAskBefore', 'Needs approval', bot.needsApproval],
    ['doneWhen', 'Done when', bot.doneWhen],
  ]
  for (const [key, label, lines] of fills) {
    if (seat[key].some((line) => line.trim()) || !lines.length) continue
    patch[key] = lines
    changes.push(`${label} filled`)
  }
  if (seat.grokSync === 'missing') {
    patch.grokMissingSince = null
    changes.push('found again')
  }
  if (seat.grokSync === 'new') changes.push('no longer new')
  // A seat the sync has never stamped is written once so its drawer stops saying "not synced yet".
  if (seat.grokSync === undefined) changes.push('first seen')
  if (!changes.length) return { kind: 'unchanged', name: seat.title, slug: seat.slug }
  patch.grokSyncedAt = syncedAt
  return { kind: 'updated', name: seat.title, slug: seat.slug, renamed: patch.title !== undefined, changes, patch }
}

/** A file name from a name: lowercase, hyphens for anything else. Empty when nothing usable is left. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}
