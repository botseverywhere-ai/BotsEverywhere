import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BotsFileRow } from './bots-file.ts'
import { grokSeats, type FileActivity, type SeatDocument } from './org-files.ts'
import { normalizeText } from './normalize-text.ts'
import { staleMinutes } from './connector-timing.ts'
import { readConnector, readSyncMinutes } from './project.ts'
import { GROK_ACTIVITY_PROCESS } from './bot-metrics.ts'
import { formatRunLine, runLogHeader, type RunLine } from './run-log.ts'
import { readRunLogDir } from './run-log-files.ts'
import { andList, appendActivity, applyPerformance, clearFulfilledRequests, clearHandledUpdates, listOrgSlugs, markDeletedBots, readOrgDir, readRequests, readSnapshot } from './template-server.ts'
import { planSync, type AccountApp, type SyncPlan } from './grok-sync.ts'

/** The app's memory of what it already logged about the Connector, so a run is never logged twice. */
export const CONNECTOR_LOG_FILE = 'connector-log.json'

/** What the last report said about one bot, so the next can tell what moved. */
interface BotSeen {
  lastActive: string
  /** Routine name → its last run. */
  runs: Record<string, string>
}

interface OrgMemory {
  /** Bot names in the last snapshot read, or null before the first one. */
  bots: string[] | null
  /** Bot link (or name) → what the last report said. Absent before the first report this started counting from. */
  seen?: Record<string, BotSeen>
  /** Local date of the day line, and how many runs it counts. */
  day: string
  runs: number
  firstRunAt: string
  /** One row per run on that day, as the day line lists them. Absent before runs were listed. */
  dayRuns?: string[]
}

/** The most runs one day line lists. A Connector every 15 minutes runs 96 times a day. */
export const MAX_DAY_RUNS = 200

/** The day's rows with this run added last, keeping only the latest MAX_DAY_RUNS. */
export function withRun(rows: string[], row: string, max = MAX_DAY_RUNS): string[] {
  return [...rows, row].slice(-max)
}

interface Memory {
  lastStamp: string
  lastRunAt: string
  state: '' | 'connected' | 'stopped'
  orgs: Record<string, OrgMemory>
  /** App name → status in the last report that listed the account's apps. Absent before the first one. */
  apps?: Record<string, AccountApp['status']>
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
      ...(data.apps && typeof data.apps === 'object' && !Array.isArray(data.apps) ? { apps: data.apps } : {}),
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

/** The seat for a reported bot: by its link, else by name. */
function seatForBot(bot: BotsFileRow, seats: SeatDocument[], orgName: string): SeatDocument | undefined {
  const link = bot.grokBotUrl.trim()
  return (link ? seats.find((seat) => seat.kind === 'bot' && (seat.grokBotUrl ?? '').trim() === link) : undefined) ?? seatFor(bot.name, seats, orgName)
}

function laterThan(next: string, before: string | undefined): boolean {
  const at = Date.parse(next)
  if (Number.isNaN(at)) return false
  const was = before ? Date.parse(before) : Number.NaN
  return Number.isNaN(was) || at > was
}

/** A run-log line's instant: the log keeps this computer's wall-clock time. */
function lineInstant(line: Pick<RunLine, 'date' | 'time'>): number {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(line.date)
  const clock = /^(\d{1,2}):(\d{2})$/.exec(line.time)
  if (!day || !clock) return Number.NaN
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2])).getTime()
}

/** Appends one line the Connector's report showed, on the day it happened. Starts the file, or a new line, as needed. */
function appendSeenLine(root: string, at: Date, bot: string, process: string, step: string) {
  const date = localDay(at)
  const dir = resolve(root, 'log')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, `${date}.md`)
  const row = `${formatRunLine({ time: localTime(at), bot, process, step, status: 'done', note: 'seen by the Connector' })}\n`
  if (!existsSync(path)) {
    writeFileSync(path, `${runLogHeader(date)}\n${row}`)
    return
  }
  // A bot may have left the file without a final line break; never glue a line onto its last one.
  const text = readFileSync(path, 'utf8')
  appendFileSync(path, text.length && !text.endsWith('\n') ? `\n${row}` : row)
}

/**
 * The Connector briefs Performance. Between two reports, a routine whose last run moved is one automated task, and a
 * bot whose last-active time moved is one use, unless a routine run explains it. A bot that logged that work itself
 * keeps its own lines, so nothing is counted twice. The first report only sets the starting point.
 */
