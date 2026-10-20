import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BotsFileRow } from './bots-file.ts'
import type { FileActivity, SeatDocument } from './org-files.ts'
import { normalizeText } from './normalize-text.ts'
import { staleMinutes } from './connector-timing.ts'
import { readConnector, readSyncMinutes } from './project.ts'
import { appendActivity, clearDeletedBots, listOrgSlugs, readOrgDir, readRequests, readSnapshot } from './template-server.ts'

/** The app's memory of what it already logged about the Connector, so a run is never logged twice. */
export const CONNECTOR_LOG_FILE = 'connector-log.json'

interface OrgMemory {
  /** Bot names in the last snapshot read, or null before the first one. */
  bots: string[] | null
  /** Local date of the day line, and how many runs it counts. */
  day: string
  runs: number
  firstRunAt: string
}

interface Memory {
  lastStamp: string
  lastRunAt: string
  state: '' | 'connected' | 'stopped'
  orgs: Record<string, OrgMemory>
}

function readMemory(orgsDir: string): Memory {
  const empty: Memory = { lastStamp: '', lastRunAt: '', state: '', orgs: {} }
  const path = resolve(orgsDir, CONNECTOR_LOG_FILE)
  if (!existsSync(path)) return empty
  try {
    const data = JSON.parse(normalizeText(readFileSync(path, 'utf8'))) as Partial<Memory>
    return {
      lastStamp: typeof data.lastStamp === 'string' ? data.lastStamp : '',
      lastRunAt: typeof data.lastRunAt === 'string' ? data.lastRunAt : '',
      state: data.state === 'connected' || data.state === 'stopped' ? data.state : '',
      orgs: data.orgs && typeof data.orgs === 'object' ? data.orgs : {},
    }
  } catch {
    // A bad memory file only means the next run is treated as new.
    return empty
  }
}

function writeMemory(orgsDir: string, memory: Memory) {
  try {
    writeFileSync(resolve(orgsDir, CONNECTOR_LOG_FILE), `${JSON.stringify(memory, null, 2)}\n`, 'utf8')
  } catch {
    // Logging must never stop the writer.
  }
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function localWhen(date: Date): string {
  return `${localDay(date)} ${localTime(date)}`
}

function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}

/** `Label=value|Label=value`, with the separators taken out of the values. */
function stats(pairs: [string, string | number | undefined][]): string {
  return pairs
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([label, value]) => `${label}=${String(value).replace(/[|=]/g, '/')}`)
    .join('|')
}

function seatFor(name: string, seats: SeatDocument[], orgName: string): SeatDocument | undefined {
  const wanted = name.trim().toLowerCase()
  const suffix = ` · ${orgName.trim().toLowerCase()}`
  return seats.find((seat) => seat.kind === 'bot' && (seat.title.trim().toLowerCase() === wanted || `${seat.title.trim().toLowerCase()}${suffix}` === wanted))
}

function botStats(bot: BotsFileRow): string {
  return stats([
    ['Routines', bot.routines?.length || undefined],
    ['Runs (30d)', bot.runs30d ?? undefined],
    ['Tasks (30d)', bot.tasksDone30d ?? undefined],
    ['Status', bot.botStatus || undefined],
    ['Link', bot.grokBotUrl ? 'yes' : undefined],
  ])
}

function event(orgId: string, id: string, at: Date, kind: string, summary: string, extra: Partial<FileActivity> = {}): FileActivity {
  return { id, orgId, type: 'edit', actorSeatId: 'connector', actorType: 'bot', timestamp: at.toISOString(), summary, kind, grok: 'in', ...extra }
}

/**
 * Called when orgs/connector.json changes. Logs, in every organization:
 * Connected (first run, or after a stop), each bot that connected or left, a snapshot it could not read,
 * and one line per day with the run count and the latest figures, rewritten on every run.
 */
