import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKUPS_DIR, GUIDE_FILE, RESULTS_FILE, TODO_FILE, UNASSIGNED_FILE, readTextFile, writeFileAtomic } from './connector-files.ts'
import { CONNECTOR_BOT_NAME, SNAPSHOT_PATH, connectorGuide, connectorName } from './connector-prompt.ts'
import { computeTodo, orgBlocksFromData, parseResults, requestProgress, seatBots, updatedFor, type ResultsFile, type TodoFile, type TodoItem, type VerifyEntry } from './connector-todo.ts'
import { botJson, linkedBotIds, readGrokData, snapshotFromData, snapshotJson, unassignedFromData, type GrokData } from './grok-data.ts'
import type { GrokRequest } from './grok-requests.ts'
import type { ConnectorState, RequestPart } from './grok-sync.ts'
import { normalizeText } from './normalize-text.ts'
import { grokSeats, type OrgBundle } from './org-files.ts'
import { profileFileLines } from './profile-files.ts'
import { latestProfileReports, type ProfileReport } from './profile-reports.ts'
import { readLibrarySeen, readProfileAsk, writeLibrarySeen, writeProfileAsk } from './profile-asks.ts'
import { readConnector, readRemoveCopies, readSyncMinutes } from './project.ts'
import { listOrgSlugs, readOrgDir, readRequests } from './template-server.ts'

/**
 * One cycle of Connector v2, run by the writer when a dump, a result, or an organization's files change: each
 * organization's snapshot from the dump (with the updates Grok Bot shows done), the bots in no organization, a backup of
 * every bot about to change, and the Connector's to-do list. A file is only written when its text changes.
 */

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

function writeIfChanged(path: string, text: string): boolean {
  if (readTextFile(path) === text) return false
  writeFileAtomic(path, text)
  return true
}

/** CONNECTOR.md for this copy, from its id, folder, interval, time zone, and platform. */
export function writeConnectorGuide(orgsDir: string, copyId: string): boolean {
  return writeIfChanged(resolve(orgsDir, GUIDE_FILE), connectorGuide({ id: copyId, orgsFolder: resolve(orgsDir), syncMinutes: readSyncMinutes(orgsDir), timeZone: timeZone(), windows: process.platform === 'win32' }))
}

/** Keeps the text a bot had before the Connector changes it, once per distinct text. */
function backUp(orgsDir: string, todo: TodoFile, now: Date) {
  for (const item of todo.items) {
    if (item.kind !== 'describe' || !item.botId || item.expectedBefore === undefined) continue
    const dir = resolve(orgsDir, BACKUPS_DIR, item.botId.replace(/[^A-Za-z0-9_-]/g, '_'))
    const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.txt')).sort() : []
    const last = names.at(-1)
    if (last && readTextFile(join(dir, last)) === item.expectedBefore) continue
    writeFileAtomic(join(dir, `${now.toISOString().replace(/[:.]/g, '-')}.txt`), item.expectedBefore)
  }
}