function briefPerformance(root: string, bots: BotsFileRow[], seats: SeatDocument[], orgName: string, before: Record<string, BotSeen> | undefined, now: number): Record<string, BotSeen> {
  const seen: Record<string, BotSeen> = {}
  const own = readRunLogDir(root).lines.filter((line) => line.note !== 'seen by the Connector')
  const window = now - 30 * 24 * 60 * 60 * 1000
  for (const bot of bots) {
    const key = bot.grokBotUrl.trim() || `name:${bot.name.trim().toLowerCase()}`
    const runs = Object.fromEntries((bot.routines ?? []).filter((routine) => routine.lastRun).map((routine) => [routine.name, routine.lastRun!]))
    seen[key] = { lastActive: bot.lastActive || '', runs }
    const prev = before?.[key]
    if (!prev) continue
    const name = seatForBot(bot, seats, orgName)?.title || bot.name
    const mine = own.filter((line) => line.bot.trim().toLowerCase() === name.trim().toLowerCase() || line.bot.trim().toLowerCase() === bot.name.trim().toLowerCase())
    const inRange = (at: number) => at >= window && at <= now + 60_000
    const routineTimes: number[] = []
    for (const [routine, lastRun] of Object.entries(runs)) {
      if (!laterThan(lastRun, prev.runs[routine])) continue
      const at = Date.parse(lastRun)
      routineTimes.push(at)
      if (!inRange(at)) continue
      const logged = mine.some((line) => line.process.trim().toLowerCase() === routine.trim().toLowerCase() && Math.abs(lineInstant(line) - at) <= 15 * 60_000)
      if (!logged) appendSeenLine(root, new Date(at), name, routine, 'routine run')
    }
    if (laterThan(bot.lastActive, prev.lastActive)) {
      const at = Date.parse(bot.lastActive)
      const since = Date.parse(prev.lastActive)
      const fromRoutine = routineTimes.some((time) => Math.abs(time - at) <= 5 * 60_000)
      const loggedItself = mine.some((line) => lineInstant(line) >= (Number.isNaN(since) ? at : since) - 60_000)
      if (!fromRoutine && !loggedItself && inRange(at)) appendSeenLine(root, new Date(at), name, GROK_ACTIVITY_PROCESS, 'active in Grok Bot')
    }
  }
  return seen
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

/**
 * What changed in the account's apps since the last report that listed them. The first such report is one line with
 * every app; after that, one line per app that connected, needs sign-in, or left.
 */
function appChanges(apps: AccountApp[], before: Memory['apps']): { key: string; summary: string; stats?: string }[] {
  const label = (app: AccountApp) => (app.status === 'needsAuth' ? `${app.name} (needs sign-in)` : app.name)
  if (!before) {
    if (!apps.length) return []
    const waiting = apps.filter((app) => app.status === 'needsAuth').map((app) => app.name)
    return [{ key: 'apps', summary: `Apps in Grok Bot: ${apps.map(label).join(', ')}`, stats: stats([['Connected', apps.length - waiting.length], ['Needs sign-in', waiting.join(', ') || undefined]]) }]
  }
  const lines: { key: string; summary: string }[] = []
  const was = new Map(Object.entries(before).map(([name, status]) => [name.toLowerCase(), { name, status }]))
  for (const app of apps) {
    const prev = was.get(app.name.toLowerCase())
    was.delete(app.name.toLowerCase())
    if (prev?.status === app.status) continue
    const key = `app-${slugPart(app.name)}`
    lines.push({ key, summary: app.status === 'needsAuth' ? `${app.name} needs sign-in in Grok Bot` : `${app.name} connected to Grok Bot` })
  }
  for (const gone of was.values()) lines.push({ key: `app-${slugPart(gone.name)}`, summary: `${gone.name} is no longer connected to Grok Bot` })
  return lines
}

/** One line per bot whose apps this run changed: the seats the run wrote, with the apps the seat had before. */
function botAppChanges(plan: SyncPlan, applied: string[], seats: SeatDocument[]): { slug: string; summary: string }[] {
  const lines: { slug: string; summary: string }[] = []
  for (const row of plan.rows) {
    if (row.kind !== 'updated' || !applied.includes(row.slug) || row.patch.apps === undefined) continue
    const seat = seats.find((item) => item.slug === row.slug)
    if (!seat) continue
    const had = seat.apps ?? []
    const has = row.patch.apps
    const added = has.filter((name) => !had.some((old) => old.toLowerCase() === name.toLowerCase()))
    const dropped = had.filter((name) => !has.some((now) => now.toLowerCase() === name.toLowerCase()))
    const parts = [added.length ? `now uses ${andList(added)}` : '', dropped.length ? `no longer uses ${andList(dropped)}` : ''].filter(Boolean)
    if (parts.length) lines.push({ slug: seat.slug, summary: `${seat.title} ${parts.join(' and ')}` })
  }
  return lines
}

function slugPart(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
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
  // Retired bots this run shows deleted get their own line, so they are not also logged as gone.
  const deleted = markDeletedBots(orgsDir)
  // The account's apps are one list for every organization. A Connector on an older prompt reports none and changes nothing.
  const apps = connector.apps ? appChanges(connector.apps, memory.apps) : []
  for (const orgId of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, orgId)
    const read = readOrgDir(root, orgId)
    if (!read.ok) continue
    const orgName = read.bundle.org.company.name
    const seats = grokSeats(read.bundle.seats)
    const before: OrgMemory = memory.orgs[orgId] ?? { bots: null, day: '', runs: 0, firstRunAt: '' }
    let seenNow = before.seen
    if (firstEver) {
      appendActivity(root, event(orgId, `connector-connected-${stamp}`, at, 'connected', 'Connected to Grok Bot', {
        stats: stats([['Connector', connectorName], ['Folder', orgsDir], ['First run', localWhen(at)]]),
      }))
    } else if (wasStopped) {
      appendActivity(root, event(orgId, `connector-connected-${stamp}`, at, 'connected', 'Connected to Grok Bot again', {
        stats: stats([['Connector', connectorName], ['Run', localWhen(at)], ['Down for', previousRun ? span(at.getTime() - previousRun.getTime()) : undefined]]),
      }))
    }
    for (const app of apps) {
      appendActivity(root, event(orgId, `connector-${app.key}-${stamp}`, at, 'apps', app.summary, app.stats ? { stats: app.stats } : {}))
    }
    const snap = readSnapshot(root)
    let bots = before.bots
    let performance = 0
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
      try {
        // Grok Bot's numbers land now, and a bot the owner asked for gets its link; the rest of the plan waits for Sync.
        const plan = planSync(snap.snapshot, seats, read.bundle.processes ?? [], orgName)
        const applied = applyPerformance(root, plan, new Set(readRequests(root).requests.filter((item) => item.kind !== 'update').map((item) => item.seat)))
        performance = applied.length
        for (const change of botAppChanges(plan, applied, seats)) {
          appendActivity(root, event(orgId, `connector-bot-apps-${change.slug}-${stamp}`, at, 'bot-apps', change.summary, { subjectSeatId: change.slug }))
        }
        clearFulfilledRequests(root, orgId, plan)
        clearHandledUpdates(root, orgId)
        seenNow = briefPerformance(root, snap.snapshot.bots, seats, orgName, before.seen, at.getTime())
      } catch {
        // Performance is a bonus; a failure here must never stop the run log.
      }
    }
    const day = localDay(at)
    const sameDay = before.day === day
    const runs = sameDay ? before.runs + 1 : 1
    const firstRunAt = sameDay && before.firstRunAt ? before.firstRunAt : stamp
    const waiting = readRequests(root).requests.length
    // Every run is a row on the day line, so Logs shows each sync while the folder still gets one file a day.
    const dayRuns = withRun(sameDay ? before.dayRuns ?? [] : [], stats([
      ['Run', localTime(at)],
      ['In Grok Bot', bots ? bots.length : undefined],
      ['Performance updated', performance || undefined],
      ['Waiting', waiting],
      ['No organization', connector.unassigned.length],
    ]))
    appendActivity(root, event(orgId, `connector-day-${day}`, at, 'connector-run', 'Connector runs today', {
      stats: stats([
        ['Runs today', runs],
        ['First', localTime(new Date(firstRunAt))],
        ['Last', localTime(at)],
        ['In Grok Bot', bots ? bots.length : undefined],
        ['Performance updated', performance || undefined],
        ['Waiting', waiting],
        ['No organization', connector.unassigned.length],
      ]),
      runs: dayRuns,
    }), true)
    memory.orgs[orgId] = { bots, day, runs, firstRunAt, dayRuns, ...(seenNow ? { seen: seenNow } : {}) }
  }
  if (connector.apps) memory.apps = Object.fromEntries(connector.apps.map((app) => [app.name, app.status]))
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