export function recordConnectorRun(orgsDir: string, connectorName: string): void {
  const connector = readConnector(orgsDir)
  if (!connector?.stamp) return
  const memory = readMemory(orgsDir)
  if (memory.lastStamp === connector.stamp) return
  const written = Number(connector.stamp.split(':')[0])
  const at = Number.isFinite(written) && written > 0 ? new Date(written) : new Date()
  const firstEver = !memory.lastStamp
  const wasStopped = memory.state === 'stopped'
  const previousRun = memory.lastRunAt ? new Date(memory.lastRunAt) : null
  const stamp = at.toISOString()
  // Deletes the run confirmed get their own line, so the bot is not also logged as gone.
  const deleted = clearDeletedBots(orgsDir)
  for (const orgId of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, orgId)
    const read = readOrgDir(root, orgId)
    if (!read.ok) continue
    const orgName = read.bundle.org.company.name
    const seats = read.bundle.seats
    const before = memory.orgs[orgId] ?? { bots: null, day: '', runs: 0, firstRunAt: '' }
    if (firstEver) {
      appendActivity(root, event(orgId, `connector-connected-${stamp}`, at, 'connected', 'Connected to Grok Bot', {
        stats: stats([['Connector', connectorName], ['Folder', orgsDir], ['First run', localWhen(at)]]),
      }))
    } else if (wasStopped) {
      appendActivity(root, event(orgId, `connector-connected-${stamp}`, at, 'connected', 'Connected to Grok Bot again', {
        stats: stats([['Connector', connectorName], ['Run', localWhen(at)], ['Down for', previousRun ? span(at.getTime() - previousRun.getTime()) : undefined]]),
      }))
    }
    const snap = readSnapshot(root)
    let bots = before.bots
    if (!snap.ok && !snap.missing) {
      appendActivity(root, event(orgId, `connector-error-${stamp}`, at, 'connector-error', "Connector ran, but this organization's snapshot could not be read", {
        stats: stats([['Error', snap.error], ['Run', localWhen(at)]]),
      }))
    }
    if (snap.ok) {
      const names = snap.snapshot.bots.map((bot) => bot.name.trim()).filter(Boolean)
      const known = new Set(before.bots ?? [])
      for (const bot of snap.snapshot.bots) {
        const name = bot.name.trim()
        if (!name || known.has(name)) continue
        const seat = seatFor(name, seats, orgName)
        appendActivity(root, event(orgId, `connector-bot-${seat?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`, at, 'bot-connected', `${name} connected to Grok Bot`, {
          subjectSeatId: seat?.slug,
          stats: botStats(bot),
        }))
      }
      const now = new Set(names)
      for (const name of before.bots ?? []) {
        if (now.has(name)) continue
        const seat = seatFor(name, seats, orgName)
        if (seat && deleted.get(orgId)?.has(seat.slug)) continue
        appendActivity(root, event(orgId, `connector-gone-${seat?.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`, at, 'bot-disconnected', `${name} is no longer in Grok Bot`, {
          subjectSeatId: seat?.slug,
          stats: stats([['Last seen', previousRun ? localWhen(previousRun) : undefined]]),
        }))
      }
      bots = names
    }
    const day = localDay(at)
    const sameDay = before.day === day
    const runs = sameDay ? before.runs + 1 : 1
    const firstRunAt = sameDay && before.firstRunAt ? before.firstRunAt : stamp
    const pending = readRequests(root)
    const waiting = pending.requests.length + pending.deletes.length
    appendActivity(root, event(orgId, `connector-day-${day}`, at, 'connector-run', 'Connector runs today', {
      stats: stats([
        ['Runs today', runs],
        ['First', localTime(new Date(firstRunAt))],
        ['Last', localTime(at)],
        ['In Grok Bot', bots ? bots.length : undefined],
        ['Waiting', waiting],
        ['No organization', connector.unassigned.length],
      ]),
    }), true)
    memory.orgs[orgId] = { bots, day, runs, firstRunAt }
  }
  memory.lastStamp = connector.stamp
  memory.lastRunAt = stamp
  memory.state = 'connected'
  writeMemory(orgsDir, memory)
}

/** Called every minute. Logs Connector stopped once in every organization after three intervals without a run, at the interval the Connector reports, else the saved one. */
export function checkConnectorStopped(orgsDir: string, now = new Date()): void {
  const memory = readMemory(orgsDir)
  if (memory.state !== 'connected' || !memory.lastRunAt) return
  const last = new Date(memory.lastRunAt)
  const minutes = readConnector(orgsDir)?.syncMinutes ?? readSyncMinutes(orgsDir)
  if (now.getTime() - last.getTime() <= staleMinutes(minutes) * 60_000) return
  for (const orgId of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, orgId)
    appendActivity(root, event(orgId, `connector-stopped-${memory.lastRunAt}`, now, 'stopped', 'Connector stopped', {
      stats: stats([['Last run', localWhen(last)], ['Missed for', span(now.getTime() - last.getTime())]]),
    }))
  }
  memory.state = 'stopped'
  writeMemory(orgsDir, memory)
}