export function runConnectorCycle(orgsDir: string, copyId: string, now = new Date()): { ok: true; dumpedAt: string } | { ok: false; error: string; missing: boolean } {
  const dump = readGrokData(orgsDir)
  // No dump yet: an older Connector still writes the snapshots itself, so nothing here is touched.
  if (!dump.ok) return dump
  const { data } = dump
  const orgsFolder = resolve(orgsDir)
  const zone = timeZone()
  // An unreadable results file could hide what was already sent: change nothing until it reads again.
  const read = readResults(orgsDir)
  if (!read.ok) return { ok: false, error: read.error, missing: false }
  const { results } = read
  const apps = readConnector(orgsDir)?.apps
  const orgs: { id: string; bundle: OrgBundle; requests: GrokRequest[]; profileAskedAt?: string }[] = []
  const keepOrgs: string[] = []
  for (const slug of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, slug)
    const read = readOrgDir(root, slug)
    if (!read.ok) {
      keepOrgs.push(slug)
      continue
    }
    // A greyed seat's bot works for another organization: it gets no block, no snapshot row, and no to-do here.
    orgs.push({ id: slug, bundle: { ...read.bundle, seats: grokSeats(read.bundle.seats) }, requests: readRequests(root).requests, ...(readProfileAsk(root) ? { profileAskedAt: readProfileAsk(root) } : {}) })
  }
  // A skill new in the library since the last reading may be one a bot saved in its own chat. Grok Bot keeps no link from a
  // skill to a bot, so only the bot can say it uses it: every bot is asked for its profile, and the skill reaches its card
  // on the next run. The first reading only remembers the library, so an upgrade asks nothing.
  const library = data.skills.map((skill) => skill.name.trim().toLowerCase()).filter(Boolean)
  const seen = readLibrarySeen(orgsDir)
  if (seen && library.some((name) => !seen.includes(name))) {
    const askedAt = now.toISOString()
    for (const org of orgs) {
      if (!org.bundle.seats.some((seat) => seat.kind === 'bot' && seat.status !== 'retired' && !seat.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase()))) continue
      writeProfileAsk(resolve(orgsDir, org.id), askedAt)
      org.profileAskedAt = askedAt
    }
  }
  writeLibrarySeen(orgsDir, library)
  const taken = linkedBotIds(orgs.map((org) => org.bundle))
  const profiles = latestProfileReports([...results.confirmations, ...profileFileLines(orgsDir, orgs.map((org) => org.id))])
  for (const org of orgs) {
    const orgName = org.bundle.org.company.name
    const created = org.requests.filter((request) => request.kind !== 'update').map((request) => request.name)
    const orgData = withProfiles(data, org, profiles, taken)
    const snapshot = snapshotFromData(orgData, org.bundle, orgName, copyId, apps, created)
    const blocks = orgBlocksFromData({ copyId, orgsFolder, timeZone: zone, org, data: orgData, taken })
    const updated = updatedFor(org.id, org.requests, orgData, results, blocks)
    writeIfChanged(resolve(orgsDir, org.id, SNAPSHOT_PATH), snapshotJson({ ...snapshot, ...(updated.length ? { updated } : {}) }))
  }
  const unassigned = unassignedFromData(data, orgs.map((org) => ({ bundle: org.bundle, orgName: org.bundle.org.company.name, created: org.requests.filter((request) => request.kind !== 'update').map((request) => request.name) })))
  writeIfChanged(resolve(orgsDir, UNASSIGNED_FILE), `${JSON.stringify({ syncedAt: data.dumpedAt, unassigned: unassigned.map(botJson) }, null, 2)}\n`)
  const previous = readTodo(orgsDir)
  const todo = computeTodo({ copyId, orgsFolder, timeZone: zone, data, orgs, keepOrgs, results, removeCopies: readRemoveCopies(orgsDir), now, previous, profiles })
  backUp(orgsDir, todo, now)
  writeIfChanged(resolve(orgsDir, TODO_FILE), `${JSON.stringify(withRuns(todo, previous), null, 2)}\n`)
  return { ok: true, dumpedAt: data.dumpedAt }
}

/**
 * The dump as one organization sees it: a bot that sent its own profile for a seat there has the routines it reported,
 * paused ones included, in place of what Grok Bot's files show, which only a few bots have and can be out of date. Its
 * reported skills are left out on purpose: a skill turned on for a bot is not one its seat says to use.
 */
function withProfiles(data: GrokData, org: { id: string; bundle: OrgBundle }, profiles: Map<string, ProfileReport>, taken: Set<string>): GrokData {
  const reported = new Map<string, ProfileReport>()
  for (const [slug, bot] of seatBots(org.bundle, data, taken).bots) {
    const profile = bot ? profiles.get(`${org.id}|${slug}`) : undefined
    if (bot && profile) reported.set(bot.id, profile)
  }
  if (!reported.size) return data
  return { ...data, bots: data.bots.map((bot) => (reported.has(bot.id) ? { ...bot, routinesVisible: true, routines: reported.get(bot.id)!.routines } : bot)) }
}

/** connector-results.json. No file is no results; a file that is not a JSON object cannot be read. */
function readResults(orgsDir: string): { ok: true; results: ResultsFile } | { ok: false; error: string } {
  const text = readTextFile(resolve(orgsDir, RESULTS_FILE))
  if (text === null || !text.trim()) return { ok: true, results: { results: [], confirmations: [] } }
  try {
    const data = JSON.parse(normalizeText(text)) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'connector-results.json could not be read: it is not a JSON object.' }
  } catch {
    return { ok: false, error: 'connector-results.json could not be read: it is not JSON.' }
  }
  return { ok: true, results: parseResults(text) }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'

/** The to-do list the app wrote last. Entries that are not what the app writes are left out, so a hand-edited file never breaks a cycle or the drawer. */
function readTodo(orgsDir: string): TodoFile | null {
  try {
    const text = readTextFile(resolve(orgsDir, TODO_FILE))
    const data = text ? JSON.parse(normalizeText(text)) as unknown : null
    if (!isObject(data) || !Array.isArray(data.items)) return null
    const list = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : [])
    return {
      basedOn: isString(data.basedOn) ? data.basedOn : '',
      items: list(data.items).filter((item) => isString(item.key) && isString(item.kind) && isString(item.bot) && isString(item.org)) as unknown as TodoItem[],
      stuck: list(data.stuck).filter((item) => isString(item.bot) && isString(item.org) && isString(item.why)) as unknown as TodoFile['stuck'],
      otherCopies: list(data.otherCopies).filter((item) => isString(item.copy) && Array.isArray(item.bots) && item.bots.every(isString)) as unknown as TodoFile['otherCopies'],
      verify: list(data.verify).filter((item) => ['key', 'botId', 'bot', 'org', 'ownerSha', 'descriptionSha', 'doneAt'].every((field) => isString(item[field]))) as unknown as VerifyEntry[],
      ledger: parseResults(JSON.stringify({ results: list(data.ledger) })).results,
    }
  } catch {
    return null
  }
}

/** Each item keeps the dump it was first listed after; its count goes up once per newer dump it is still listed after. */
function withRuns(todo: TodoFile, previous: TodoFile | null): TodoFile {
  const before = new Map((previous?.items ?? []).map((item) => [item.key, item]))
  const newer = previous?.basedOn !== todo.basedOn
  return {
    ...todo,
    items: todo.items.map((item) => {
      const last = before.get(item.key)
      const runs = last && typeof last.runs === 'number' ? last.runs + (newer ? 1 : 0) : 1
      return { ...item, since: typeof last?.since === 'string' ? last.since : todo.basedOn, runs }
    }),
  }
}

/** Where each of one organization's requests stands, part by part, from the latest dump, the results, and the to-do list. Empty without a dump. */
export function requestProgressFor(orgsDir: string, orgId: string, requests: GrokRequest[]): Record<string, RequestPart[]> {
  const dump = readGrokData(orgsDir)
  if (!dump.ok || !requests.length) return {}
  const read = readResults(orgsDir)
  return requestProgress({ orgId, requests, data: dump.data, results: read.ok ? read.results : { results: [], confirmations: [] }, todo: readTodo(orgsDir) })
}

/**
 * What the Connector could not do, for one organization's Sync drawer: stuck items with their reason, items on their
 * second try, items listed after more than two dumps, a dump that could not be read, and other copies' blocks.
 */
export function connectorState(orgsDir: string, orgId: string): ConnectorState {
  const dump = readGrokData(orgsDir)
  const read = readResults(orgsDir)
  const dumpError = !dump.ok && !dump.missing ? dump.error : read.ok ? '' : read.error
  const todo = readTodo(orgsDir)
  const results = read.ok ? read.results : { results: [], confirmations: [] }
  const removing = readRemoveCopies(orgsDir)
  const here = (org: string) => org === orgId || org === ''
  const items = (todo?.items ?? []).filter((item) => here(item.org))
  const failed = items.flatMap((item) => {
    const attempt = Number(/#(\d+)$/.exec(item.key)?.[1] ?? 1)
    if (attempt < 2) return []
    const last = results.results.filter((result) => result.key === item.key.replace(/#\d+$/, `#${attempt - 1}`)).at(-1)
    return [{ bot: item.bot, why: last?.status === 'done' ? 'reported done, but Grok Bot does not show it' : last?.why || 'no reason given' }]
  })
  const count = (kind: TodoItem['kind']) => items.filter((item) => item.kind === kind).length
  const late = items.filter((item) => (item.runs ?? 0) > 2)
  const pendingSince = late.map((item) => item.since ?? '').filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? ''
  const since = Date.parse(pendingSince)
  // The dump lists every bot in the account but this copy's own Connector. Without a dump nothing is known, so no copy is called gone.
  const account = new Set(dump.ok ? dump.data.bots.map((bot) => bot.name.trim().toLowerCase()) : [])
  const connectorGone = (copy: string) => dump.ok && !account.has(connectorName(copy).toLowerCase())
  return {
    stuck: (todo?.stuck ?? []).filter((item) => here(item.org)).map((item) => ({ bot: item.bot, why: item.why })),
    failed,
    pending: late.length,
    pendingSince,
    actedSince: Number.isNaN(since) ? 0 : results.results.filter((result) => Date.parse(result.at) >= since).length,
    waiting: { routines: count('routine'), profiles: count('profile'), notes: count('cleanup') },
    dumpError,
    otherCopies: (todo?.otherCopies ?? []).map((item) => ({ copy: item.copy, bots: item.bots, removing: removing.includes(item.copy), connectorGone: connectorGone(item.copy) })),
  }
}
