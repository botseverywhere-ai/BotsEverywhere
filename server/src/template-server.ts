import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readText } from './text-file.ts'
import type { FileGuide, FileGuideKey, FileGuideRow } from './file-guide.js'
import { normalizeText } from './normalize-text.ts'
import { dirname, resolve, sep } from 'node:path'
import {
  SEAT_SLUG,
  bundleFromState,
  parseActivityLog,
  parseOrgProfile,
  parseSeatMarkdown,
  profileFromOrg,
  seatCounts,
  serializeOrgProfile,
  serializeHiredSeat,
  serializeExistingSeat,
  serializeSeat,
  isSeatGrokLink,
  quote,
  replaceSeatCardBody,
  cleanRoutines,
  cleanSkills,
  validateActivity,
  activeBotCardErrors,
  cardUnchanged,
  validateBundle,
  managerLoop,
  grokSeats,
  isGreyed,
  type FileActivity,
  type GrokSyncState,
  type OrgBundle,
  type OrgDocument,
  type OrgPerson,
  type OrgProfile,
  type SeatDocument,
  type WorkDocument,
} from './org-files.js'
import { logFileName, parseLogMarkdown, parseOrgMarkdown, parseWorkMarkdown, serializeLogMarkdown, serializeOrgMarkdown, serializeWorkMarkdown } from './org-markdown.js'
import { deleteProcessFile, importProcessRows, readProcessDir } from './process-files.js'
import { profileFileLines } from './profile-files.js'
import { parseProcessesFile, parseProcessMarkdown, serializeProcess, type ProcessFile } from './processes.js'
import { createLiveHub, type LiveKind } from './live-hub.js'
import { isRunLogName } from './run-log.js'
import { readRunLogDir } from './run-log-files.js'
import { IMPORT_LOCKED, importLocked, parseBotsFile, resolveManager, type BotsFilePreview, type BotsFileRow } from './bots-file.js'
import { ORG_IMPORT_LOCKED, orgImportLocked, parseOrgFile, plainSlug, type OrgFile } from './org-file.js'
import { unzipStore, zipStore } from './zip-store.js'
import { parseSnapshot, performanceOnly, planSync, patchSeatSource, summaryLine, type AccountBot, type ConnectorInfo, type GrokAccount, type ProjectInfo, type Snapshot, type SyncCounts, type SyncPlan, type SyncStatus } from './grok-sync.js'
import { CONNECTOR_BOT_NAME, SNAPSHOT_PATH, connectorName } from './connector-prompt.js'
import { everyLabel, scheduleFor } from './connector-timing.js'
import { CONNECTOR_FILE, ID_CHARS, ensureProjectId, readConnector, readMainBot, readSyncMinutes, writeMainBot, writeRemoveCopy, writeSyncMinutes } from './project.js'
import { checkConnectorStopped, recordConnectorRun } from './connector-log.js'
import { connectorState, requestProgressFor, runConnectorCycle, writeConnectorGuide } from './connector-cycle.js'
import { RESULTS_FILE, readTextFile } from './connector-files.js'
import { parseResults } from './connector-todo.js'
import { botRow, readGrokData, rowsFromDump } from './grok-data.js'
import { routineBoard, type RoutineBoard } from './routine-board.js'
import { writeProfileAsk } from './profile-asks.js'
import { REQUESTS_PATH, addAlsoChange, addManagerChange, addRequest, canDelete, canRequest, canUpdate, dropRequests, fulfilledSeats, parseRequests, requestStats, serializeRequests, stillInGrok, type GrokRequest, type ReportedBot } from './grok-requests.js'

export const TEMPLATE_HOST = '127.0.0.1'
export const DEFAULT_ORG_SLUG = 'your-company'
const MAX_BODY = 100_000

export function orgsDirFromEnv(): string {
  return resolve(process.env.ORGS_DIR || resolve(process.cwd(), 'orgs'))
}

export function orgExists(root: string): boolean {
  return existsSync(resolve(root, 'org.md')) || existsSync(resolve(root, 'org.json'))
}

export function readOrgDir(root: string, id: string): { ok: true; bundle: OrgBundle } | { ok: false; errors: string[] } {
  try {
    const hasOrg = existsSync(resolve(root, 'org.md'))
    const hasWork = existsSync(resolve(root, 'work-chart.md'))
    const hasJson = existsSync(resolve(root, 'org.json'))
    if (hasOrg && (hasWork || !hasJson)) return readMarkdownOrg(root, id)
    return readJsonOrg(root, id)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not read the organization.'
    return { ok: false, errors: [reason] }
  }
}

type OrgRead = ReturnType<typeof readOrgDir>

/**
 * Reads each org folder of the project at most once, for the life of one request: the project view, the account, and
 * the retired list each ask about every org. Callers only read the bundles. `known` holds orgs the caller already read.
 */
function orgReader(orgsDir: string, known: Record<string, OrgRead> = {}): (orgId: string) => OrgRead {
  const reads = new Map(Object.entries(known))
  return (orgId) => {
    let read = reads.get(orgId)
    if (!read) {
      read = readOrgDir(resolve(orgsDir, orgId), orgId)
      reads.set(orgId, read)
    }
    return read
  }
}

function readSeats(root: string, id: string, errors: string[]): SeatDocument[] {
  const seatDir = resolve(root, 'seats')
  const seats: SeatDocument[] = []
  if (!existsSync(seatDir)) errors.push(`${id}/seats: folder is missing.`)
  else {
    for (const file of readdirSync(seatDir).filter((name) => name.endsWith('.md'))) {
      const slug = file.slice(0, -3)
      let parsed: ReturnType<typeof parseSeatMarkdown>
      try {
        parsed = parseSeatMarkdown(slug, readText(resolve(seatDir, file)))
      } catch (error) {
        errors.push(`${id}/seats/${file}: ${error instanceof Error ? error.message : 'could not read this file.'}`)
        continue
      }
      if (!parsed.ok) errors.push(...parsed.errors)
      else seats.push(parsed.seat)
    }
  }
  return seats
}

function adoptUnlistedSeats(org: OrgDocument, seats: SeatDocument[]) {
  const listed = new Set(org.seats.map((seat) => seat.slug))
  for (const seat of seats) {
    if (listed.has(seat.slug)) continue
    org.seats.push({ slug: seat.slug, reportsTo: seat.reportsTo || null })
    listed.add(seat.slug)
  }
}

function readActivity(root: string, id: string, errors: string[]): FileActivity[] {
  const events: FileActivity[] = []
  const seen = new Set<string>()
  const logDir = resolve(root, 'log')
  if (existsSync(logDir)) {
    for (const file of readdirSync(logDir).filter((name) => name.endsWith('.md') && !isRunLogName(name)).sort()) {
      let parsed: ReturnType<typeof parseLogMarkdown>
      try {
        parsed = parseLogMarkdown(readText(resolve(logDir, file)), `log/${file}`)
      } catch {
        continue
      }
      if (!parsed.ok) continue
      const event = { ...parsed.event, orgId: id }
      const problems = validateActivity(event, id)
      if (problems.length) errors.push(...problems.map((problem) => problem.replace('activity.jsonl:', `log/${file}:`)))
      else if (!seen.has(event.id)) {
        seen.add(event.id)
        events.push(event)
      }
    }
  }
  const activityPath = resolve(root, 'activity.jsonl')
  if (existsSync(activityPath)) {
    const parsed = parseActivityLog(readText(activityPath), id)
    if (!parsed.ok) errors.push(...parsed.errors)
    else {
      for (const event of parsed.events) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        events.push(event)
      }
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
}

function finishRead(id: string, org: OrgDocument, seats: SeatDocument[], work: WorkDocument, activity: FileActivity[], errors: string[], root = '') {
  const founder = seats.length === 0 && !errors.some((error) => error.includes('.md')) ? founderFromChart(org) : null
  const nextSeats = founder ? [founder] : seats
  const nextErrors = founder ? errors.filter((error) => !error.endsWith('/seats: folder is missing.')) : errors
  adoptUnlistedSeats(org, nextSeats)
  const loaded = root ? readProcessDir(root) : { processes: [] as ProcessFile[], notes: [] as string[] }
  const bundle = bundleFromState(id, org, nextSeats, work, activity)
  bundle.processes = loaded.processes
  bundle.fallbackProcess = org.fallbackProcess?.trim() || 'triage'
  bundle.processNotes = loaded.notes
  nextErrors.push(...validateBundle(bundle))
  if (nextErrors.length) return { ok: false as const, errors: nextErrors }
  return { ok: true as const, bundle }
}

function readMarkdownOrg(root: string, id: string): { ok: true; bundle: OrgBundle } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const parsedOrg = parseOrgMarkdown(readText(resolve(root, 'org.md')))
  if (!parsedOrg.ok) return parsedOrg
  const workPath = resolve(root, 'work-chart.md')
  let work: WorkDocument
  if (!existsSync(workPath)) {
    work = blankWork(parsedOrg.org.seats[0]?.slug || 'you')
  } else {
    const parsedWork = parseWorkMarkdown(readText(workPath))
    if (!parsedWork.ok) return parsedWork
    work = parsedWork.work
  }
  const seats = readSeats(root, id, errors)
  const activity = readActivity(root, id, errors)
  return finishRead(id, parsedOrg.org, seats, work, activity, errors, root)
}

function readJsonOrg(root: string, id: string): { ok: true; bundle: OrgBundle } | { ok: false; errors: string[] } {
  const errors: string[] = []
  let org: OrgDocument
  let work: WorkDocument
  try {
    org = JSON.parse(readText(resolve(root, 'org.json'))) as OrgDocument
  } catch {
    return { ok: false, errors: [`${id}/org.json: could not read organization data.`] }
  }
  try {
    work = JSON.parse(readText(resolve(root, 'workchart.json'))) as WorkDocument
  } catch {
    return { ok: false, errors: [`${id}/workchart.json: could not read the work chart.`] }
  }
  const seats = readSeats(root, id, errors)
  const activity = readActivity(root, id, errors)
  return finishRead(id, org, seats, work, activity, errors, root)
}

export function writeOrgDir(root: string, bundle: OrgBundle): { errors: string[]; files: string[]; retired: SeatDocument[] } {
  const kept = keepOmittedSeats(root, bundle)
  if (kept.errors.length) return { errors: kept.errors, files: [], retired: [] }
  const ordered = bundleFromState(bundle.id, kept.bundle.org, kept.bundle.seats, kept.bundle.work, kept.bundle.activity)
  const errors = validateBundle(ordered)
  if (errors.length) return { errors, files: [], retired: [] }
  mkdirSync(resolve(root, 'seats'), { recursive: true })
  const prior = readOrgProfile(root, ordered.org, ordered.seats)
  const counts = seatCounts(ordered.seats)
  const profile = {
    ...prior,
    name: ordered.org.company.name,
    description: ordered.org.company.tagline ?? prior.description,
    industry: ordered.org.company.industry ?? prior.industry,
    people: counts.people,
    bots: counts.bots,
  }
  const files = ['org.md', 'work-chart.md']
  writeFileSync(resolve(root, 'org.md'), serializeOrgMarkdown(ordered.org, profile))
  writeFileSync(resolve(root, 'work-chart.md'), serializeWorkMarkdown(ordered.work))
  for (const seat of ordered.seats) {
    if (!SEAT_SLUG.test(seat.slug)) return { errors: [`Refusing to write seat ${seat.slug}.`], files: [], retired: [] }
    const path = seatFile(root, seat.slug)
    if (!path) return { errors: [`Refusing to write seat ${seat.slug}.`], files: [], retired: [] }
    writeFileSync(path, seat.source.endsWith('\n') ? seat.source : `${seat.source}\n`)
    files.push(`seats/${seat.slug}.md`)
  }
  files.push(...ensureLogs(root, ordered.activity))
  for (const legacy of ['org.json', 'workchart.json', 'activity.jsonl']) {
    const path = resolve(root, legacy)
    if (existsSync(path)) unlinkSync(path)
  }
  return { errors: [], files, retired: kept.retired }
}

/** Writes one log event. With replace, an event with the same id is rewritten in place (the Connector's line for the day). */
export function appendActivity(root: string, event: FileActivity, replace = false): { errors: string[]; files: string[] } {
  const errors = validateActivity(event, event.orgId)
  if (errors.length) return { errors, files: [] }
  const files = ensureLogs(root, [event], replace)
  return { errors: [], files }
}

function ensureLogs(root: string, events: FileActivity[], replace = false): string[] {
  if (!events.length) return []
  const dir = resolve(root, 'log')
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  const used = new Set(existsSync(dir) ? readdirSync(dir) : [])
  for (const event of events) {
    const existing = [...used].find((name) => {
      if (!name.endsWith('.md') || isRunLogName(name)) return false
      try {
        const parsed = parseLogMarkdown(readText(resolve(dir, name)), name)
        return parsed.ok && parsed.event.id === event.id
      } catch {
        return false
      }
    })
    const name = existing ?? freeLogName(event.id, used)
    const rel = `log/${name}`
    if (existing && replace) {
      writeFileSync(resolve(dir, name), serializeLogMarkdown(event))
      files.push(rel)
    } else if (!existing) {
      writeFileSync(resolve(dir, name), serializeLogMarkdown(event))
      used.add(name)
      files.push(rel)
    }
  }
  return files
}

function freeLogName(id: string, used: Set<string>): string {
  const base = logFileName(id).replace(/\.md$/, '')
  if (!used.has(`${base}.md`)) return `${base}.md`
  for (let n = 2; n < 100; n += 1) {
    const name = `${base}-${n}.md`
    if (!used.has(name)) return name
  }
  return `${base}-${Date.now()}.md`
}

export function listOrgSlugs(orgsDir: string): string[] {
  if (!existsSync(orgsDir)) return []
  return readdirSync(orgsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SEAT_SLUG.test(entry.name) && orgExists(resolve(orgsDir, entry.name)))
    .map((entry) => entry.name)
    .sort()
}

export function createOrgFiles(orgsDir: string, name: string, owner: string): { ok: true; slug: string } | { ok: false; errors: string[] } {
  if (!name.trim()) return { ok: false, errors: ['Org name is required.'] }
  const slug = uniqueOrgId(orgsDir)
  const ownerName = owner.trim()
  if (!ownerName) return { ok: false, errors: ['Owner name is required.'] }
  const root = resolve(orgsDir, slug)
  const seat = blankSeat(ownerName)
  const work = blankWork(seat.slug)
  const bundle: OrgBundle = {
    id: slug,
    org: {
      company: { name: name.trim(), tagline: '', industry: '', mark: initials(name), markColor: '#111111' },
      departments: [{ id: 'general', name: 'General' }],
      people: [{ id: `person-${seat.slug}`, name: ownerName, title: 'Owner', department: 'general' }],
      seats: [{ slug: seat.slug, reportsTo: null }],
    },
    seats: [{ ...seat, personId: `person-${seat.slug}` }],
    work,
    activity: [],
  }
  bundle.seats[0]!.source = serializeSeat(bundle.seats[0]!)
  const written = writeOrgDir(root, bundle)
  if (written.errors.length) return { ok: false, errors: written.errors }
  writeOrgProfile(root, profileFromOrg(bundle.org, bundle.seats))
  return { ok: true, slug }
}

export function readOrgProfile(root: string, org: OrgDocument, seats: SeatDocument[]): OrgProfile {
  const path = resolve(root, 'org.md')
  if (!existsSync(path)) return profileFromOrg(org, seats)
  const parsed = parseOrgProfile(readText(path))
  return parsed.ok ? parsed.profile : profileFromOrg(org, seats)
}

export function writeOrgProfile(root: string, profile: OrgProfile): { ok: true } | { ok: false; errors: string[] } {
  const parsed = parseOrgProfile(serializeOrgProfile(profile))
  if (!parsed.ok) return parsed
  if (!parsed.profile.name.trim()) return { ok: false, errors: ['org.md: name is required.'] }
  mkdirSync(root, { recursive: true })
  const current = existsSync(resolve(root, 'org.md')) ? readText(resolve(root, 'org.md')) : ''
  const structured = current.includes('\n## Chart') || current.startsWith('## Chart') ? parseOrgMarkdown(current) : null
  if (structured?.ok) {
    const org: OrgDocument = {
      ...structured.org,
      company: {
        ...structured.org.company,
        name: parsed.profile.name.trim(),
        tagline: parsed.profile.description.trim(),
        industry: parsed.profile.industry.trim(),
        mark: initials(parsed.profile.name),
      },
    }
    writeFileSync(resolve(root, 'org.md'), serializeOrgMarkdown(org, parsed.profile))
  } else {
    writeFileSync(resolve(root, 'org.md'), serializeOrgProfile(parsed.profile))
  }
  return { ok: true }
}

export function copyTemplateOrg(
  orgsDir: string,
  samplesDir: string,
  templateSlug: string,
  name?: string,
): { ok: true; slug: string } | { ok: false; errors: string[] } {
  if (!SEAT_SLUG.test(templateSlug)) return { ok: false, errors: ['Template slug is not valid.'] }
  const sampleRoot = resolve(samplesDir, templateSlug)
  if (!existsSync(resolve(sampleRoot, 'org.json'))) return { ok: false, errors: ['That template is not on this computer.'] }
  const read = readOrgDir(sampleRoot, templateSlug)
  if (!read.ok) return read
  const companyName = name?.trim() || read.bundle.org.company.name
  const slug = uniqueOrgId(orgsDir)
  const root = resolve(orgsDir, slug)
  const org: OrgDocument = {
    ...read.bundle.org,
    company: { ...read.bundle.org.company, name: companyName, mark: initials(companyName) },
  }
  const copied = importOrgBundle(root, slug, { ...read.bundle, org, id: slug })
  if (!copied.ok) return { ok: false, errors: copied.errors }
  const profile = readOrgProfile(sampleRoot, org, read.bundle.seats)
  writeOrgProfile(root, { ...profile, name: companyName })
  return { ok: true, slug }
}

export function orgZip(root: string, slug: string): { ok: true; body: Buffer; filename: string } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, slug)
  if (!read.ok) return read
  const profile = readOrgProfile(root, read.bundle.org, read.bundle.seats)
  const files: { name: string; data: Buffer }[] = [
    { name: 'org.md', data: Buffer.from(serializeOrgMarkdown(read.bundle.org, profile)) },
    { name: 'work-chart.md', data: Buffer.from(serializeWorkMarkdown(read.bundle.work)) },
  ]
  for (const event of read.bundle.activity) {
    files.push({ name: `log/${logFileName(event.id)}`, data: Buffer.from(serializeLogMarkdown(event)) })
  }
  for (const seat of read.bundle.seats) {
    files.push({ name: `seats/${seat.slug}.md`, data: Buffer.from(seat.source.endsWith('\n') ? seat.source : `${seat.source}\n`) })
  }
  // The rest of the organization, as the files are on disk. The snapshot stays out: the Connector rewrites it every run.
  const processDir = resolve(root, 'processes')
  if (existsSync(processDir)) {
    for (const name of readdirSync(processDir).filter((file) => file.endsWith('.md') && SEAT_SLUG.test(file.slice(0, -3))).sort()) {
      try {
        files.push({ name: `processes/${name}`, data: Buffer.from(readText(resolve(processDir, name))) })
      } catch {
        // An unreadable process file is left out rather than stopping the backup.
      }
    }
  }
  const logDir = resolve(root, 'log')
  if (existsSync(logDir)) {
    for (const name of readdirSync(logDir).filter((file) => isRunLogName(file)).sort()) {
      try {
        files.push({ name: `log/${name}`, data: Buffer.from(readText(resolve(logDir, name))) })
      } catch {
        // Same for a run log.
      }
    }
  }
  // Bots waiting to be created in Grok Bot. A file the app cannot read is left out.
  const waiting = readRequests(root)
  if (!waiting.error && existsSync(resolve(root, REQUESTS_PATH))) files.push({ name: REQUESTS_PATH, data: Buffer.from(serializeRequests(waiting.requests)) })
  files.push({ name: BACKUP_NOTE, data: Buffer.from(`${JSON.stringify({ app: 'BotsEverywhere', version: 2, exportedAt: new Date().toISOString(), includes: ['processes', 'runLogs', 'requests'] }, null, 2)}\n`) })
  return { ok: true, body: zipStore(files), filename: `${slug}.zip` }
}

/** Says the zip is a full backup, so Import replaces processes and run logs too. Older zips have no note. */
const BACKUP_NOTE = 'backup.json'

interface BackupExtras {
  processes?: { slug: string; source: string }[]
  runLogs?: { name: string; source: string }[]
  /** Bots waiting to be created. Undefined keeps the requests here, as a backup from before they were saved does. */
  requests?: GrokRequest[]
}

function keepOmittedSeats(root: string, bundle: OrgBundle): { bundle: OrgBundle; errors: string[]; retired: SeatDocument[] } {
  const seatDir = resolve(root, 'seats')
  if (!existsSync(seatDir)) return { bundle, errors: [], retired: [] }
  const known = new Set(bundle.seats.map((seat) => seat.slug))
  const extras: SeatDocument[] = []
  const retiredNow: SeatDocument[] = []
  const errors: string[] = []
  for (const file of readdirSync(seatDir)) {
    if (!file.endsWith('.md')) continue
    const slug = file.slice(0, -3)
    if (known.has(slug)) continue
    const parsed = parseSeatMarkdown(slug, readText(resolve(seatDir, file)))
    if (!parsed.ok) {
      errors.push(...parsed.errors)
      errors.push(`${slug}.md: seat files are kept. Retire the seat instead of deleting it.`)
      continue
    }
    if (parsed.seat.kind === 'human' || parsed.seat.status === 'retired') {
      extras.push(parsed.seat)
      continue
    }
    const retired: SeatDocument = {
      ...parsed.seat,
      status: 'retired',
      retiredAt: parsed.seat.retiredAt || new Date().toISOString(),
      source: '',
    }
    retired.source = serializeSeat(retired)
    extras.push(retired)
    retiredNow.push(retired)
  }
  if (!extras.length) return { bundle, errors, retired: retiredNow }
  const seats = [...bundle.seats, ...extras]
  return {
    bundle: {
      ...bundle,
      seats,
      org: {
        ...bundle.org,
        seats: seats.map((seat) => ({ slug: seat.slug, reportsTo: seat.reportsTo || null })),
      },
    },
    errors,
    retired: retiredNow,
  }
}

export interface HiredSeatInput {
  name?: string
  kind?: string
  directorySlug?: string
  slug?: string
  reportsTo?: string
  addToGrokBotUrl?: string
  owns?: unknown
  may?: unknown
  mustAskBefore?: unknown
  doneWhen?: unknown
  stepId?: string
}

export function createHiredSeat(
  root: string,
  orgId: string,
  input: HiredSeatInput,
): { ok: true; slug: string; file: string } | { ok: false; errors: string[] } {
  if (!orgExists(root)) return { ok: false, errors: ['Org not found.'] }
  const unsafe = [input.directorySlug, input.slug, input.reportsTo].some((value) => unsafePath(value))
  if (unsafe) return { ok: false, errors: ['That name is not a safe file name.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const kind = input.kind === 'human' || input.kind === 'system' ? input.kind : 'bot'
  const name = (input.name || '').trim()
  if (!name) return { ok: false, errors: ['Seat name is required.'] }
  const explicit = (input.slug || '').trim()
  const directorySlug = (input.directorySlug || '').trim()
  if (explicit && !SEAT_SLUG.test(explicit)) return { ok: false, errors: ['Seat slug must be lowercase letters, numbers, and hyphens.'] }
  if (directorySlug && !SEAT_SLUG.test(directorySlug)) return { ok: false, errors: ['directorySlug must be a lowercase slug.'] }
  const base = explicit || (SEAT_SLUG.test(directorySlug) ? directorySlug : slugify(name))
  if (!base || !SEAT_SLUG.test(base)) return { ok: false, errors: ['Pick a seat name that becomes a file name.'] }
  const slug = nextFreeSeatSlug(root, base)
  if (!slug) return { ok: false, errors: ['Could not pick a free file name for that seat.'] }
  const reportsTo = (input.reportsTo || '').trim()
  if (reportsTo && !SEAT_SLUG.test(reportsTo)) return { ok: false, errors: ['reportsTo must be a seat slug.'] }
  if (reportsTo && !read.bundle.seats.some((seat) => seat.slug === reportsTo)) {
    return { ok: false, errors: [`${reportsTo} is not a seat in this org.`] }
  }
  const greyedManager = read.bundle.seats.find((seat) => seat.slug === reportsTo && isGreyed(seat))
  if (reportsTo && greyedManager) return { ok: false, errors: [greyedManagerText(greyedManager.title)] }
  const addToGrokBotUrl = (input.addToGrokBotUrl || '').trim()
  const card = {
    owns: lineList(input.owns),
    may: lineList(input.may),
    mustAskBefore: lineList(input.mustAskBefore),
    doneWhen: lineList(input.doneWhen),
  }
  const draft: SeatDocument = {
    slug,
    title: name,
    department: 'general',
    reportsTo,
    addToGrokBotUrl,
    status: 'active',
    kind,
    role: name,
    personId: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: kind === 'bot' ? directorySlug : '',
    ...card,
    source: '',
  }
  const cardErrors = activeBotCardErrors(draft)
  if (cardErrors.length) return { ok: false, errors: cardErrors }
  const written = serializeHiredSeat({
    name,
    kind,
    directorySlug: draft.directoryId,
    reportsTo,
    addToGrokBotUrl,
    ...card,
  })
  const check = parseSeatMarkdown(slug, written)
  if (!check.ok) return check
  const path = seatFile(root, slug)
  if (!path) return { ok: false, errors: [`Refusing to write seat ${slug}.`] }
  if (existsSync(path)) return { ok: false, errors: [`Refusing to overwrite seats/${slug}.md.`] }
  mkdirSync(resolve(root, 'seats'), { recursive: true })
  writeFileSync(path, written)
  const linked = linkSeatOnChart(root, slug, reportsTo, kind)
  if (!linked.ok) return linked
  if (input.stepId) assignWorkStep(root, input.stepId, slug)
  const hiredAt = new Date().toISOString()
  const actor = managerSeat(read.bundle.seats)?.slug || slug
  appendActivity(root, {
    id: `hire-${slug}`,
    orgId,
    type: 'hire',
    actorSeatId: actor,
    actorType: 'human',
    timestamp: hiredAt,
    summary: `Hired ${name}`,
    subjectSeatId: slug,
    stepId: input.stepId || undefined,
  })
  return { ok: true, slug, file: `orgs/${orgId}/seats/${slug}.md` }
}

export interface ExistingBotInput {
  name?: string
  /** When set, this file name is used if it is free. A taken name still becomes `<slug>-2`. */
  slug?: string
  grokBotUrl?: string
  reportsTo?: string
  owns?: unknown
  may?: unknown
  mustAskBefore?: unknown
  doneWhen?: unknown
  createdAt?: string
  lastActive?: string
  runs30d?: number
  tasksDone30d?: number
  routines?: SeatDocument['routines']
  skills?: SeatDocument['skills']
  apps?: string[]
  publicUrl?: string
  botStatus?: SeatDocument['botStatus']
  /** Set by Sync with Grok Bot when the seat comes from a snapshot. */
  grokSync?: GrokSyncState
  grokSyncedAt?: string
  /** Bots-file import may omit card sections. The Add existing bot form still requires them. */
  allowEmptyCard?: boolean
  /** Add anyway: the bot may stay active in another organization too. Only the main bot should. */
  allowOtherOrgs?: boolean
  /** The bot works in another organization: the seat is greyed, with the link in elsewhereUrl. */
  greyed?: boolean
  /** The greyed seat this one's own text names as its manager. */
  waitsFor?: string
}

/**
 * Writes one seat for a bot the user already has. A taken slug is saved as `<slug>-2`. A bot active in another
 * organization is refused with `otherOrgs`, unless added anyway; `elsewhere` saves a caller adding many bots a read per bot.
 */
export function createExistingBot(
  root: string,
  orgId: string,
  input: ExistingBotInput,
  elsewhere?: Map<string, string[]>,
  mainBot?: string,
): { ok: true; slug: string; file: string } | { ok: false; errors: string[]; otherOrgs?: string[] } {
  if (!orgExists(root)) return { ok: false, errors: ['Org not found.'] }
  const unsafe = [input.reportsTo, input.slug].some((value) => unsafePath(value))
  if (unsafe) return { ok: false, errors: ['That name is not a safe file name.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const name = (input.name || '').trim()
  if (!name) return { ok: false, errors: ['Bot name is required.'] }
  const explicit = (input.slug || '').trim()
  if (explicit && !SEAT_SLUG.test(explicit)) return { ok: false, errors: ['Seat slug must be lowercase letters, numbers, and hyphens.'] }
  const base = explicit || slugify(name)
  if (!base || !SEAT_SLUG.test(base)) return { ok: false, errors: ['Pick a bot name that becomes a file name.'] }
  const slug = nextFreeSeatSlug(root, base)
  if (explicit && slug !== explicit) return { ok: false, errors: [`Refusing to overwrite seats/${explicit}.md.`] }
  if (!slug) return { ok: false, errors: ['Could not pick a free file name for that seat.'] }
  const grokBotUrl = (input.grokBotUrl || '').trim()
  if (!isSeatGrokLink(grokBotUrl)) return { ok: false, errors: ['Grok Bot link must be an http, https, or grokbot:// link.'] }
  if (grokBotUrl && input.allowOtherOrgs !== true && input.greyed !== true && !isConnectorName(name) && botKey(grokBotUrl) !== (mainBot ?? readMainBot(dirname(root)))) {
    const otherOrgs = (elsewhere ?? botsInOtherOrgs(dirname(root), orgId)).get(botKey(grokBotUrl)) ?? []
    if (otherOrgs.length) return { ok: false, errors: [inOtherOrgsText(name, otherOrgs)], otherOrgs }
  }
  const waitsFor = (input.waitsFor || '').trim()
  if (waitsFor && !SEAT_SLUG.test(waitsFor)) return { ok: false, errors: ['waitsFor must be a seat slug.'] }
  // A greyed seat keeps its link apart, so nothing that talks to Grok Bot treats it as this organization's bot.
  const greyedLink = input.greyed === true && grokBotUrl ? grokBotUrl : ''
  const seatLink = greyedLink ? '' : grokBotUrl
  let reportsTo = (input.reportsTo || '').trim()
  if (!reportsTo) {
    const you = managerSeat(read.bundle.seats)
    if (!you) return { ok: false, errors: ['Reports to is required.'] }
    reportsTo = you.slug
  }
  if (!SEAT_SLUG.test(reportsTo)) return { ok: false, errors: ['reportsTo must be a seat slug.'] }
  if (!read.bundle.seats.some((seat) => seat.slug === reportsTo)) {
    return { ok: false, errors: [`${reportsTo} is not a seat in this org.`] }
  }
  // A bot that works here never reports to a greyed one. A greyed one may: neither gets a block.
  const greyedManager = read.bundle.seats.find((seat) => seat.slug === reportsTo && isGreyed(seat))
  if (greyedManager && input.greyed !== true) return { ok: false, errors: [greyedManagerText(greyedManager.title)] }
  const card = {
    owns: lineList(input.owns),
    may: lineList(input.may),
    mustAskBefore: lineList(input.mustAskBefore),
    doneWhen: lineList(input.doneWhen),
  }
  const draft: SeatDocument = {
    slug,
    title: name,
    department: 'general',
    reportsTo,
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'bot',
    role: name,
    personId: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    seatOrigin: 'existing',
    grokBotUrl: seatLink,
    ...(greyedLink ? { elsewhereUrl: greyedLink } : {}),
    ...(waitsFor ? { waitsFor } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.lastActive ? { lastActive: input.lastActive } : {}),
    ...(input.runs30d !== undefined ? { runs30d: input.runs30d } : {}),
    ...(input.tasksDone30d !== undefined ? { tasksDone30d: input.tasksDone30d } : {}),
    ...(input.routines?.length ? { routines: input.routines } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    ...(input.apps?.length ? { apps: input.apps } : {}),
    ...(input.publicUrl ? { publicUrl: input.publicUrl } : {}),
    ...(input.botStatus ? { botStatus: input.botStatus } : {}),
    ...(input.grokSync ? { grokSync: input.grokSync } : {}),
    ...(input.grokSyncedAt ? { grokSyncedAt: input.grokSyncedAt } : {}),
    ...card,
    source: '',
  }
  const cardErrors = input.allowEmptyCard ? [] : activeBotCardErrors(draft)
  if (cardErrors.length) return { ok: false, errors: cardErrors }
  const written = serializeExistingSeat({
    name,
    grokBotUrl: seatLink,
    elsewhereUrl: greyedLink,
    waitsFor,
    reportsTo,
    ...card,
    createdAt: input.createdAt,
    lastActive: input.lastActive,
    runs30d: input.runs30d,
    tasksDone30d: input.tasksDone30d,
    routines: input.routines,
    skills: input.skills,
    apps: input.apps,
    publicUrl: input.publicUrl,
    botStatus: input.botStatus,
    grokSync: input.grokSync,
    grokSyncedAt: input.grokSyncedAt,
  })
  const check = parseSeatMarkdown(slug, written)
  if (!check.ok) return check
  const path = seatFile(root, slug)
  if (!path) return { ok: false, errors: [`Refusing to write seat ${slug}.`] }
  if (existsSync(path)) return { ok: false, errors: [`Refusing to overwrite seats/${slug}.md.`] }
  mkdirSync(resolve(root, 'seats'), { recursive: true })
  writeFileSync(path, written)
  const linked = linkSeatOnChart(root, slug, reportsTo, 'bot')
  if (!linked.ok) return linked
  const addedAt = new Date().toISOString()
  const actor = managerSeat(read.bundle.seats)?.slug || reportsTo
  appendActivity(root, {
    id: `existing-${slug}`,
    orgId,
    type: 'hire',
    actorSeatId: actor,
    actorType: 'human',
    timestamp: addedAt,
    summary: `Added existing bot ${name}`,
    subjectSeatId: slug,
  })
  return { ok: true, slug, file: `orgs/${orgId}/seats/${slug}.md` }
}

function managerSeat(seats: SeatDocument[]): SeatDocument | undefined {
  const active = seats.filter((seat) => seat.status !== 'retired')
  return active.find((seat) => seat.title.trim().toLowerCase() === 'you')
    ?? active.find((seat) => seat.slug === 'you')
    ?? active.find((seat) => seat.kind === 'human')
}

export interface BotsFileResult {
  imported: { name: string; slug: string; file: string }[]
  errors: { name: string; error: string }[]
  /** Imported, with something changed on the way, such as a manager that is not here. */
  notes: { name: string; note: string }[]
  /** Imported greyed: the bot works in these other organizations. */
  greyed: { name: string; slug: string; orgs: string[] }[]
}

/** Writes a seat's extra managers on the line after reportsTo, or takes the line out when there are none. */
function writeAlsoLine(root: string, slug: string, also: string[]): { ok: true } | { ok: false; errors: string[] } {
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const without = readText(path).replace(/^alsoReportsTo:.*\n?/m, '')
  const nextSource = also.length ? without.replace(/^(reportsTo:.*)$/m, `$1\nalsoReportsTo: ${quote(JSON.stringify(also))}`) : without
  const checked = parseSeatMarkdown(slug, nextSource)
  if (!checked.ok) return checked
  writeFileSync(path, nextSource.endsWith('\n') ? nextSource : `${nextSource}\n`)
  return { ok: true }
}

/**
 * Writes one seat file per bot. Pass 1 creates every file. Pass 2 points
 * reportsTo at other bots from this same file, which did not exist yet in pass 1.
 * A slug that is already on disk is saved as `<slug>-2` and the first file is left alone.
 * A manager that is not here places the bot under You with a note; extra managers are written last.
 * `orgsDir` is where the other organizations and the main bot are read; a preview passes it for a copy of the org.
 */
export function importBotsFile(
  root: string,
  orgId: string,
  rows: BotsFileRow[],
  stamp?: { grokSync: GrokSyncState; grokSyncedAt: string },
  orgsDir = dirname(root),
): BotsFileResult {
  if (!orgExists(root)) return { imported: [], errors: [{ name: 'File', error: 'Org not found.' }], notes: [], greyed: [] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return { imported: [], errors: read.errors.map((error) => ({ name: 'File', error })), notes: [], greyed: [] }
  const existing = read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title }))
  const taken = new Set(existing.map((seat) => seat.slug))
  const errors: { name: string; error: string }[] = []
  const notes: { name: string; note: string }[] = []
  const homes = new Map<string, HomeManagers>()
  const elsewhere = botsInOtherOrgs(orgsDir, orgId, [], homes)
  const mainBot = readMainBot(orgsDir)
  // A bot active in another organization comes in greyed. The Connector and the main bot belong in every organization.
  const otherOrgsOf = (row: BotsFileRow): string[] => {
    const key = botKey(row.grokBotUrl ?? '')
    return !key || key === mainBot || isConnectorName(row.name) ? [] : elsewhere.get(key) ?? []
  }
  // A greyed bot keeps the managers the owner gave it where it works, over who its own text names.
  const homeOf = (row: BotsFileRow): HomeManagers | undefined => (otherOrgsOf(row).length ? homes.get(botKey(row.grokBotUrl ?? '')) : undefined)
  const ready = rows.filter((row) => {
    if (!row.error) return true
    errors.push({ name: row.name, error: row.error })
    return false
  })
  const planned = ready.map((row) => ({ row, slug: reserveSeatSlug(root, slugify(row.name), taken) }))
  for (const item of planned) {
    if (item.slug) continue
    errors.push({ name: item.row.name, error: 'Could not pick a free file name for that seat.' })
  }
  const greyedSlugs = new Set([
    ...read.bundle.seats.filter((seat) => isGreyed(seat)).map((seat) => seat.slug),
    ...planned.flatMap((item) => (item.slug && otherOrgsOf(item.row).length ? [item.slug] : [])),
  ])
  const batch = new Map<string, string>()
  for (const item of planned) {
    if (!item.slug) continue
    batch.set(item.row.name.trim().toLowerCase(), item.slug)
    batch.set(item.slug, item.slug)
  }
  // Seats here and in this file by Grok Bot id, so a manager from another organization is found by id, never by name.
  const byKey = new Map<string, string>()
  for (const seat of read.bundle.seats) {
    for (const link of [seat.grokBotUrl, seat.elsewhereUrl]) if (botKey(link ?? '')) byKey.set(botKey(link ?? ''), seat.slug)
  }
  for (const item of planned) if (item.slug && botKey(item.row.grokBotUrl ?? '')) byKey.set(botKey(item.row.grokBotUrl ?? ''), item.slug)
  const youHere = resolveManager('You', '', existing, batch)
  const hereSlug = (manager: HomeManager): string | undefined => (manager.key ? byKey.get(manager.key) : youHere.ok ? youHere.slug : undefined)
  const writes: { row: BotsFileRow; slug: string; manager: string; managerName: string; managerIsNew: boolean; waitsFor?: string }[] = []
  for (const item of planned) {
    if (!item.slug) continue
    const home = homeOf(item.row)?.reportsTo
    const homeSlug = home ? hereSlug(home) : undefined
    const managerName = homeSlug && home ? home.name : item.row.reportsTo.trim()
    const resolved = resolveManager(homeSlug ?? item.row.reportsTo, item.row.name, existing, batch)
    if (resolved.ok && greyedSlugs.has(resolved.slug) && !greyedSlugs.has(item.slug)) {
      // A bot that works here never reports to a greyed one: it waits under You and moves under it once that bot works
      // here. A greyed bot may: neither gets a block.
      const you = resolveManager('You', item.row.name, existing, batch)
      if (you.ok) {
        notes.push({ name: item.row.name, note: `${managerName} works in another organization; placed under You until it works here.` })
        writes.push({ row: item.row, slug: item.slug, manager: you.slug, managerName: 'You', managerIsNew: false, waitsFor: resolved.slug })
        continue
      }
    }
    if (!resolved.ok) {
      // A manager from another copy, or one never added here, never costs the bot its seat: it goes under You.
      const you = resolveManager('You', item.row.name, existing, batch)
      if (!you.ok) {
        errors.push({ name: item.row.name, error: resolved.error })
        batch.delete(item.row.name.trim().toLowerCase())
        batch.delete(item.slug)
        continue
      }
      const missing = resolved.error.endsWith('is not a seat in this org or in this file.')
      notes.push({ name: item.row.name, note: missing ? `${item.row.reportsTo.trim()} is not a seat here; placed under You.` : `${resolved.error.replace(/\.$/, '')}; placed under You.` })
      writes.push({ row: item.row, slug: item.slug, manager: you.slug, managerName: 'You', managerIsNew: false })
      continue
    }
    writes.push({ row: item.row, slug: item.slug, manager: resolved.slug, managerName, managerIsNew: resolved.isNew })
  }
  const dropped = new Set(writes.filter((item) => item.managerIsNew && !writes.some((other) => other.slug === item.manager)).map((item) => item.slug))
  const imported: { name: string; slug: string; file: string }[] = []
  const greyed: BotsFileResult['greyed'] = []
  for (const item of writes) {
    if (dropped.has(item.slug)) {
      errors.push({ name: item.row.name, error: `Reports to a bot that was not imported.` })
      continue
    }
    const otherOrgs = otherOrgsOf(item.row)
    // A greyed seat keeps its card but none of Grok Bot's numbers: those belong to the organization it works for.
    const numbers = otherOrgs.length ? {} : {
      createdAt: item.row.createdAt,
      lastActive: item.row.lastActive,
      runs30d: item.row.runs30d,
      tasksDone30d: item.row.tasksDone30d,
      routines: item.row.routines,
      skills: item.row.skills,
      apps: item.row.apps,
      publicUrl: item.row.publicUrl,
      botStatus: item.row.botStatus || undefined,
      grokSync: stamp?.grokSync,
      grokSyncedAt: stamp?.grokSyncedAt,
    }
    const created = createExistingBot(root, orgId, {
      name: item.row.name,
      slug: item.slug,
      grokBotUrl: item.row.grokBotUrl,
      reportsTo: item.managerIsNew ? '' : item.manager,
      owns: item.row.owns,
      may: item.row.may,
      mustAskBefore: item.row.needsApproval,
      doneWhen: item.row.doneWhen,
      ...numbers,
      allowEmptyCard: true,
      greyed: otherOrgs.length > 0,
      ...(item.waitsFor ? { waitsFor: item.waitsFor } : {}),
    }, elsewhere, mainBot)
    if (!created.ok) {
      errors.push({ name: item.row.name, error: created.errors.join(' ') })
      continue
    }
    imported.push({ name: item.row.name, slug: created.slug, file: created.file })
    if (otherOrgs.length) greyed.push({ name: item.row.name, slug: created.slug, orgs: otherOrgs })
  }
  const importedSlugs = new Set(imported.map((item) => item.slug))
  const placed = readOrgDir(root, orgId)
  const parent = new Map((placed.ok ? placed.bundle.seats : []).map((seat) => [seat.slug, seat.reportsTo]))
  for (const item of writes) {
    if (!item.managerIsNew || !importedSlugs.has(item.slug)) continue
    if (!importedSlugs.has(item.manager)) {
      errors.push({ name: item.row.name, error: 'Reports to a bot that was not imported.' })
      continue
    }
    // Managers read from bots' own text can point at each other: a loop would leave the organization unreadable.
    const seen = new Set<string>()
    let cursor = item.manager
    while (cursor && cursor !== item.slug && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = parent.get(cursor) || ''
    }
    if (cursor === item.slug) {
      notes.push({ name: item.row.name, note: `${item.managerName} already reports to ${item.row.name}, so this would make a loop; placed under You.` })
      continue
    }
    const pointed = retargetSeat(root, item.slug, item.manager)
    if (!pointed.ok) errors.push({ name: item.row.name, error: pointed.errors.join(' ') })
    else parent.set(item.slug, item.manager)
  }
  // Extra managers, once every imported seat exists. A name that is not here is left out; a loop is never written.
  const titles = new Map([...existing.map((seat) => [seat.title.trim().toLowerCase(), seat.slug] as const), ...imported.map((item) => [item.name.trim().toLowerCase(), item.slug] as const)])
  const seatsHere = new Set([...existing.map((seat) => seat.slug), ...importedSlugs])
  for (const item of writes) {
    const slug = imported.find((entry) => entry.name === item.row.name)?.slug
    // A greyed bot takes its extra managers from where it works too; one that is not here is left out.
    const home = homeOf(item.row)
    const named = home
      ? home.alsoReportsTo.map((manager) => {
        const target = hereSlug(manager)
        return { name: manager.name, target: target && seatsHere.has(target) ? target : undefined }
      })
      : (item.row.alsoReportsTo ?? []).map((name) => ({ name, target: titles.get(name.trim().toLowerCase()) }))
    if (!slug || !named.length) continue
    const also: string[] = []
    for (const { name, target } of named) {
      if (!target) notes.push({ name: item.row.name, note: `${name.trim()} is not a seat here; left out of Also reports to.` })
      else if (greyedSlugs.has(target) && !greyedSlugs.has(slug)) notes.push({ name: item.row.name, note: `${name.trim()} works in another organization; left out of Also reports to.` })
      else if (target !== slug && target !== item.manager && !also.includes(target)) also.push(target)
    }
    if (!also.length) continue
    const now = readOrgDir(root, orgId)
    if (now.ok && managerLoop(now.bundle.seats.map((seat) => (seat.slug === slug ? { ...seat, alsoReportsTo: also } : seat)))) {
      notes.push({ name: item.row.name, note: 'Also reports to was left out: it would make a loop.' })
      continue
    }
    const written = writeAlsoLine(root, slug, also)
    if (!written.ok) errors.push({ name: item.row.name, error: written.errors.join(' ') })
  }
  return { imported, errors, notes, greyed }
}

/**
 * What importing this file would save, without writing to the organization. The import runs on a throwaway copy of the
 * organization folder, reading the other organizations where they are, so the preview and the import can never disagree.
 */
export function previewBotsFile(orgsDir: string, root: string, orgId: string, rows: BotsFileRow[]): BotsFilePreview {
  if (!orgExists(root)) return { rows: [], errors: [{ name: 'File', error: 'Org not found.' }] }
  const scratch = mkdtempSync(resolve(tmpdir(), 'be-bots-preview-'))
  try {
    const copy = resolve(scratch, orgId)
    cpSync(root, copy, { recursive: true })
    const result = importBotsFile(copy, orgId, rows, undefined, orgsDir)
    const read = readOrgDir(copy, orgId)
    const seats = read.ok ? read.bundle.seats : []
    const title = (slug: string) => seats.find((seat) => seat.slug === slug)?.title ?? slug
    const previewRows = result.imported.map((item) => {
      const seat = seats.find((entry) => entry.slug === item.slug)
      return {
        name: item.name,
        reportsTo: seat ? title(seat.reportsTo) : '',
        alsoReportsTo: (seat?.alsoReportsTo ?? []).map(title),
        worksIn: result.greyed.find((entry) => entry.slug === item.slug)?.orgs ?? [],
        notes: result.notes.filter((entry) => entry.name === item.name).map((entry) => entry.note),
      }
    })
    return { rows: previewRows, errors: result.errors }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Builds an organization that already exists from an organization file: its departments, one seat per person, the org
 * chart, and the description, purpose, industry, and size. Only on a new organization: You and the Connector's seat.
 * The person named in you becomes the You seat; without one, You stays at the top beside the people. Nothing is written
 * when the result would not read back.
 */
export function importOrgFile(root: string, orgId: string, file: OrgFile): { ok: true; imported: { name: string; slug: string }[] } | { ok: false; errors: string[] } {
  if (!orgExists(root)) return { ok: false, errors: ['Org not found.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  if (orgImportLocked(read.bundle.seats, readMainBot(dirname(root)))) return { ok: false, errors: [ORG_IMPORT_LOCKED] }
  const people = file.people.filter((person) => !person.error)
  if (people.length === 0) return { ok: false, errors: ['No one in this file can be imported.'] }
  const org = read.bundle.org
  const departments = [...org.departments]
  const departmentId = (name: string): string => {
    const label = name.trim() || 'General'
    const known = departments.find((item) => item.name.trim().toLowerCase() === label.toLowerCase() || item.id === plainSlug(label))
    if (known) return known.id
    const base = plainSlug(label) || 'department'
    let id = base
    for (let n = 2; departments.some((item) => item.id === id); n += 1) id = `${base}-${n}`
    departments.push({ id, name: label })
    return id
  }
  for (const name of file.departments) departmentId(name)
  const you = read.bundle.seats.find((seat) => seat.slug === 'you')
  const taken = new Set(read.bundle.seats.map((seat) => seat.slug))
  const slugs = new Map<string, string>()
  for (const person of people) {
    if (you && person.name === file.you) {
      slugs.set(person.name, 'you')
      continue
    }
    const slug = reserveSeatSlug(root, plainSlug(person.name) || 'person', taken)
    if (!slug) return { ok: false, errors: [`Could not pick a free file name for ${person.name}.`] }
    slugs.set(person.name, slug)
  }
  const roster = [...org.people]
  const seats = read.bundle.seats.map((seat) => ({ ...seat }))
  const imported: { name: string; slug: string }[] = []
  for (const person of people) {
    const slug = slugs.get(person.name)!
    const department = departmentId(person.department)
    const reportsTo = person.reportsTo ? slugs.get(person.reportsTo) ?? '' : ''
    const details: Omit<OrgPerson, 'id'> = { name: person.name, department }
    const optional = { title: person.title, email: person.email, phone: person.phone, location: person.location, bio: person.about }
    for (const [key, value] of Object.entries(optional) as [keyof typeof optional, string][]) {
      if (value) details[key] = value
    }
    if (slug === 'you' && you) {
      const seat = seats.find((item) => item.slug === 'you')!
      const personId = seat.personId || 'person-you'
      const at = roster.findIndex((item) => item.id === personId)
      if (at >= 0) roster[at] = { id: personId, ...details }
      else roster.push({ id: personId, ...details })
      Object.assign(seat, { title: person.name, role: person.title || seat.role, department, reportsTo, personId, ...(person.owns.length ? { owns: person.owns } : {}) })
    } else {
      roster.push({ id: `person-${slug}`, ...details })
      seats.push({
        slug,
        title: person.name,
        department,
        reportsTo,
        addToGrokBotUrl: '',
        status: 'active',
        kind: 'human',
        role: person.title || person.name,
        personId: `person-${slug}`,
        hiredAt: '',
        retiredAt: '',
        directoryId: '',
        owns: person.owns,
        may: [],
        mustAskBefore: [],
        doneWhen: [],
        source: '',
      })
    }
    imported.push({ name: person.name, slug })
  }
  // Extra managers once every seat exists. One that would make a loop is left out.
  for (const person of people) {
    const slug = slugs.get(person.name)!
    const seat = seats.find((item) => item.slug === slug)!
    const also = [...new Set(person.alsoReportsTo.map((name) => slugs.get(name) ?? '').filter((target) => target && target !== slug && target !== seat.reportsTo))]
    if (also.length && !managerLoop(seats.map((item) => (item.slug === slug ? { ...item, alsoReportsTo: also } : item)))) seat.alsoReportsTo = also
  }
  const facts = file.organization
  const company = { ...org.company, tagline: facts.description || org.company.tagline, industry: facts.industry || org.company.industry }
  const written = writeOrgDir(root, { ...read.bundle, org: { ...org, company, departments, people: roster }, seats })
  if (written.errors.length) return { ok: false, errors: written.errors }
  const reread = readOrgDir(root, orgId)
  if (reread.ok && (facts.purpose || facts.size)) {
    const profile = readOrgProfile(root, reread.bundle.org, reread.bundle.seats)
    writeOrgProfile(root, { ...profile, purpose: facts.purpose || profile.purpose, size: facts.size || profile.size })
  }
  const count = imported.length === 1 ? '1 person' : `${imported.length} people`
  appendActivity(root, {
    id: `org-file-${Date.now()}`,
    orgId,
    type: 'edit',
    actorSeatId: managerSeat(seats)?.slug || 'you',
    actorType: 'human',
    timestamp: new Date().toISOString(),
    summary: `Imported the organization: ${count} from an organization file`,
  })
  return { ok: true, imported }
}

/** Ada, Ada and Ben, or Ada, Ben, and Cy. */
export function andList(names: string[]): string {
  if (names.length < 3) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export function readSnapshot(root: string): { ok: true; snapshot: Snapshot; stamp: string } | { ok: false; error: string; stamp: string; missing: boolean } {
  const path = resolve(root, SNAPSHOT_PATH)
  if (!existsSync(path)) return { ok: false, error: '', stamp: '', missing: true }
  let stamp = ''
  let fallback = new Date().toISOString()
  try {
    const stat = statSync(path)
    stamp = `${Math.round(stat.mtimeMs)}:${stat.size}`
    fallback = stat.mtime.toISOString()
  } catch {
    return { ok: false, error: 'Could not read the snapshot.', stamp: '', missing: false }
  }
  let text: string
  try {
    text = readText(path)
  } catch {
    return { ok: false, error: 'Could not read the snapshot.', stamp, missing: false }
  }
  const parsed = parseSnapshot(text, fallback)
  if (!parsed.ok) return { ok: false, error: parsed.error, stamp, missing: false }
  return { ok: true, snapshot: parsed.snapshot, stamp }
}

/** A missing file is no requests; a bad file is no requests and an error, never a crash. */
export function readRequests(root: string): { requests: GrokRequest[]; error: string } {
  const path = resolve(root, REQUESTS_PATH)
  if (!existsSync(path)) return { requests: [], error: '' }
  try {
    const parsed = parseRequests(readText(path))
    return parsed.ok ? { requests: parsed.requests, error: '' } : { requests: [], error: parsed.error }
  } catch {
    return { requests: [], error: 'grok/requests.json could not be read.' }
  }
}

function writeRequests(root: string, requests: GrokRequest[]) {
  mkdirSync(resolve(root, 'grok'), { recursive: true })
  writeFileSync(resolve(root, REQUESTS_PATH), serializeRequests(requests))
}

/** A directory bot's prompt: the file below its frontmatter, or '' when it is missing or unreadable. */
function directoryPrompt(path: string): string {
  try {
    if (!existsSync(path)) return ''
    return readText(path).replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
  } catch {
    return ''
  }
}

/** Asks the Connector to create one bot in Grok Bot. Writes grok/requests.json only; the seat file is untouched. */
export function requestGrokBot(root: string, orgId: string, seatSlug: string, orgsDir = ''): { ok: true; request: GrokRequest } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === seatSlug)
  if (!seat) return { ok: false, errors: [`seats/${seatSlug}.md is not in this org.`] }
  // A greyed seat names a bot that works elsewhere: creating it by that name would link that bot here.
  if (isGreyed(seat)) return { ok: false, errors: [`${seat.title} works in another organization. Move it here, or rename and publish a copy.`] }
  if (!canRequest(seat)) return { ok: false, errors: [`${seat.title} is already in Grok Bot or is not an active bot.`] }
  const path = seatFile(root, seat.slug)
  if (!path) return { ok: false, errors: ['That seat slug is not valid.'] }
  // The directory sits beside orgs/ at the repo root.
  const directory = seat.directoryId && SEAT_SLUG.test(seat.directoryId) ? resolve(root, '..', '..', 'directory', `${seat.directoryId}.md`) : ''
  // The prompt written in Profile wins. A directory bot sends its directory prompt until it is edited there.
  const fromDirectory = !seat.instructions && directory ? directoryPrompt(directory) : ''
  const request: GrokRequest = {
    seat: seat.slug,
    // Grok Bot keeps one bot per name across the whole project, so a title another org uses gets this org's name.
    name: (orgsDir ? renamedSeats(orgsDir, orgId)[seat.slug] : '') || seat.title,
    seatFile: path,
    prompt: seat.instructions || fromDirectory,
    ...(seat.skills?.length ? { skills: seat.skills } : {}),
    ...(seat.routines?.length ? { routines: seat.routines } : {}),
    requestedAt: new Date().toISOString(),
  }
  writeRequests(root, addRequest(readRequests(root).requests, request))
  const owner = managerSeat(read.bundle.seats)
  appendActivity(root, {
    id: `grok-request-${seat.slug}-${request.requestedAt}`,
    orgId,
    type: 'edit',
    actorSeatId: owner?.slug || seat.slug,
    actorType: owner ? 'human' : 'bot',
    timestamp: request.requestedAt,
    summary: `Asked the Connector to create ${seat.title} in Grok Bot`,
    subjectSeatId: seat.slug,
    grok: 'out',
    kind: 'request',
    stats: [`Name in Grok Bot=${request.name.replace(/[|=]/g, '/')}`, `Prompt=${seat.instructions ? 'from Profile' : request.prompt ? 'from the directory' : 'from the seat card'}`, `Waiting=${readRequests(root).requests.length}`].join('|'),
  })
  return { ok: true, request }
}

/**
 * After a confirmed sync, drops requests for bots the snapshot found and for seats that are gone.
 * Each bot the Connector actually created gets one "Created in Grok Bot" line in Logs.
 */
/**
 * Update bot: asks the Connector to send a bot already in Grok Bot its skills and routines. One waiting update per
 * bot; asking again replaces it with the current lists. Logged as going to Grok Bot.
 */
export function requestGrokUpdate(root: string, orgId: string, seatSlug: string): { ok: true; request: GrokRequest } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === seatSlug)
  if (!seat) return { ok: false, errors: [`seats/${seatSlug}.md is not in this org.`] }
  if (!canUpdate(seat)) return { ok: false, errors: [`${seat.title} is not in Grok Bot yet. Add it to Grok Bot first.`] }
  const path = seatFile(root, seat.slug)
  if (!path) return { ok: false, errors: ['That seat slug is not valid.'] }
  // A new manager already waiting for this bot still goes with the skills and routines.
  const waiting = readRequests(root).requests.find((item) => item.seat === seat.slug && item.kind === 'update')
  const request: GrokRequest = {
    seat: seat.slug,
    name: seat.title,
    seatFile: path,
    prompt: '',
    ...(seat.skills?.length ? { skills: seat.skills } : {}),
    ...(seat.routines?.length ? { routines: seat.routines } : {}),
    kind: 'update',
    ...(seat.grokBotUrl?.trim() ? { grokBotUrl: seat.grokBotUrl.trim() } : {}),
    ...(waiting?.reportsTo ? { reportsTo: waiting.reportsTo } : {}),
    ...(waiting?.reportsTo && waiting.previousReportsTo ? { previousReportsTo: waiting.previousReportsTo } : {}),
    requestedAt: new Date().toISOString(),
  }
  writeRequests(root, addRequest(readRequests(root).requests, request))
  const owner = managerSeat(read.bundle.seats)
  appendActivity(root, {
    id: `grok-update-${seat.slug}-${request.requestedAt}`,
    orgId,
    type: 'edit',
    actorSeatId: owner?.slug || seat.slug,
    actorType: owner ? 'human' : 'bot',
    timestamp: request.requestedAt,
    summary: `Asked the Connector to update ${seat.title} in Grok Bot`,
    subjectSeatId: seat.slug,
    grok: 'out',
    kind: 'request',
    stats: requestStats(request).join('|'),
  })
  return { ok: true, request }
}

/**
 * Drops each waiting update the Connector's snapshot reports as carried out, matched by seat and requestedAt, so an
 * older report never clears a newer update. Only the Connector's own snapshot counts. Logs one line per update.
 */
export function clearHandledUpdates(root: string, orgId: string) {
  const snap = readSnapshot(root)
  if (!snap.ok || !snap.snapshot.updated?.length) return
  const current = readRequests(root)
  if (current.error) return
  const handled = new Set(snap.snapshot.updated.map((item) => `${item.seat}|${item.requestedAt}`))
  const done = current.requests.filter((item) => item.kind === 'update' && handled.has(`${item.seat}|${item.requestedAt}`))
  if (!done.length) return
  writeRequests(root, current.requests.filter((item) => !done.includes(item)))
  const read = readOrgDir(root, orgId)
  const owner = read.ok ? managerSeat(read.bundle.seats) : undefined
  const at = new Date().toISOString()
  for (const item of done) {
    const title = (read.ok ? read.bundle.seats.find((entry) => entry.slug === item.seat)?.title : '') || item.name
    appendActivity(root, {
      id: `grok-updated-${item.seat}-${at}`,
      orgId,
      type: 'edit',
      actorSeatId: owner?.slug || item.seat,
      actorType: owner ? 'human' : 'bot',
      timestamp: at,
      summary: `Updated in Grok Bot: ${title}`,
      subjectSeatId: item.seat,
      grok: 'in',
      kind: 'updated',
      stats: [...requestStats(item), `Asked=${localStamp(item.requestedAt)}`].join('|'),
    })
  }
}

export function clearFulfilledRequests(root: string, orgId: string, plan: SyncPlan) {
  const current = readRequests(root)
  if (current.error || current.requests.length === 0) return
  const read = readOrgDir(root, orgId)
  const found = fulfilledSeats(plan)
  // An update is for a bot Grok Bot already has: only the Connector's report that it carried it out clears it.
  const creates = current.requests.filter((item) => item.kind !== 'update')
  const done = new Set(creates.filter((item) => found.has(item.seat)).map((item) => item.seat))
  if (read.ok) {
    for (const item of creates) {
      const seat = read.bundle.seats.find((entry) => entry.slug === item.seat)
      if (!seat || !canRequest(seat)) done.add(item.seat)
    }
  }
  const kept = dropRequests(current.requests, done)
  if (kept.length === current.requests.length) return
  const at = new Date().toISOString()
  // CreateAgent cannot add skills or routines: a created bot that came with them is asked for them as an update.
  const followUps: GrokRequest[] = creates.filter((item) => found.has(item.seat) && (item.skills?.length || item.routines?.length)).map((item) => ({
    seat: item.seat,
    name: item.name,
    seatFile: item.seatFile,
    prompt: '',
    kind: 'update',
    ...(item.skills?.length ? { skills: item.skills } : {}),
    ...(item.routines?.length ? { routines: item.routines } : {}),
    requestedAt: at,
  }))
  writeRequests(root, [...kept, ...followUps])
  const owner = read.ok ? managerSeat(read.bundle.seats) : undefined
  for (const item of creates) {
    if (!found.has(item.seat)) continue
    const title = (read.ok ? read.bundle.seats.find((entry) => entry.slug === item.seat)?.title : '') || item.name
    appendActivity(root, {
      id: `grok-created-${item.seat}-${at}`,
      orgId,
      type: 'edit',
      actorSeatId: owner?.slug || item.seat,
      actorType: owner ? 'human' : 'bot',
      timestamp: at,
      summary: `Created in Grok Bot: ${title}`,
      subjectSeatId: item.seat,
      grok: 'in',
      kind: 'created',
      stats: [`Asked=${item.requestedAt ? localStamp(item.requestedAt) : '-'}`, `Took=${item.requestedAt ? waitedFor(item.requestedAt, at) : '-'}`].join('|'),
    })
  }
}

/** A bot's Grok Bot id, from its link. A link without one stands for itself. */
function botKey(link: string): string {
  const trimmed = link.trim()
  return /[?&]id=([^&#\s]+)/.exec(trimmed)?.[1] ?? trimmed
}

/** One Connector serves every organization of the project, so it is never held to one. */
function isConnectorName(name: string): boolean {
  return name.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase())
}

/** A manager a bot has in the organization it works for: a bot there by its Grok Bot id, or You, which has no id. */
export interface HomeManager {
  key: string
  name: string
}

/** Who a bot reports to in the organization it works for. A person other than You is left out: nothing matches them here. */
export interface HomeManagers {
  reportsTo?: HomeManager
  alsoReportsTo: HomeManager[]
}

/**
 * The bots active in every other organization of the project, by Grok Bot id, with the organizations each is in. A bot
 * works for one organization. Each organization is read once; a bad one is skipped. `managers` gets who each bot reports
 * to there, from the first organization it is in.
 */
export function botsInOtherOrgs(orgsDir: string, orgId: string, unreadable: string[] = [], managers?: Map<string, HomeManagers>): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const other of listOrgSlugs(orgsDir)) {
    if (other === orgId) continue
    const read = readOrgDir(resolve(orgsDir, other), other)
    if (!read.ok) {
      unreadable.push(other)
      continue
    }
    const orgName = read.bundle.org.company.name
    const bySlug = new Map(read.bundle.seats.map((seat) => [seat.slug, seat]))
    const you = managerSeat(read.bundle.seats)?.slug
    const managerOf = (slug: string): HomeManager | undefined => {
      if (slug === you) return { key: '', name: 'You' }
      const seat = bySlug.get(slug)
      const key = seat?.kind === 'bot' ? botKey(seat.grokBotUrl || seat.elsewhereUrl || '') : ''
      return seat && key ? { key, name: seat.title } : undefined
    }
    for (const seat of read.bundle.seats) {
      const key = botKey(seat.grokBotUrl ?? '')
      if (seat.kind !== 'bot' || seat.status === 'retired' || !key) continue
      const orgs = found.get(key) ?? []
      if (!orgs.includes(orgName)) orgs.push(orgName)
      found.set(key, orgs)
      if (managers && !managers.has(key)) managers.set(key, { reportsTo: managerOf(seat.reportsTo), alsoReportsTo: (seat.alsoReportsTo ?? []).flatMap((slug) => managerOf(slug) ?? []) })
    }
  }
  return found
}

/** Why a bot active in another organization is not added here. */
export function inOtherOrgsText(name: string, orgs: string[]): string {
  return `${name} is already in ${andList(orgs)}. A bot works for one organization. To use it here too, duplicate it in Grok Bot, rename the copy, and add the copy. To move it here, retire it there first.`
}

/** Why a seat may not report to a greyed one: its bot works for another organization. */
function greyedManagerText(title: string): string {
  return `${title} works in another organization. A bot never reports to a greyed bot.`
}

/** Organizations of the project with an active seat on this Grok Bot link. A bad org is skipped. */
export function activeWithLink(orgsDir: string, link: string): string[] {
  const wanted = link.trim()
  if (!wanted) return []
  return listOrgSlugs(orgsDir).flatMap((orgId) => {
    const read = readOrgDir(resolve(orgsDir, orgId), orgId)
    if (!read.ok) return []
    return read.bundle.seats.some((seat) => seat.kind === 'bot' && seat.status !== 'retired' && (seat.grokBotUrl ?? '').trim() === wanted) ? [read.bundle.org.company.name] : []
  })
}

/**
 * Called on each Connector run. Grok Bot gives the Connector no delete tool, so the person deletes a retired bot there;
 * this notices it. A retired bot seat with a link is marked deleted once a run newer than its retirement reports the
 * bot nowhere: not in any org's snapshot and not in connector.json. An unreadable file counts as the bot still there.
 * Logs one line per bot. Returns the seats it marked per org, so the run log skips its own "no longer in Grok Bot" line for them.
 */
export function markDeletedBots(orgsDir: string): Map<string, Set<string>> {
  const marked = new Map<string, Set<string>>()
  const connector = readConnector(orgsDir)
  if (!connector || connector.error || !connector.stamp) return marked
  const ranAt = Number(connector.stamp.split(':')[0])
  if (!Number.isFinite(ranAt) || ranAt <= 0) return marked
  const orgIds = listOrgSlugs(orgsDir)
  const reported: ReportedBot[] = connector.unassigned.map((bot) => ({ name: bot.name, grokBotUrl: bot.grokBotUrl }))
  for (const orgId of orgIds) {
    const snap = readSnapshot(resolve(orgsDir, orgId))
    if (!snap.ok && !snap.missing) return marked
    if (snap.ok) reported.push(...snap.snapshot.bots.map((bot) => ({ name: bot.name, grokBotUrl: bot.grokBotUrl })))
  }
  const at = new Date(ranAt).toISOString()
  for (const orgId of orgIds) {
    const root = resolve(orgsDir, orgId)
    const read = readOrgDir(root, orgId)
    if (!read.ok) continue
    const gone = read.bundle.seats.filter((seat) => {
      const retired = Date.parse(seat.retiredAt)
      return canDelete(seat) && !Number.isNaN(retired) && ranAt > retired && !stillInGrok({ grokBotUrl: seat.grokBotUrl ?? '', name: seat.title }, reported)
    })
    if (!gone.length) continue
    const owner = managerSeat(read.bundle.seats)
    const seats = new Set<string>()
    const logged = new Set<string>()
    for (const seat of gone) {
      const link = (seat.grokBotUrl ?? '').trim()
      if (markSeatDeleted(root, seat.slug, link, at)) seats.add(seat.slug)
      // Two retired seats on one link are one bot: one line.
      if (logged.has(link)) continue
      logged.add(link)
      appendActivity(root, {
        id: `grok-deleted-${seat.slug}-${at}`,
        orgId,
        type: 'edit',
        actorSeatId: owner?.slug || 'connector',
        actorType: owner ? 'human' : 'bot',
        timestamp: at,
        summary: `Deleted in Grok Bot: ${seat.title}`,
        subjectSeatId: seat.slug,
        grok: 'in',
        kind: 'deleted',
        stats: `Retired=${localStamp(seat.retiredAt)}`,
      })
    }
    marked.set(orgId, seats)
  }
  return marked
}

/**
 * For each retired bot that can still be deleted in Grok Bot, the organizations where the same bot is still active.
 * One pass over the folder, not one per retired bot: the status request runs on every live event, and each org read costs real time.
 */
export function retiredActiveElsewhere(orgsDir: string, seats: SeatDocument[], readOrg = orgReader(orgsDir)): Record<string, string[]> {
  const wanted = seats.filter((seat) => canDelete(seat))
  if (!wanted.length) return {}
  const activeIn = new Map<string, string[]>()
  for (const orgId of listOrgSlugs(orgsDir)) {
    const read = readOrg(orgId)
    if (!read.ok) continue
    const orgName = read.bundle.org.company.name
    for (const seat of read.bundle.seats) {
      const link = (seat.grokBotUrl ?? '').trim()
      if (seat.kind !== 'bot' || seat.status === 'retired' || !link) continue
      const orgs = activeIn.get(link) ?? []
      if (!orgs.includes(orgName)) orgs.push(orgName)
      activeIn.set(link, orgs)
    }
  }
  const found: Record<string, string[]> = {}
  for (const seat of wanted) {
    const orgs = activeIn.get((seat.grokBotUrl ?? '').trim())
    if (orgs?.length) found[seat.slug] = orgs
  }
  return found
}

/** Writes grokDeletedAt on a seat that still holds the link. A missing or bad seat file is skipped. */
function markSeatDeleted(root: string, slug: string, link: string, at: string): boolean {
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return false
  try {
    const parsed = parseSeatMarkdown(slug, readText(path))
    if (!parsed.ok || (parsed.seat.grokBotUrl ?? '').trim() !== link) return false
    const written = serializeSeat({ ...parsed.seat, grokDeletedAt: at })
    if (!parseSeatMarkdown(slug, written).ok) return false
    writeFileSync(path, written)
    return true
  } catch {
    return false
  }
}

/**
 * Moves the Connector's own scheduled processes to the saved interval, in every org, so the Work Chart and the
 * Connector, which keeps routines in line with process files, agree with the prompt. A leading "Every …" in the
 * description is rewritten too; the rest of it is kept. Returns the files it changed.
 */
export function syncConnectorProcesses(orgsDir: string, minutes: number): string[] {
  const changed: string[] = []
  for (const orgId of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, orgId)
    const read = readOrgDir(root, orgId)
    if (!read.ok) continue
    const connectors = new Set(read.bundle.seats.filter((seat) => seat.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase())).map((seat) => seat.slug))
    for (const process of read.bundle.processes ?? []) {
      if (process.trigger.type !== 'schedule' || !connectors.has(process.steps[0]?.seat ?? '')) continue
      const schedule = scheduleFor(minutes)
      const description = process.trigger.description.replace(/^Every [^,.;]*/i, `Every ${everyLabel(minutes)}`)
      if (schedule === process.trigger.schedule.trim() && description === process.trigger.description) continue
      const path = resolve(root, 'processes', `${process.slug}.md`)
      try {
        writeFileSync(path, serializeProcess({ ...process, trigger: { ...process.trigger, schedule, description } }))
        changed.push(`orgs/${orgId}/processes/${process.slug}.md`)
      } catch {
        // A process file that cannot be written keeps its old schedule; the prompt still carries the interval.
      }
    }
  }
  return changed
}

function lastSyncConfirmed(bundle: OrgBundle): string {
  let latest = ''
  for (const event of bundle.activity) {
    if (event.id.startsWith('sync-') && event.timestamp > latest) latest = event.timestamp
  }
  return latest
}

export function syncStatus(root: string, orgId: string, orgsDir = ''): { ok: true; status: SyncStatus } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const lastConfirmed = lastSyncConfirmed(read.bundle)
  const folder = resolve(root)
  const { requests } = readRequests(root)
  // The project view and the retired list each ask about every org; this request reads each one once.
  const readOrg = orgsDir ? orgReader(orgsDir, resolve(orgsDir, orgId) === folder ? { [orgId]: read } : {}) : undefined
  const project = orgsDir ? projectInfo(orgsDir, orgId, readOrg) : undefined
  const retiredElsewhere = orgsDir ? retiredActiveElsewhere(orgsDir, read.bundle.seats, readOrg) : {}
  const connector = orgsDir ? { connector: connectorState(orgsDir, orgId), progress: requestProgressFor(orgsDir, orgId, requests) } : {}
  // Where each greyed seat's bot works, by the organizations' names now, and the main bot.
  const greyed = orgsDir ? { elsewhere: greyedElsewhere(orgsDir, orgId, read.bundle.seats, readOrg), mainBot: readMainBot(orgsDir) } : {}
  const snap = readSnapshot(root)
  if (!snap.ok) {
    if (snap.missing) return { ok: true, status: { snapshot: null, error: '', plan: null, lastConfirmed, folder, requests, retiredElsewhere, project, ...connector, ...greyed } }
    return { ok: true, status: { snapshot: { stamp: snap.stamp, syncedAt: '' }, error: snap.error, plan: null, lastConfirmed, folder, requests, retiredElsewhere, project, ...connector, ...greyed } }
  }
  const plan = planSync(snap.snapshot, grokSeats(read.bundle.seats), read.bundle.processes ?? [], read.bundle.org.company.name, orgsDir ? accountBots(orgsDir, orgId) : [])
  return { ok: true, status: { snapshot: { stamp: snap.stamp, syncedAt: snap.snapshot.syncedAt }, error: '', plan, lastConfirmed, folder, requests, retiredElsewhere, project, ...connector, ...greyed } }
}

/** Each greyed seat here → the organizations where its bot is active, read with the request's one reader. */
function greyedElsewhere(orgsDir: string, orgId: string, seats: SeatDocument[], readOrg = orgReader(orgsDir)): Record<string, string[]> {
  const wanted = seats.filter((seat) => isGreyed(seat))
  if (!wanted.length) return {}
  const activeIn = new Map<string, string[]>()
  for (const other of listOrgSlugs(orgsDir)) {
    if (other === orgId) continue
    const read = readOrg(other)
    if (!read.ok) continue
    for (const seat of read.bundle.seats) {
      const key = botKey(seat.grokBotUrl ?? '')
      if (seat.kind !== 'bot' || seat.status === 'retired' || !key) continue
      activeIn.set(key, [...new Set([...(activeIn.get(key) ?? []), read.bundle.org.company.name])])
    }
  }
  return Object.fromEntries(wanted.flatMap((seat) => {
    const orgs = activeIn.get(botKey(seat.elsewhereUrl ?? ''))
    return orgs?.length ? [[seat.slug, orgs]] : []
  }))
}

/** Bots the Grok Bot account runs outside this org's snapshot: unassigned ones, other orgs' snapshots, and the Connector. A bad snapshot is skipped. */
export function accountBots(orgsDir: string, orgId: string): { name: string; grokBotUrl: string }[] {
  const bots: { name: string; grokBotUrl: string }[] = (readConnector(orgsDir)?.unassigned ?? []).map((bot) => ({ name: bot.name, grokBotUrl: bot.grokBotUrl }))
  for (const other of listOrgSlugs(orgsDir)) {
    if (other === orgId) continue
    const snap = readSnapshot(resolve(orgsDir, other))
    if (snap.ok) bots.push(...snap.snapshot.bots.map((bot) => ({ name: bot.name, grokBotUrl: bot.grokBotUrl })))
  }
  bots.push({ name: connectorName(ensureProjectId(orgsDir)), grokBotUrl: '' })
  return bots
}

/** Active bot seats of every org in the project, read once. A bad org is skipped. */
function projectBots(orgsDir: string, readOrg = orgReader(orgsDir)): { orgId: string; orgName: string; slug: string; title: string }[] {
  return listOrgSlugs(orgsDir).flatMap((orgId) => {
    const read = readOrg(orgId)
    if (!read.ok) return []
    return grokSeats(read.bundle.seats)
      .filter((seat) => seat.kind === 'bot' && seat.status !== 'retired')
      .map((seat) => ({ orgId, orgName: read.bundle.org.company.name, slug: seat.slug, title: seat.title }))
  })
}

/** Seats of this org whose title an active bot in another org of the project already uses, and the name Grok Bot gets. */
export function renamedSeats(orgsDir: string, orgId: string, bots = projectBots(orgsDir)): Record<string, string> {
  const renamed: Record<string, string> = {}
  for (const bot of bots) {
    if (bot.orgId !== orgId) continue
    const title = bot.title.trim().toLowerCase()
    if (bots.some((other) => other.orgId !== orgId && other.title.trim().toLowerCase() === title)) renamed[bot.slug] = `${bot.title.trim()} · ${bot.orgName.trim()}`
  }
  return renamed
}

export function projectInfo(orgsDir: string, orgId: string, readOrg = orgReader(orgsDir)): ProjectInfo {
  const id = ensureProjectId(orgsDir)
  const connector = readConnector(orgsDir)
  const bots = projectBots(orgsDir, readOrg)
  return {
    id,
    connectorName: connectorName(id),
    orgsFolder: resolve(orgsDir),
    connector: connector ? { stamp: connector.stamp, syncedAt: connector.syncedAt, error: connector.error, ...(connector.syncMinutes ? { syncMinutes: connector.syncMinutes } : {}), ...(connector.apps ? { apps: connector.apps } : {}) } : null,
    unassigned: connector?.unassigned.map((bot) => bot.name) ?? [],
    bots: bots.length,
    renamed: renamedSeats(orgsDir, orgId, bots),
    syncMinutes: readSyncMinutes(orgsDir),
    account: grokAccount(orgsDir, orgId, readOrg),
    timeZone: localTimeZone(),
    windows: process.platform === 'win32',
  }
}

/** Only the Connector's state: project.json, connector.json, and the org folder names. Never a sync plan, so the header and the connection bar answer at once. */
export function connectorInfo(orgsDir: string): ConnectorInfo {
  const id = ensureProjectId(orgsDir)
  const connector = readConnector(orgsDir)
  return {
    id,
    connectorName: connectorName(id),
    orgsFolder: resolve(orgsDir),
    connector: connector ? { stamp: connector.stamp, syncedAt: connector.syncedAt, error: connector.error, ...(connector.syncMinutes ? { syncMinutes: connector.syncMinutes } : {}), ...(connector.apps ? { apps: connector.apps } : {}) } : null,
    syncMinutes: readSyncMinutes(orgsDir),
    timeZone: localTimeZone(),
    windows: process.platform === 'win32',
    orgs: listOrgSlugs(orgsDir),
  }
}

/** The IANA time zone of this computer, for the Connector prompt. Empty when the runtime cannot say. */
function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/**
 * Every bot in the Grok Bot account, counted once whatever its organization: the bots in each org's snapshot,
 * the bots in no organization, and the Connector, which never lists itself. Matched by link, else by name.
 */
export function grokAccount(orgsDir: string, orgId: string, readOrg = orgReader(orgsDir)): GrokAccount | null {
  const connector = readConnector(orgsDir)
  if (!connector) return null
  const found = new Map<string, AccountBot>()
  let complete = !connector.error
  const keyOf = (bot: { name: string; grokBotUrl: string }) => bot.grokBotUrl.trim() || `name:${bot.name.trim().toLowerCase()}`
  for (const other of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, other)
    const snap = readSnapshot(root)
    if (!snap.ok) {
      if (!snap.missing) complete = false
      continue
    }
    const read = readOrg(other)
    const orgName = read.ok ? read.bundle.org.company.name : other
    const seats = read.ok ? grokSeats(read.bundle.seats).filter((seat) => seat.kind === 'bot') : []
    for (const bot of snap.snapshot.bots) {
      const link = bot.grokBotUrl.trim()
      const name = bot.name.trim().toLowerCase()
      const mine = seats.filter((seat) => (link && (seat.grokBotUrl ?? '').trim() === link) || seat.title.trim().toLowerCase() === name)
      const active = mine.find((seat) => seat.status !== 'retired')
      const entry = found.get(keyOf(bot)) ?? { name: bot.name, where: 'retired' as const, orgs: [] as string[] }
      if (!entry.orgs.includes(orgName)) entry.orgs.push(orgName)
      if (active || !mine.length) entry.where = 'active'
      if (other === orgId && (active ?? mine[0])) entry.seat = (active ?? mine[0])!.slug
      found.set(keyOf(bot), entry)
    }
  }
  for (const bot of connector.unassigned) {
    if (!found.has(keyOf(bot))) found.set(keyOf(bot), { name: bot.name, where: 'none', orgs: [] })
  }
  const bots = [...found.values()]
  bots.push({ name: connectorName(ensureProjectId(orgsDir)), where: 'connector', orgs: [] })
  return { total: bots.length, bots, complete }
}

/** Adds bots that are in Grok Bot but belong to no organization to this org, as seats marked New. Never adds a name twice. */
export function adoptUnassigned(orgsDir: string, root: string, orgId: string, names: string[]): { ok: true; added: string[]; errors: { name: string; error: string }[] } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const connector = readConnector(orgsDir)
  if (!connector) return { ok: false, errors: ['The Connector has not listed any bots yet.'] }
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()))
  const here = new Set(read.bundle.seats.map((seat) => seat.title.trim().toLowerCase()))
  const rows = connector.unassigned.filter((bot) => wanted.has(bot.name.trim().toLowerCase()) && !here.has(bot.name.trim().toLowerCase()))
  if (!rows.length) return { ok: true, added: [], errors: [] }
  const stamp = connector.syncedAt || new Date().toISOString()
  const imported = importBotsFile(root, orgId, rows, { grokSync: 'new', grokSyncedAt: stamp })
  const added = imported.imported.map((item) => item.name)
  if (added.length) {
    const at = new Date().toISOString()
    const owner = managerSeat(read.bundle.seats)
    appendActivity(root, {
      id: `sync-adopt-${at}`,
      orgId,
      type: 'edit',
      actorSeatId: owner?.slug || 'grok-bot',
      actorType: owner ? 'human' : 'bot',
      timestamp: at,
      summary: `Added from Grok Bot: ${added.join(', ')}`,
      grok: 'in',
      kind: 'added',
      stats: `Bots added=${added.length}|Still with no organization=${Math.max(0, connector.unassigned.length - added.length)}`,
    })
  }
  return { ok: true, added, errors: imported.errors }
}

/**
 * Import from the Connector: every bot in its last dump, each under the manager its own text names, and the Connector
 * itself. A bot active in another organization comes in greyed (importBotsFile). A bot already here is not added twice.
 */
export function importFromConnector(orgsDir: string, root: string, orgId: string): BotsFileResult | { error: string; status: number } {
  const dump = readGrokData(orgsDir)
  if (!dump.ok) return { error: dump.missing ? 'No data from the Connector yet.' : dump.error, status: dump.missing ? 404 : 422 }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return { error: read.errors.join(' '), status: 422 }
  if (importLocked(read.bundle.seats, readMainBot(orgsDir))) return { error: IMPORT_LOCKED, status: 409 }
  const unreadable: string[] = []
  botsInOtherOrgs(orgsDir, orgId, unreadable)
  if (unreadable.length) return { error: `${andList(unreadable)} could not be read, so the import cannot tell which bots already work there. Fix it first.`, status: 422 }
  const copyId = ensureProjectId(orgsDir)
  // A bot keeps the managers another copy gave it in an organization with this name, so a new copy keeps the org chart.
  const rows = rowsFromDump(dump.data, copyId, orgId, read.bundle.org.company.name)
  // A Connector on older rules does not name itself: its link comes from another organization's Connector seat, else none.
  if (!dump.data.self) rows.push(botRow(connectorName(copyId), connectorLinkElsewhere(orgsDir, orgId)))
  const here = new Set(read.bundle.seats.flatMap((seat) => [botKey(seat.grokBotUrl ?? ''), botKey(seat.elsewhereUrl ?? '')]).filter(Boolean))
  const connectorHere = read.bundle.seats.some((seat) => isConnectorName(seat.title))
  const fresh = rows.filter((row) => !here.has(botKey(row.grokBotUrl)) && !(connectorHere && isConnectorName(row.name)))
  return importBotsFile(root, orgId, fresh, { grokSync: 'synced', grokSyncedAt: dump.data.dumpedAt })
}

/** The link on the Connector's seat in another organization, or '' when no organization has one. */
function connectorLinkElsewhere(orgsDir: string, orgId: string): string {
  for (const other of listOrgSlugs(orgsDir)) {
    if (other === orgId) continue
    const read = readOrgDir(resolve(orgsDir, other), other)
    const seat = read.ok ? read.bundle.seats.find((item) => isConnectorName(item.title) && item.grokBotUrl?.trim()) : undefined
    if (seat?.grokBotUrl) return seat.grokBotUrl.trim()
  }
  return ''
}

export function previewSnapshotJson(root: string, orgId: string, json: string): { ok: true; status: SyncStatus } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const parsed = parseSnapshot(json, new Date().toISOString())
  if (!parsed.ok) return { ok: false, errors: [parsed.error] }
  const plan = planSync(parsed.snapshot, grokSeats(read.bundle.seats), read.bundle.processes ?? [], read.bundle.org.company.name)
  return { ok: true, status: { snapshot: { stamp: '', syncedAt: parsed.snapshot.syncedAt }, error: '', plan, lastConfirmed: lastSyncConfirmed(read.bundle), folder: resolve(root) } }
}

/**
 * Writes Grok Bot's numbers for matched seats as soon as the Connector reports them, so Performance never waits for
 * Sync. Only rows that change nothing but numbers; a new bot, a bot that left or came back, a link, a name, a card
 * fill, or a process still waits for Sync in the drawer. For a seat in `requested` (the owner asked the Connector to
 * create it), the link lands too, so the bot connects on its own. Returns the slugs written; a seat that cannot be written waits.
 */
export function applyPerformance(root: string, plan: SyncPlan, requested: ReadonlySet<string> = new Set()): string[] {
  const written: string[] = []
  for (const row of plan.rows) {
    if (!performanceOnly(row, 'slug' in row && requested.has(row.slug))) continue
    const path = seatFile(root, row.slug)
    if (!path || !existsSync(path)) continue
    try {
      const patched = patchSeatSource(row.slug, readText(path), row.patch)
      if (!patched.ok) continue
      writeFileSync(path, patched.source)
      written.push(row.slug)
    } catch {
      // Left for Sync.
    }
  }
  return written
}

/** Writes a confirmed plan. New bots go through importBotsFile, matched seats are patched in place, routines become processes. Never deletes. */
export function applySync(
  root: string,
  orgId: string,
  plan: SyncPlan,
): { ok: true; counts: SyncCounts; summary: string; errors: { name: string; error: string }[]; notes: string[]; files: string[] } | { ok: false; errors: string[] } {
  if (!orgExists(root)) return { ok: false, errors: ['Org not found.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const errors: { name: string; error: string }[] = []
  const notes: string[] = []
  const files: string[] = []
  const counts: SyncCounts = { new: 0, missing: 0, updated: 0, warnings: plan.counts.warnings, processes: 0, unchanged: plan.counts.unchanged }
  // Seats the new processes may name. Bots created below are added so a routine owned by a new bot lands on it.
  const seatRefs = read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title }))

  const fresh = plan.rows.flatMap((row) => (row.kind === 'new' ? [row.bot] : []))
  if (fresh.length) {
    const imported = importBotsFile(root, orgId, fresh, { grokSync: 'new', grokSyncedAt: plan.syncedAt })
    counts.new = imported.imported.length
    files.push(...imported.imported.map((item) => item.file))
    errors.push(...imported.errors)
    seatRefs.push(...imported.imported.map((item) => ({ slug: item.slug, title: item.name })))
  }

  for (const row of plan.rows) {
    if (row.kind !== 'updated' && !(row.kind === 'missing' && row.write)) continue
    const path = seatFile(root, row.slug)
    if (!path || !existsSync(path)) {
      errors.push({ name: row.name, error: `seats/${row.slug}.md is not in this org.` })
      continue
    }
    let source: string
    try {
      source = readText(path)
    } catch {
      errors.push({ name: row.name, error: `seats/${row.slug}.md could not be read.` })
      continue
    }
    const patched = patchSeatSource(row.slug, source, row.patch)
    if (!patched.ok) {
      errors.push({ name: row.name, error: patched.errors.join(' ') })
      continue
    }
    writeFileSync(path, patched.source)
    files.push(`orgs/${orgId}/seats/${row.slug}.md`)
    if (row.kind === 'updated') counts.updated += 1
    else counts.missing += 1
  }

  const processRows = plan.rows.flatMap((row) => (row.kind === 'new-process' ? [row.row] : []))
  if (processRows.length) {
    const imported = importProcessRows(root, processRows, seatRefs)
    counts.processes = imported.imported.length
    files.push(...imported.imported.map((item) => `orgs/${orgId}/${item.file}`))
    errors.push(...imported.errors)
    notes.push(...imported.notes)
  }

  const summary = summaryLine(counts)
  if (files.length) {
    const connector = read.bundle.seats.find((seat) => seat.title.trim().toLowerCase().startsWith('connector - botseverywhere'))
    const stamp = new Date().toISOString()
    appendActivity(root, {
      id: `sync-${stamp}`,
      orgId,
      type: 'edit',
      actorSeatId: connector?.slug || 'grok-bot',
      actorType: 'bot',
      timestamp: stamp,
      summary: `Synced with Grok Bot: ${summary}`,
      grok: 'in',
      kind: 'sync',
      stats: syncStats(plan, counts),
    })
  }
  return { ok: true, counts, summary, errors, notes, files }
}

/** Local date and time on this computer, for log figures. */
function localStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function waitedFor(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000))
  if (Number.isNaN(minutes)) return '-'
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

/** The figures of a confirmed sync for Logs, with the names of the bots and processes it touched. */
function syncStats(plan: SyncPlan, counts: SyncCounts): string {
  const names = (kind: SyncPlan['rows'][number]['kind']) => plan.rows.filter((row) => row.kind === kind && (kind !== 'missing' || ('write' in row && row.write))).map((row) => row.name.replace(/[|=]/g, '/')).join(', ')
  return [
    ['New', counts.new],
    ['Updated', counts.updated],
    ['Missing', counts.missing],
    ['New processes', counts.processes],
    ['Unchanged', counts.unchanged],
    ['New bots', names('new')],
    ['Updated bots', names('updated')],
    ['Missing bots', names('missing')],
    ['Processes', names('new-process')],
  ].filter(([, value]) => value !== 0 && value !== '').map(([label, value]) => `${label}=${value}`).join('|')
}

function reserveSeatSlug(root: string, base: string, taken: Set<string>): string | null {
  if (!base || !SEAT_SLUG.test(base)) return null
  const candidates = [base]
  for (let n = 2; n < 100; n += 1) candidates.push(`${base}-${n}`)
  for (const slug of candidates) {
    if (!SEAT_SLUG.test(slug) || taken.has(slug)) continue
    if (existsSync(resolve(root, 'seats', `${slug}.md`))) continue
    taken.add(slug)
    return slug
  }
  return null
}

/**
 * The main manager and the extra managers of one seat. Without `alsoReportsTo` it is `setSeatManager`. Extra managers
 * must be other seats here, never the seat or its main manager, and no line may loop back. A bot in Grok Bot gets them
 * on its one waiting update.
 */
export function setSeatManagers(root: string, orgId: string, slug: string, reportsTo: string, alsoReportsTo?: string[]): { ok: true; file: string; sent: boolean } | { ok: false; errors: string[] } {
  if (alsoReportsTo === undefined) return setSeatManager(root, orgId, slug, reportsTo)
  if (unsafePath(slug) || !SEAT_SLUG.test(slug)) return { ok: false, errors: ['Seat slug must be a lowercase slug.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === slug)
  if (!seat) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const main = reportsTo.trim() || seat.reportsTo
  const also = [...new Set(alsoReportsTo.map((item) => item.trim()).filter(Boolean))]
  const title = (target: string) => read.bundle.seats.find((item) => item.slug === target)?.title ?? target
  for (const target of also) {
    if (unsafePath(target) || !SEAT_SLUG.test(target) || !read.bundle.seats.some((item) => item.slug === target)) return { ok: false, errors: [`${target} is not a seat in this org.`] }
    if (target === slug) return { ok: false, errors: [`${seat.title} cannot report to itself.`] }
    if (target === main) return { ok: false, errors: [`${title(target)} is already the main manager.`] }
  }
  const greyedTarget = [main, ...also].map((target) => read.bundle.seats.find((item) => item.slug === target)).find((item) => item && isGreyed(item))
  if (greyedTarget) return { ok: false, errors: [greyedManagerText(greyedTarget.title)] }
  const loop = managerLoop(read.bundle.seats.map((item) => (item.slug === slug ? { slug, reportsTo: main, alsoReportsTo: also } : item)))
  if (loop) return { ok: false, errors: [`That makes a loop: ${title(loop)} would end up reporting to itself. Pick another manager.`] }
  const file = `orgs/${orgId}/seats/${slug}.md`
  let sent = false
  if (main !== seat.reportsTo) {
    const moved = setSeatManager(root, orgId, slug, main)
    if (!moved.ok) return moved
    sent = moved.sent
  }
  if (also.join('\n') === (seat.alsoReportsTo ?? []).join('\n')) return { ok: true, file, sent }
  const written = writeAlsoLine(root, slug, also)
  if (!written.ok) return written
  const path = seatFile(root, slug) ?? file
  const names = also.map(title)
  const stamp = new Date().toISOString()
  const current = readRequests(root)
  if (canUpdate(seat) && !current.error) {
    const next = addAlsoChange(current.requests, { seat: slug, name: seat.title, seatFile: path, prompt: '', kind: 'update', ...(seat.grokBotUrl?.trim() ? { grokBotUrl: seat.grokBotUrl.trim() } : {}), alsoReportsTo: names, requestedAt: stamp })
    if (next !== current.requests) writeRequests(root, next)
    sent = sent || next.some((item) => item.seat === slug && item.kind === 'update' && Boolean(item.alsoReportsTo))
  }
  appendActivity(root, {
    id: `also-${slug}-${stamp}`,
    orgId,
    type: 'edit',
    actorSeatId: managerSeat(read.bundle.seats)?.slug || 'you',
    actorType: 'human',
    timestamp: stamp,
    summary: names.length ? `${seat.title} also reports to ${andList(names)}` : `${seat.title} reports only to ${title(main)}`,
    subjectSeatId: slug,
    ...(sent ? { grok: 'out' as const } : {}),
    stats: requestStats({ alsoReportsTo: names }).join('|'),
  })
  return { ok: true, file, sent }
}

function retargetSeat(root: string, slug: string, reportsTo: string): { ok: true } | { ok: false; errors: string[] } {
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const source = readFileSync(path, 'utf8')
  if (!/^reportsTo:/m.test(source)) return { ok: false, errors: [`${slug}.md: reportsTo is missing.`] }
  const nextSource = source.replace(/^reportsTo:.*$/m, `reportsTo: ${quote(reportsTo)}`)
  const checked = parseSeatMarkdown(slug, nextSource)
  if (!checked.ok) return checked
  writeFileSync(path, nextSource.endsWith('\n') ? nextSource : `${nextSource}\n`)
  const parsed = parseOrgMarkdown(readText(resolve(root, 'org.md')))
  if (!parsed.ok) return parsed
  const org: OrgDocument = {
    ...parsed.org,
    seats: parsed.org.seats.map((seat) => (seat.slug === slug ? { slug, reportsTo: reportsTo || null } : seat)),
  }
  writeFileSync(resolve(root, 'org.md'), serializeOrgMarkdown(org, parsed.profile))
  return { ok: true }
}

/** Rewrites one seat file through its parser, so every field the change leaves alone stays as it was. */
function patchSeat(root: string, slug: string, change: (seat: SeatDocument) => SeatDocument): { ok: true } | { ok: false; errors: string[] } {
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const parsed = parseSeatMarkdown(slug, readText(path))
  if (!parsed.ok) return parsed
  const source = serializeSeat({ ...change({ ...parsed.seat }), source: '' })
  const checked = parseSeatMarkdown(slug, source)
  if (!checked.ok) return checked
  writeFileSync(path, source.endsWith('\n') ? source : `${source}\n`)
  return { ok: true }
}

const NOT_GREYED = 'That seat is not greyed.'

function greyedSeat(orgsDir: string, orgId: string, slug: string): { ok: true; root: string; bundle: OrgBundle; seat: SeatDocument } | { ok: false; errors: string[] } {
  const root = orgRoot(orgsDir, orgId)
  if (!root || !orgExists(root)) return { ok: false, errors: ['Org not found.'] }
  if (unsafePath(slug) || !SEAT_SLUG.test(slug)) return { ok: false, errors: ['Seat slug must be a lowercase slug.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === slug)
  if (!seat || !isGreyed(seat)) return { ok: false, errors: [NOT_GREYED] }
  return { ok: true, root, bundle: read.bundle, seat }
}

/** Seats that waited for `slug` move under it, unless the owner moved them since. Either way they stop waiting. */
function pullFollowers(root: string, orgId: string, slug: string, move = true): { ok: true } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const fallback = managerSeat(read.bundle.seats)?.slug ?? ''
  for (const seat of read.bundle.seats) {
    if (seat.waitsFor !== slug) continue
    if (move && seat.reportsTo === fallback) {
      const pointed = retargetSeat(root, seat.slug, slug)
      if (!pointed.ok) return pointed
    }
    const cleared = patchSeat(root, seat.slug, (item) => ({ ...item, waitsFor: undefined }))
    if (!cleared.ok) return cleared
  }
  return { ok: true }
}

/** A greyed seat starts working here: its link comes back, and the seats waiting for it move under it. */
function activateSeat(root: string, orgId: string, slug: string): { ok: true } | { ok: false; errors: string[] } {
  const done = patchSeat(root, slug, (seat) => ({ ...seat, grokBotUrl: seat.elsewhereUrl ?? '', elsewhereUrl: undefined }))
  return done.ok ? pullFollowers(root, orgId, slug) : done
}

function ownerEvent(root: string, orgId: string, seats: SeatDocument[], event: { id: string; type: FileActivity['type']; at: string; summary: string; subject: string }) {
  appendActivity(root, { id: `${event.id}-${event.at}`, orgId, type: event.type, actorSeatId: managerSeat(seats)?.slug || 'you', actorType: 'human', timestamp: event.at, summary: event.summary, subjectSeatId: event.subject })
}

/**
 * Move it here: the bot is retired in every other organization where it works, its reports there go under its manager
 * there, and its seat here becomes active. The Connector swaps its block on its next run.
 */
export function moveBotHere(orgsDir: string, orgId: string, slug: string): { ok: true } | { ok: false; errors: string[] } {
  const found = greyedSeat(orgsDir, orgId, slug)
  if (!found.ok) return found
  const key = botKey(found.seat.elsewhereUrl ?? '')
  const here = found.bundle.org.company.name
  const at = new Date().toISOString()
  const from: string[] = []
  // An organization that cannot be read could still run the bot: moving now could leave it working in two.
  const others = listOrgSlugs(orgsDir).filter((other) => other !== orgId).map((other) => ({ other, otherRoot: resolve(orgsDir, other), read: readOrgDir(resolve(orgsDir, other), other) }))
  const unreadable = others.filter((item) => !item.read.ok).map((item) => item.other)
  if (unreadable.length) return { ok: false, errors: [`${found.seat.title} cannot move yet: ${andList(unreadable)} could not be read. Fix it first, so the bot is not left working in two organizations.`] }
  for (const { other, otherRoot, read } of others) {
    if (!read.ok) continue
    for (const seat of read.bundle.seats) {
      if (seat.kind !== 'bot' || seat.status === 'retired' || botKey(seat.grokBotUrl ?? '') !== key) continue
      for (const report of read.bundle.seats) {
        if (report.slug === seat.slug || report.status === 'retired') continue
        if (report.reportsTo === seat.slug) {
          const pointed = retargetSeat(otherRoot, report.slug, seat.reportsTo)
          if (!pointed.ok) return pointed
        }
        if (report.alsoReportsTo?.includes(seat.slug)) {
          const also = writeAlsoLine(otherRoot, report.slug, report.alsoReportsTo.filter((item) => item !== seat.slug))
          if (!also.ok) return also
        }
      }
      const retired = patchSeat(otherRoot, seat.slug, (item) => ({ ...item, status: 'retired', retiredAt: at, movedTo: orgId }))
      if (!retired.ok) return retired
      ownerEvent(otherRoot, other, read.bundle.seats, { id: `moved-${seat.slug}`, type: 'fire', at, summary: `Moved to ${here}: ${seat.title}`, subject: seat.slug })
      if (!from.includes(read.bundle.org.company.name)) from.push(read.bundle.org.company.name)
    }
  }
  const active = activateSeat(found.root, orgId, slug)
  if (!active.ok) return active
  ownerEvent(found.root, orgId, found.bundle.seats, { id: `moved-here-${slug}`, type: 'hire', at, summary: from.length ? `Moved here from ${andList(from)}: ${found.seat.title}` : `${found.seat.title} works here now`, subject: slug })
  return { ok: true }
}

/**
 * Rename and publish in Grok Bot: the seat takes a new name and asks the Connector to create that bot, so a copy works
 * here and the original stays where it is. The original's name is refused: the Connector would link the original.
 */
export function publishCopy(orgsDir: string, orgId: string, slug: string, name: string): { ok: true } | { ok: false; errors: string[] } {
  const title = name.trim()
  if (!title) return { ok: false, errors: ['Give the new bot a name.'] }
  const found = greyedSeat(orgsDir, orgId, slug)
  if (!found.ok) return found
  if (title.toLowerCase() === found.seat.title.trim().toLowerCase()) return { ok: false, errors: [`Pick a new name. ${found.seat.title} is the bot that works in another organization.`] }
  const renamed = patchSeat(found.root, slug, (seat) => ({ ...seat, title, role: title, elsewhereUrl: undefined, grokSync: undefined }))
  if (!renamed.ok) return renamed
  const asked = requestGrokBot(found.root, orgId, slug, orgsDir)
  if (!asked.ok) return asked
  return pullFollowers(found.root, orgId, slug)
}

/** Remove: the greyed seat leaves this organization's chart. The bot keeps working where it is. */
export function removeGreyedSeat(orgsDir: string, orgId: string, slug: string): { ok: true } | { ok: false; errors: string[] } {
  const found = greyedSeat(orgsDir, orgId, slug)
  if (!found.ok) return found
  const path = seatFile(found.root, slug)
  if (!path) return { ok: false, errors: [`Refusing to remove seat ${slug}.`] }
  const orgs = botsInOtherOrgs(orgsDir, orgId).get(botKey(found.seat.elsewhereUrl ?? '')) ?? []
  // A seat that still reports to it goes under the default manager. Nothing is touched unless the result reads back.
  const fallback = managerSeat(found.bundle.seats)?.slug ?? ''
  const seats = found.bundle.seats
    .filter((item) => item.slug !== slug)
    .map((item) => ({ ...item, ...(item.reportsTo === slug ? { reportsTo: fallback } : {}), ...(item.alsoReportsTo?.includes(slug) ? { alsoReportsTo: item.alsoReportsTo.filter((also) => also !== slug) } : {}) }))
  const org = { ...found.bundle.org, seats: found.bundle.org.seats.filter((item) => item.slug !== slug).map((item) => (item.reportsTo === slug ? { ...item, reportsTo: fallback || null } : item)) }
  const problems = validateBundle({ ...found.bundle, org, seats })
  if (problems.length) return { ok: false, errors: [`${found.seat.title} cannot be removed yet: ${problems.join(' ')}`] }
  for (const item of found.bundle.seats) {
    if (item.slug === slug) continue
    if (item.reportsTo === slug) {
      const pointed = retargetSeat(found.root, item.slug, fallback)
      if (!pointed.ok) return pointed
    }
    if (item.alsoReportsTo?.includes(slug)) {
      const also = writeAlsoLine(found.root, item.slug, item.alsoReportsTo.filter((value) => value !== slug))
      if (!also.ok) return also
    }
  }
  unlinkSync(path)
  const parsed = parseOrgMarkdown(readText(resolve(found.root, 'org.md')))
  if (parsed.ok) writeFileSync(resolve(found.root, 'org.md'), serializeOrgMarkdown({ ...parsed.org, seats: parsed.org.seats.filter((item) => item.slug !== slug) }, parsed.profile))
  const cleared = pullFollowers(found.root, orgId, slug, false)
  if (!cleared.ok) return cleared
  ownerEvent(found.root, orgId, found.bundle.seats, { id: `removed-${slug}`, type: 'edit', at: new Date().toISOString(), summary: orgs.length ? `Removed ${found.seat.title}; it stays in ${andList(orgs)}` : `Removed ${found.seat.title}`, subject: slug })
  return { ok: true }
}

/** It's my main bot: saved by Grok Bot id, and every greyed seat of that bot, in every organization, starts working. */
export function markMainBot(orgsDir: string, orgId: string, slug: string): { ok: true } | { ok: false; errors: string[] } {
  const found = greyedSeat(orgsDir, orgId, slug)
  if (!found.ok) return found
  const key = botKey(found.seat.elsewhereUrl ?? '')
  const saved = writeMainBot(orgsDir, key)
  if (!saved.ok) return { ok: false, errors: [saved.error] }
  for (const other of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, other)
    const read = readOrgDir(root, other)
    if (!read.ok) continue
    for (const seat of read.bundle.seats) {
      if (!isGreyed(seat) || botKey(seat.elsewhereUrl ?? '') !== key) continue
      const active = activateSeat(root, other, seat.slug)
      if (!active.ok) return active
    }
  }
  ownerEvent(found.root, orgId, found.bundle.seats, { id: `main-bot-${slug}`, type: 'edit', at: new Date().toISOString(), summary: `${found.seat.title} is your main bot`, subject: slug })
  return { ok: true }
}

/** What Profile saves. A field left out stays as it was; an empty value clears it. */
export interface SeatProfileInput {
  instructions?: unknown
  skills?: unknown
  routines?: unknown
}

/**
 * Saves a bot's Profile: the instructions Grok Bot gets, its skills, and its routines. The seat card and the manager
 * are never touched. Any bot of your own takes skills and routines; a Connector report merges into them.
 */
export function updateSeatProfile(root: string, orgId: string, slug: string, input: SeatProfileInput): { ok: true; file: string } | { ok: false; errors: string[] } {
  if (unsafePath(slug) || !SEAT_SLUG.test(slug)) return { ok: false, errors: ['Seat slug must be a lowercase slug.'] }
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const parsed = parseSeatMarkdown(slug, readText(path))
  if (!parsed.ok) return parsed
  if (parsed.seat.kind !== 'bot') return { ok: false, errors: ['Only a bot has a Profile to save.'] }
  const next: SeatDocument = { ...parsed.seat, source: '' }
  if (input.instructions !== undefined) {
    const text = typeof input.instructions === 'string' ? input.instructions.trim() : ''
    if (text) next.instructions = text
    else delete next.instructions
  }
  if (input.skills !== undefined) {
    const skills = cleanSkills(input.skills)
    if (skills.length) next.skills = skills
    else delete next.skills
  }
  if (input.routines !== undefined) {
    const routines = cleanRoutines(input.routines)
    if (routines.length) next.routines = routines
    else delete next.routines
  }
  const written = serializeSeat(next)
  const check = parseSeatMarkdown(slug, written)
  if (!check.ok) return check
  writeFileSync(path, written)
  return { ok: true, file: `orgs/${orgId}/seats/${slug}.md` }
}

export function updateSeatCard(
  root: string,
  orgId: string,
  slug: string,
  card: Pick<SeatDocument, 'owns' | 'may' | 'mustAskBefore' | 'doneWhen'> & { addToGrokBotUrl?: string },
): { ok: true; file: string } | { ok: false; errors: string[] } {
  if (unsafePath(slug)) return { ok: false, errors: ['That name is not a safe file name.'] }
  if (!SEAT_SLUG.test(slug)) return { ok: false, errors: ['Seat slug must be a lowercase slug.'] }
  const path = seatFile(root, slug)
  if (!path || !existsSync(path)) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const current = readFileSync(path, 'utf8')
  const replaced = replaceSeatCardBody(slug, current, {
    owns: lineList(card.owns),
    may: lineList(card.may),
    mustAskBefore: lineList(card.mustAskBefore),
    doneWhen: lineList(card.doneWhen),
  }, card.addToGrokBotUrl)
  if (!replaced.ok) return replaced
  writeFileSync(path, replaced.source)
  return { ok: true, file: `orgs/${orgId}/seats/${slug}.md` }
}

/** Moves one seat under another. Rewrites the seat file and the org.md chart line, refuses self and cycles, logs an edit event. */
/** sent: the bot is in Grok Bot, so the Connector is asked to give it the new manager on its next run. */
export function setSeatManager(root: string, orgId: string, slug: string, reportsTo: string): { ok: true; file: string; sent: boolean } | { ok: false; errors: string[] } {
  if (unsafePath(slug) || unsafePath(reportsTo)) return { ok: false, errors: ['That name is not a safe file name.'] }
  if (!SEAT_SLUG.test(slug)) return { ok: false, errors: ['Seat slug must be a lowercase slug.'] }
  const target = reportsTo.trim()
  if (!SEAT_SLUG.test(target)) return { ok: false, errors: ['reportsTo must be a seat slug.'] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === slug)
  if (!seat) return { ok: false, errors: [`seats/${slug}.md is not in this org.`] }
  const manager = read.bundle.seats.find((item) => item.slug === target)
  if (!manager) return { ok: false, errors: [`${target} is not a seat in this org.`] }
  if (isGreyed(manager)) return { ok: false, errors: [greyedManagerText(manager.title)] }
  if (target === slug) return { ok: false, errors: [`${seat.title} cannot report to itself.`] }
  const parent = new Map(read.bundle.org.seats.map((item) => [item.slug, item.reportsTo || '']))
  const seen = new Set<string>()
  let cursor = target
  while (cursor) {
    if (cursor === slug) return { ok: false, errors: [`${manager.title} reports to ${seat.title}. Pick another manager.`] }
    if (seen.has(cursor)) break
    seen.add(cursor)
    cursor = parent.get(cursor) || ''
  }
  const loop = managerLoop(read.bundle.seats.map((item) => (item.slug === slug ? { ...item, reportsTo: target } : item)))
  if (loop) return { ok: false, errors: [`That makes a loop: ${manager.title} already reports to ${seat.title} on a dotted line. Pick another manager.`] }
  const file = `orgs/${orgId}/seats/${slug}.md`
  if (seat.reportsTo === target) return { ok: true, file, sent: false }
  const pointed = retargetSeat(root, slug, target)
  if (!pointed.ok) return pointed
  // The owner placed it: it stops waiting for a greyed manager.
  if (seat.waitsFor) {
    const cleared = patchSeat(root, slug, (item) => ({ ...item, waitsFor: undefined }))
    if (!cleared.ok) return cleared
  }
  const actor = managerSeat(read.bundle.seats)?.slug || 'you'
  const stamp = new Date().toISOString()
  const before = read.bundle.seats.find((item) => item.slug === seat.reportsTo)?.title ?? ''
  let sent = false
  const path = seatFile(root, slug)
  const current = readRequests(root)
  if (canUpdate(seat) && path && !current.error) {
    const next = addManagerChange(current.requests, {
      seat: slug,
      name: seat.title,
      seatFile: path,
      prompt: '',
      kind: 'update',
      ...(seat.grokBotUrl?.trim() ? { grokBotUrl: seat.grokBotUrl.trim() } : {}),
      reportsTo: manager.title,
      previousReportsTo: before,
      requestedAt: stamp,
    })
    if (next !== current.requests) writeRequests(root, next)
    sent = next.some((item) => item.seat === slug && item.kind === 'update' && Boolean(item.reportsTo))
  }
  appendActivity(root, {
    id: `move-${slug}-${stamp}`,
    orgId,
    type: 'edit',
    actorSeatId: actor,
    actorType: 'human',
    timestamp: stamp,
    summary: `Moved ${seat.title} under ${manager.title}`,
    subjectSeatId: slug,
    ...(sent ? { grok: 'out' as const } : {}),
    stats: requestStats({ reportsTo: manager.title, previousReportsTo: before }).join('|'),
  })
  return { ok: true, file, sent }
}

function founderFromChart(org: OrgDocument): SeatDocument | null {
  if (org.seats.length > 1) return null
  const listed = org.seats[0]
  const slug = listed?.slug ?? (org.people.length ? 'you' : '')
  if (!slug || !SEAT_SLUG.test(slug)) return null
  if (!listed && org.people.length === 0) return null
  const person = org.people.find((item) => item.id === `person-${slug}`) ?? org.people[0]
  const seat: SeatDocument = {
    slug,
    title: person?.name?.trim() || 'You',
    department: person?.department?.trim() || org.departments[0]?.id || 'general',
    reportsTo: listed?.reportsTo || '',
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'human',
    role: person?.title?.trim() || 'Founder',
    personId: person?.id || '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    owns: [],
    may: [],
    mustAskBefore: [],
    doneWhen: [],
    source: '',
  }
  seat.source = serializeSeat(seat)
  return seat
}

function linkSeatOnChart(root: string, slug: string, reportsTo: string, kind: SeatDocument['kind']): { ok: true } | { ok: false; errors: string[] } {
  const parsed = parseOrgMarkdown(readText(resolve(root, 'org.md')))
  if (!parsed.ok) return parsed
  if (parsed.org.seats.some((seat) => seat.slug === slug)) return { ok: true }
  const org: OrgDocument = {
    ...parsed.org,
    seats: [...parsed.org.seats, { slug, reportsTo: reportsTo || null }],
  }
  const profile = readOrgProfile(root, org, [])
  const next = {
    ...profile,
    people: kind === 'human' ? profile.people + 1 : profile.people,
    bots: kind === 'bot' ? profile.bots + 1 : profile.bots,
  }
  writeFileSync(resolve(root, 'org.md'), serializeOrgMarkdown(org, next))
  return { ok: true }
}

function assignWorkStep(root: string, stepId: string, slug: string) {
  const path = resolve(root, 'work-chart.md')
  if (!existsSync(path) || !stepId) return
  const parsed = parseWorkMarkdown(readText(path))
  if (!parsed.ok) return
  if (!parsed.work.steps.some((step) => step.id === stepId)) return
  const work: WorkDocument = {
    ...parsed.work,
    steps: parsed.work.steps.map((step) => (step.id === stepId ? { ...step, executorSeatId: slug } : step)),
  }
  writeFileSync(path, serializeWorkMarkdown(work))
}

function nextFreeSeatSlug(root: string, base: string): string | null {
  if (!SEAT_SLUG.test(base)) return null
  if (!existsSync(resolve(root, 'seats', `${base}.md`))) return base
  for (let n = 2; n < 100; n += 1) {
    const slug = `${base}-${n}`
    if (!SEAT_SLUG.test(slug)) return null
    if (!existsSync(resolve(root, 'seats', `${slug}.md`))) return slug
  }
  return null
}

function lineList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function unsafePath(value: string | undefined): boolean {
  if (!value) return false
  return value.includes('..') || value.includes('/') || value.includes('\\') || value.includes('\0')
}

export function seatFile(root: string, slug: string): string | null {
  if (!SEAT_SLUG.test(slug)) return null
  const seatsDir = resolve(root, 'seats')
  const full = resolve(seatsDir, `${slug}.md`)
  if (full !== seatsDir && !full.startsWith(seatsDir + sep)) return null
  return full
}

/** Deleted orgs move here, out of the app, so a mistake can be undone by moving the folder back. */
export const DELETED_DIR = '.deleted'

/** Moves an org folder to orgs/.deleted/. The name must be typed exactly, and the last org stays. */
export function deleteOrg(orgsDir: string, slug: string, confirm: string): { ok: true; next: string } | { ok: false; status: number; error: string } {
  const root = orgRoot(orgsDir, slug)
  if (!root || !orgExists(root)) return { ok: false, status: 404, error: 'Org not found.' }
  const read = readOrgDir(root, slug)
  const name = read.ok ? read.bundle.org.company.name.trim() : slug
  if (confirm.trim() !== name) return { ok: false, status: 422, error: `Type ${name} to delete this organization.` }
  const others = listOrgSlugs(orgsDir).filter((other) => other !== slug)
  const bin = resolve(orgsDir, DELETED_DIR)
  mkdirSync(bin, { recursive: true })
  const target = resolve(bin, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  try {
    renameSync(root, target)
  } catch {
    // Windows refuses to move a folder another program watches (the dev server does). Copy first, so nothing is lost, then remove.
    try {
      cpSync(root, target, { recursive: true })
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      if (existsSync(resolve(root, 'org.md'))) return { ok: false, status: 409, error: `A copy is in orgs/${DELETED_DIR}/, but the folder is in use. Close any program that has it open, then try again.` }
    }
  }
  // The last organization leaves no next one: the page opens Your orgs, as on a fresh copy.
  return { ok: true, next: others[0] ?? '' }
}

/** The routines each bot runs in Grok Bot, for the Work Chart. Null when the org is not there or cannot be read. Reads only; never throws. */
export function readRoutineBoard(orgsDir: string, slug: string, now = new Date()): RoutineBoard | null {
  try {
    const root = orgRoot(orgsDir, slug)
    if (!root || !orgExists(root)) return null
    const read = readOrgDir(root, slug)
    if (!read.ok) return null
    const dump = readGrokData(orgsDir)
    const results = readTextFile(resolve(orgsDir, RESULTS_FILE))
    const connector = readConnector(orgsDir)
    const ranAt = Number(connector?.stamp.split(':')[0])
    return routineBoard({
      orgId: slug,
      bundle: { ...read.bundle, seats: grokSeats(read.bundle.seats) },
      data: dump.ok ? dump.data : null,
      confirmations: [...(results ? parseResults(results).confirmations : []), ...profileFileLines(orgsDir, [slug])],
      connector: connector && ranAt > 0 ? { lastRun: new Date(ranAt).toISOString(), syncMinutes: connector.syncMinutes ?? readSyncMinutes(orgsDir) } : null,
      timeZone: localTimeZone(),
      now,
    })
  } catch {
    return null
  }
}

/** Where an org's files sit and how many there are, for Your files on Organization Overview. Null when the org is not there. Never throws. */
export function readFileGuide(orgsDir: string, slug: string): FileGuide | null {
  const folder = orgRoot(orgsDir, slug)
  if (!folder || folder === resolve(orgsDir) || !existsSync(resolve(folder, 'org.md'))) return null
  const isMarkdown = (name: string) => name.endsWith('.md')
  const log = guideFolder('log', resolve(folder, 'log'), isMarkdown)
  return {
    folder,
    rows: [
      guideFile('org', resolve(folder, 'org.md')),
      guideFolder('seats', resolve(folder, 'seats'), isMarkdown),
      guideFolder('processes', resolve(folder, 'processes'), isMarkdown),
      { ...log, days: guideNames(log.path).filter(isRunLogName).length },
      guideFolder('grok', resolve(folder, 'grok'), () => true),
      guideFile('connector', resolve(orgsDir, CONNECTOR_FILE)),
    ],
  }
}

function guideFile(key: FileGuideKey, path: string): FileGuideRow {
  const written = writtenAt(path)
  return { key, path, files: written ? 1 : 0, updatedAt: written }
}

function guideFolder(key: FileGuideKey, path: string, keep: (name: string) => boolean): FileGuideRow {
  let files = 0
  let updatedAt = ''
  for (const name of guideNames(path).filter(keep)) {
    const written = writtenAt(resolve(path, name))
    if (!written) continue
    files += 1
    if (written > updatedAt) updatedAt = written
  }
  return { key, path, files, updatedAt }
}

function guideNames(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** ISO time a file was written, or '' for a missing file, a folder, or one that cannot be read. */
function writtenAt(path: string): string {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.mtime.toISOString() : ''
  } catch {
    return ''
  }
}

export function orgRoot(orgsDir: string, slug: string): string | null {
  if (!SEAT_SLUG.test(slug)) return null
  const root = resolve(orgsDir)
  const full = resolve(root, slug)
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

export function startTemplateServer(options?: { port?: number; orgsDir?: string; root?: string; host?: string }): Promise<{ port: number; close: () => Promise<void> }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The file writer is dev-only.')
  }
  const host = options?.host ?? TEMPLATE_HOST
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('The file writer binds to 127.0.0.1 only.')
  }
  const orgsDir = options?.orgsDir ?? (options?.root ? resolve(options.root) : orgsDirFromEnv())
  // A fresh clone has no orgs folder. Make it first: the copy id is saved in it, and the watcher can only watch a folder that exists.
  try {
    mkdirSync(orgsDir, { recursive: true })
  } catch (error) {
    console.error(`Could not create ${orgsDir}: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  // Name this copy once, so its Connector is told apart from other copies in Grok Bot.
  const projectId = ensureProjectId(orgsDir)
  // Logs what each Connector run changed. The Connector writes connector.json last, so wait for it to finish.
  let runTimer: ReturnType<typeof setTimeout> | undefined
  const logRun = () => {
    try {
      recordConnectorRun(orgsDir, connectorName(projectId))
    } catch (error) {
      console.error(`Could not log the Connector run: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  // An update the snapshot reports done clears as soon as the snapshot lands, whichever file the Connector wrote last.
  const updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const clearUpdates = (slug: string) => {
    updateTimers.delete(slug)
    const root = orgRoot(orgsDir, slug)
    if (!root || !orgExists(root)) return
    try {
      clearHandledUpdates(root, slug)
    } catch (error) {
      console.error(`Could not clear the updates Grok Bot finished in ${slug}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  // Connector v2: snapshots, the unassigned list, backups, and the to-do list from the latest dump and the org files.
  let cycleTimer: ReturnType<typeof setTimeout> | undefined
  const cycle = () => {
    try {
      runConnectorCycle(orgsDir, projectId)
    } catch (error) {
      console.error(`Could not work out the Connector's to-do list: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  const scheduleCycle = () => {
    if (cycleTimer) clearTimeout(cycleTimer)
    cycleTimer = setTimeout(cycle, 2000)
  }
  const hub = createLiveHub(orgsDir, (change) => {
    if (change.slug !== '*') {
      // Seats, org.md, processes, and requests change what Grok Bot should get; run log lines do not.
      if (change.kind !== 'log') scheduleCycle()
      if (change.kind !== 'grok') return
      clearTimeout(updateTimers.get(change.slug))
      updateTimers.set(change.slug, setTimeout(() => clearUpdates(change.slug), 2000))
      return
    }
    if (runTimer) clearTimeout(runTimer)
    runTimer = setTimeout(() => {
      cycle()
      logRun()
    }, 2000)
  })
  try {
    writeConnectorGuide(orgsDir, projectId)
  } catch (error) {
    console.error(`Could not write CONNECTOR.md: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  // A dump that arrived while the writer was off.
  cycle()
  // A run that happened while the writer was off, then a check every minute for a Connector that stopped.
  logRun()
  // A snapshot that changed while the writer was off.
  for (const slug of listOrgSlugs(orgsDir)) clearUpdates(slug)
  const stopCheck = setInterval(() => {
    try {
      checkConnectorStopped(orgsDir)
    } catch {
      // The next minute tries again.
    }
  }, 60_000)
  stopCheck.unref?.()
  const requested = options?.port ?? Number(process.env.PORT || '8787')
  const startPort = Number.isInteger(requested) && requested >= 0 && requested <= 65535 ? requested : 8787
  return new Promise((listenResolve, reject) => {
    const listen = (port: number, left: number) => {
      const server = createServer((req, res) => {
        void handle(req, res, orgsDir, hub)
      })
      const onError = (err: NodeJS.ErrnoException) => {
        try {
          server.close()
        } catch {
          // Listen never started, so there is nothing to close.
        }
        if (err.code === 'EADDRINUSE' && port !== 0 && left > 0) {
          listen(port + 1, left - 1)
          return
        }
        reject(err)
      }
      server.once('error', onError)
      server.listen(port, host, () => {
        server.removeListener('error', onError)
        const address = server.address()
        const bound = typeof address === 'object' && address ? address.port : port
        console.info(`Template file API listening on http://${host}:${bound}`)
        listenResolve({
          port: bound,
          close: () => new Promise((done) => {
            clearInterval(stopCheck)
            if (runTimer) clearTimeout(runTimer)
            for (const timer of updateTimers.values()) clearTimeout(timer)
            if (cycleTimer) clearTimeout(cycleTimer)
            hub.close()
            server.close(() => done())
          }),
        })
      })
    }
    listen(startPort, 20)
  })
}

function allowLoopback(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return
  res.setHeader('access-control-allow-origin', origin)
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('vary', 'origin')
}

async function handle(req: IncomingMessage, res: ServerResponse, orgsDir: string, hub: { publish: (slug: string, kind: LiveKind) => void; subscribe: (slug: string, res: ServerResponse) => () => void }) {
  try {
    allowLoopback(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/api/session' && req.method === 'GET') {
      send(res, 200, { user: null, teams: [], csrfToken: '', authEnabled: false })
      return
    }
    if (url.pathname === '/api/connector' && req.method === 'GET') {
      send(res, 200, connectorInfo(orgsDir))
      return
    }
    if (url.pathname === '/api/orgs' && req.method === 'GET') {
      const orgs = listOrgSlugs(orgsDir).map((slug) => {
        const read = readOrgDir(resolve(orgsDir, slug), slug)
        return { slug, name: read.ok ? read.bundle.org.company.name : slug, ok: read.ok, errors: read.ok ? [] : read.errors }
      })
      send(res, 200, { orgs })
      return
    }
    if (url.pathname === '/api/project/sync-minutes' && req.method === 'PUT') {
      // Changes the Connector prompt, so only this computer may reach it.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may change the interval.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let minutes: unknown
      try {
        minutes = (JSON.parse(body) as { minutes?: unknown }).minutes
      } catch {
        return send(res, 422, { error: 'That body is not JSON.' })
      }
      const saved = writeSyncMinutes(orgsDir, typeof minutes === 'number' ? minutes : NaN)
      if (!saved.ok) return send(res, 422, { error: saved.error })
      // The Connector reads its schedule from CONNECTOR.md, so a new interval needs no paste.
      writeConnectorGuide(orgsDir, ensureProjectId(orgsDir))
      send(res, 200, { minutes: saved.minutes, processes: syncConnectorProcesses(orgsDir, saved.minutes) })
      return
    }
    if (url.pathname === '/api/connector/remove-copy' && req.method === 'POST') {
      // Rewrites bots in Grok Bot, so only this computer may reach it.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may remove blocks.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let copy: unknown
      try {
        copy = (JSON.parse(body) as { copy?: unknown }).copy
      } catch {
        return send(res, 422, { error: 'That body is not JSON.' })
      }
      const saved = writeRemoveCopy(orgsDir, typeof copy === 'string' ? copy : '')
      if (!saved.ok) return send(res, 422, { error: saved.error })
      // The next to-do list removes those blocks; the Connector sends it on its next run.
      runConnectorCycle(orgsDir, ensureProjectId(orgsDir))
      send(res, 200, { removeCopies: saved.removeCopies })
      return
    }
    if (url.pathname === '/api/orgs' && req.method === 'POST') {
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as { name?: string; owner?: string }
      const created = createOrgFiles(orgsDir, parsed.name || '', parsed.owner || '')
      if (!created.ok) return send(res, 422, { errors: created.errors })
      send(res, 201, { ok: true, slug: created.slug })
      return
    }
    if (url.pathname === '/api/orgs/from-template' && req.method === 'POST') {
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as { slug?: string; name?: string }
      const samplesDir = resolve(process.env.SAMPLES_DIR || resolve(process.cwd(), 'samples'))
      const copied = copyTemplateOrg(orgsDir, samplesDir, parsed.slug || '', parsed.name)
      if (!copied.ok) return send(res, 422, { errors: copied.errors })
      send(res, 201, { ok: true, slug: copied.slug })
      return
    }
    const profileMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/profile$/.exec(url.pathname)
    if (profileMatch && req.method === 'GET') {
      const slug = profileMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      send(res, 200, readOrgProfile(root, read.bundle.org, read.bundle.seats))
      return
    }
    if (profileMatch && req.method === 'PUT') {
      const slug = profileMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const written = writeOrgProfile(root, JSON.parse(body) as OrgProfile)
      if (!written.ok) return send(res, 422, { errors: written.errors })
      send(res, 200, { ok: true, files: [`orgs/${slug}/org.md`] })
      return
    }
    const seatsMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats$/.exec(url.pathname)
    if (seatsMatch && req.method === 'POST') {
      const slug = seatsMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const created = createHiredSeat(root, slug, JSON.parse(body) as HiredSeatInput)
      if (!created.ok) return send(res, 422, { errors: created.errors })
      send(res, 201, { ok: true, slug: created.slug, file: created.file })
      return
    }
    const existingMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/existing$/.exec(url.pathname)
    if (existingMatch && req.method === 'POST') {
      const slug = existingMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const created = createExistingBot(root, slug, JSON.parse(body) as ExistingBotInput)
      // 409 tells the page the bot is in another organization, so it can offer Add anyway.
      if (!created.ok) return send(res, created.otherOrgs ? 409 : 422, { errors: created.errors, ...(created.otherOrgs ? { otherOrgs: created.otherOrgs } : {}) })
      send(res, 201, { ok: true, slug: created.slug, file: created.file })
      return
    }
    const liveMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/live$/.exec(url.pathname)
    if (liveMatch && req.method === 'GET') {
      const slug = liveMatch[1]!
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 2000\n\n')
      const stop = hub.subscribe(slug, res)
      req.on('close', stop)
      return
    }
    const filesMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/files$/.exec(url.pathname)
    if (filesMatch && req.method === 'GET') {
      const guide = readFileGuide(orgsDir, filesMatch[1]!)
      if (!guide) return send(res, 404, { error: 'Org not found.' })
      send(res, 200, guide)
      return
    }
    const routinesMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/routines$/.exec(url.pathname)
    if (routinesMatch && req.method === 'GET') {
      const board = readRoutineBoard(orgsDir, routinesMatch[1]!)
      if (!board) return send(res, 404, { error: 'Org not found.' })
      send(res, 200, board)
      return
    }
    const runLogMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/run-log$/.exec(url.pathname)
    if (runLogMatch && req.method === 'GET') {
      const slug = runLogMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      send(res, 200, readRunLogDir(root))
      return
    }
    const processesFileMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/processes-file$/.exec(url.pathname)
    if (processesFileMatch && req.method === 'POST') {
      const slug = processesFileMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = parseProcessesFile(body)
      if (!parsed.ok) return send(res, 422, { errors: parsed.errors })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      // A processes file from Grok Bot describes routines the bots already run, so it asks no bot for a routine.
      const imported = importProcessRows(root, parsed.rows, read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title })))
      send(res, 200, imported)
      return
    }
    const processMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/processes\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname)
    if (processMatch && req.method === 'DELETE') {
      const slug = processMatch[1]!
      const processSlug = processMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const removed = deleteProcessFile(root, processSlug)
      if (!removed.ok) return send(res, 422, { errors: removed.errors })
      send(res, 200, { ok: true })
      return
    }
    const botsFileMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/bots-file$/.exec(url.pathname)
    if (botsFileMatch && req.method === 'POST') {
      const slug = botsFileMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = parseBotsFile(body)
      if (!parsed.ok) return send(res, 422, { errors: parsed.errors })
      const current = readOrgDir(root, slug)
      if (current.ok && importLocked(current.bundle.seats, readMainBot(orgsDir))) return send(res, 409, { error: IMPORT_LOCKED })
      send(res, 200, importBotsFile(root, slug, parsed.rows))
      return
    }
    const botsPreviewMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/bots-file\/preview$/.exec(url.pathname)
    if (botsPreviewMatch && req.method === 'POST') {
      const slug = botsPreviewMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = parseBotsFile(body)
      if (!parsed.ok) return send(res, 422, { errors: parsed.errors })
      const current = readOrgDir(root, slug)
      if (current.ok && importLocked(current.bundle.seats, readMainBot(orgsDir))) return send(res, 409, { error: IMPORT_LOCKED })
      send(res, 200, previewBotsFile(orgsDir, root, slug, parsed.rows))
      return
    }
    const connectorImportMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/connector-import$/.exec(url.pathname)
    if (connectorImportMatch && req.method === 'POST') {
      // Writes a seat for every bot, so a page on another site must not reach it.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may import bots.' })
      const slug = connectorImportMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const result = importFromConnector(orgsDir, root, slug)
      if ('status' in result) return send(res, result.status, { error: result.error })
      send(res, 200, result)
      return
    }
    const orgFileMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/org-file$/.exec(url.pathname)
    if (orgFileMatch && req.method === 'POST') {
      const slug = orgFileMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = parseOrgFile(body)
      if (!parsed.ok) return send(res, 422, { errors: parsed.errors })
      const current = readOrgDir(root, slug)
      if (current.ok && orgImportLocked(current.bundle.seats, readMainBot(orgsDir))) return send(res, 409, { errors: [ORG_IMPORT_LOCKED] })
      const result = importOrgFile(root, slug, parsed.file)
      if (!result.ok) return send(res, 422, { errors: result.errors })
      send(res, 200, result)
      return
    }
    const syncMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/sync$/.exec(url.pathname)
    if (syncMatch && req.method === 'GET') {
      const slug = syncMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const status = syncStatus(root, slug, orgsDir)
      if (!status.ok) return send(res, 422, { errors: status.errors })
      send(res, 200, status.status)
      return
    }
    const previewMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/sync\/preview$/.exec(url.pathname)
    if (previewMatch && req.method === 'POST') {
      const slug = previewMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const status = previewSnapshotJson(root, slug, body)
      if (!status.ok) return send(res, 422, { errors: status.errors })
      send(res, 200, status.status)
      return
    }
    const applyMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/sync\/apply$/.exec(url.pathname)
    if (applyMatch && req.method === 'POST') {
      const slug = applyMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let request: { source?: string; stamp?: string; json?: string }
      try {
        request = JSON.parse(body) as { source?: string; stamp?: string; json?: string }
      } catch {
        return send(res, 422, { errors: ['That body is not JSON.'] })
      }
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      let snapshot: Snapshot
      if (request.source === 'json') {
        const parsed = parseSnapshot(request.json || '', new Date().toISOString())
        if (!parsed.ok) return send(res, 422, { errors: [parsed.error] })
        snapshot = parsed.snapshot
      } else {
        if (!request.stamp) return send(res, 422, { errors: ['Send the snapshot stamp from the preview.'] })
        const snap = readSnapshot(root)
        if (!snap.ok) return send(res, snap.missing ? 404 : 422, { error: snap.missing ? 'No snapshot yet.' : snap.error })
        if (request.stamp !== snap.stamp) return send(res, 409, { error: 'The snapshot changed. Review it again.' })
        snapshot = snap.snapshot
      }
      const plan = planSync(snapshot, grokSeats(read.bundle.seats), read.bundle.processes ?? [], read.bundle.org.company.name, accountBots(orgsDir, slug))
      const applied = applySync(root, slug, plan)
      if (!applied.ok) return send(res, 422, { errors: applied.errors })
      // Only the Connector's own snapshot proves a bot exists; a pasted file does not clear requests.
      if (request.source !== 'json') {
        clearFulfilledRequests(root, slug, plan)
        clearHandledUpdates(root, slug)
      }
      send(res, 200, applied)
      return
    }
    const adoptMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/sync\/adopt$/.exec(url.pathname)
    if (adoptMatch && req.method === 'POST') {
      const slug = adoptMatch[1]!
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may add bots.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { errors: ['Send JSON.'] })
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let names: string[] = []
      try {
        const parsed = (JSON.parse(body) as { names?: unknown }).names
        names = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
      } catch {
        return send(res, 422, { errors: ['That body is not JSON.'] })
      }
      const added = adoptUnassigned(orgsDir, root, slug, names)
      if (!added.ok) return send(res, 422, { errors: added.errors })
      send(res, 200, added)
      return
    }
    const requestsMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/grok\/requests$/.exec(url.pathname)
    if (requestsMatch && req.method === 'POST') {
      const slug = requestsMatch[1]!
      // This route leads to a bot being created in Grok Bot, so a page on another site must not reach it:
      // JSON forces a CORS preflight, which only loopback origins pass, and a foreign Origin is refused outright.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may ask for a bot.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { errors: ['Send JSON.'] })
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let seat = ''
      try {
        seat = String((JSON.parse(body) as { seat?: unknown }).seat ?? '')
      } catch {
        return send(res, 422, { errors: ['That body is not JSON.'] })
      }
      const made = requestGrokBot(root, slug, seat, orgsDir)
      if (!made.ok) return send(res, 422, { errors: made.errors })
      send(res, 200, { ok: true, request: made.request })
      return
    }
    const profileAsksMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/grok\/profile-asks$/.exec(url.pathname)
    if (profileAsksMatch && req.method === 'POST') {
      const slug = profileAsksMatch[1]!
      // This route leads to messages being sent to bots, so only this computer may reach it.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may ask the bots.' })
      // JSON forces a CORS preflight, which only loopback origins pass; a plain form post from another site is refused here.
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' })
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      const askedAt = new Date().toISOString()
      writeProfileAsk(root, askedAt)
      // The items go on the Connector's list at once, so the Sync drawer says what waits for the owner's chat.
      runConnectorCycle(orgsDir, ensureProjectId(orgsDir))
      const bots = grokSeats(read.bundle.seats).filter((seat) => seat.kind === 'bot' && seat.status !== 'retired' && !isConnectorName(seat.title)).length
      send(res, 200, { askedAt, bots })
      return
    }
    const updatesMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/grok\/updates$/.exec(url.pathname)
    if (updatesMatch && req.method === 'POST') {
      const slug = updatesMatch[1]!
      // Like a create request, this changes a bot in Grok Bot, so only this computer may ask.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may update a bot.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { errors: ['Send JSON.'] })
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let seat = ''
      try {
        seat = String((JSON.parse(body) as { seat?: unknown }).seat ?? '')
      } catch {
        return send(res, 422, { errors: ['That body is not JSON.'] })
      }
      const asked = requestGrokUpdate(root, slug, seat)
      if (!asked.ok) return send(res, 422, { errors: asked.errors })
      send(res, 200, { ok: true, request: asked.request })
      return
    }
    const managerMatch =/^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/([a-z0-9]+(?:-[a-z0-9]+)*)\/manager$/.exec(url.pathname)
    if (managerMatch && req.method === 'PUT') {
      const slug = managerMatch[1]!
      const seatSlug = managerMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as { reportsTo?: string; alsoReportsTo?: unknown }
      const also = Array.isArray(parsed.alsoReportsTo) ? parsed.alsoReportsTo.filter((item): item is string => typeof item === 'string') : undefined
      const moved = setSeatManagers(root, slug, seatSlug, parsed.reportsTo || '', also)
      if (!moved.ok) return send(res, 422, { errors: moved.errors })
      send(res, 200, { ok: true, file: moved.file, sent: moved.sent })
      return
    }
    const profileSeatMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/([a-z0-9]+(?:-[a-z0-9]+)*)\/profile$/.exec(url.pathname)
    if (profileSeatMatch && req.method === 'PUT') {
      const root = orgRoot(orgsDir, profileSeatMatch[1]!)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const updated = updateSeatProfile(root, profileSeatMatch[1]!, profileSeatMatch[2]!, JSON.parse(body) as SeatProfileInput)
      if (!updated.ok) return send(res, 422, { errors: updated.errors })
      send(res, 200, { ok: true, file: updated.file })
      return
    }
    const seatMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname)
    if (seatMatch && req.method === 'PUT') {
      const slug = seatMatch[1]!
      const seatSlug = seatMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as HiredSeatInput
      const updated = updateSeatCard(root, slug, seatSlug, {
        owns: lineList(parsed.owns),
        may: lineList(parsed.may),
        mustAskBefore: lineList(parsed.mustAskBefore),
        doneWhen: lineList(parsed.doneWhen),
        addToGrokBotUrl: parsed.addToGrokBotUrl,
      })
      if (!updated.ok) return send(res, 422, { errors: updated.errors })
      send(res, 200, { ok: true, file: updated.file })
      return
    }
    const greyedMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(move-here|publish|main-bot)$/.exec(url.pathname)
    if ((greyedMatch && req.method === 'POST') || (seatMatch && req.method === 'DELETE')) {
      // Retires, creates, or removes bots across organizations, so only this computer may ask.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may change where a bot works.' })
      const slug = (greyedMatch ?? seatMatch)![1]!
      const seatSlug = (greyedMatch ?? seatMatch)![2]!
      let done: { ok: true } | { ok: false; errors: string[] }
      if (!greyedMatch) done = removeGreyedSeat(orgsDir, slug, seatSlug)
      else if (greyedMatch[3] === 'move-here') done = moveBotHere(orgsDir, slug, seatSlug)
      else if (greyedMatch[3] === 'main-bot') done = markMainBot(orgsDir, slug, seatSlug)
      else {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { errors: ['Send JSON.'] })
        const body = await readBody(req)
        if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
        let name = ''
        try {
          const value = (JSON.parse(body) as { name?: unknown }).name
          name = typeof value === 'string' ? value : ''
        } catch {
          return send(res, 422, { errors: ['That body is not JSON.'] })
        }
        done = publishCopy(orgsDir, slug, seatSlug, name)
      }
      if (!done.ok) return send(res, 422, { errors: done.errors })
      send(res, 200, { ok: true })
      return
    }
    const orgMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname)
    const activityMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/activity$/.exec(url.pathname)
    const exportMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/export$/.exec(url.pathname)
    const importMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/import$/.exec(url.pathname)
    if ((url.pathname === '/api/template' && req.method === 'GET') || (orgMatch && req.method === 'GET')) {
      const slug = orgMatch?.[1] ?? DEFAULT_ORG_SLUG
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      send(res, 200, read.bundle)
      return
    }
    if (orgMatch && req.method === 'DELETE') {
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may delete an organization.' })
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Send JSON.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let confirm = ''
      try {
        const value = (JSON.parse(body) as { confirm?: unknown }).confirm
        confirm = typeof value === 'string' ? value : ''
      } catch {
        return send(res, 422, { error: 'That body is not JSON.' })
      }
      const deleted = deleteOrg(orgsDir, orgMatch[1]!, confirm)
      if (!deleted.ok) return send(res, deleted.status, { error: deleted.error })
      // The watcher does not see a folder move into orgs/.deleted/, so the to-do list would still send this
      // organization's blocks. Work it out again now, before the page hears back.
      try {
        runConnectorCycle(orgsDir, ensureProjectId(orgsDir))
      } catch (error) {
        console.error(`Could not work out the Connector's to-do list: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
      send(res, 200, { next: deleted.next })
      return
    }
    if ((url.pathname === '/api/template' && req.method === 'PUT') || (orgMatch && req.method === 'PUT')) {
      const slug = orgMatch?.[1] ?? DEFAULT_ORG_SLUG
      const root = orgRoot(orgsDir, slug)
      if (!root) return send(res, 400, { error: 'Bad org slug.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as { org: OrgDocument; seats: SeatDocument[]; work: WorkDocument; activityAppend?: FileActivity[] }
      const existing = orgExists(root) ? readOrgDir(root, slug) : null
      const bundle: OrgBundle = {
        id: slug,
        org: parsed.org,
        seats: parsed.seats,
        work: parsed.work,
        activity: existing && existing.ok ? existing.bundle.activity : [],
      }
      for (const seat of bundle.seats) {
        const check = parseSeatMarkdown(seat.slug, seat.source || serializeSeat(seat))
        if (!check.ok) return send(res, 422, { errors: check.errors })
        Object.assign(seat, check.seat)
      }
      const onDisk = new Map(existing && existing.ok ? existing.bundle.seats.map((seat) => [seat.slug, seat]) : [])
      const cardErrors = bundle.seats.filter((seat) => !cardUnchanged(seat, onDisk.get(seat.slug))).flatMap((seat) => activeBotCardErrors(seat))
      if (cardErrors.length) return send(res, 422, { errors: cardErrors })
      const written = writeOrgDir(root, bundle)
      if (written.errors.length) return send(res, 422, { errors: written.errors })
      const appended: string[] = []
      for (const event of (parsed.activityAppend ?? []).filter((event) => event.type !== 'edit')) {
        const line = appendActivity(root, { ...event, orgId: slug })
        if (line.errors.length) return send(res, 422, { errors: line.errors, files: written.files })
        appended.push(...line.files)
      }
      const actor = managerSeat(bundle.seats)?.slug || written.retired[0]?.slug || 'you'
      for (const seat of written.retired) {
        const line = appendActivity(root, {
          id: `fire-${seat.slug}-${seat.retiredAt}`,
          orgId: slug,
          type: 'fire',
          actorSeatId: actor,
          actorType: 'human',
          timestamp: seat.retiredAt,
          summary: `Retired ${seat.title}`,
          subjectSeatId: seat.slug,
        })
        if (line.errors.length) return send(res, 422, { errors: line.errors, files: written.files })
        appended.push(...line.files)
      }
      send(res, 200, {
        ok: true,
        files: [...written.files, ...appended].map((file) => `orgs/${slug}/${file}`),
        savedAt: new Date().toISOString(),
      })
      return
    }
    if (activityMatch && req.method === 'POST') {
      const slug = activityMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const event = JSON.parse(body) as FileActivity
      const written = appendActivity(root, { ...event, orgId: slug })
      if (written.errors.length) return send(res, 422, { errors: written.errors })
      send(res, 201, { ok: true, files: written.files.map((file) => `orgs/${slug}/${file}`) })
      return
    }
    if (exportMatch && req.method === 'GET') {
      const slug = exportMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root) return send(res, 404, { error: 'Org not found.' })
      const zipped = orgZip(root, slug)
      if (!zipped.ok) return send(res, 422, { errors: zipped.errors })
      res.statusCode = 200
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-disposition', `attachment; filename="${zipped.filename}"`)
      res.setHeader('cache-control', 'no-store')
      res.end(zipped.body)
      return
    }
    if (importMatch && req.method === 'POST') {
      const slug = importMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root) return send(res, 400, { error: 'Bad org slug.' })
      const raw = await readRaw(req)
      if (raw === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const zip = String(req.headers['content-type'] || '').includes('zip') || (raw.length >= 4 && raw.readUInt32LE(0) === 0x04034b50)
      if (zip) {
        const imported = importOrgBackup(root, slug, raw)
        if (!imported.ok) return send(res, imported.status, { errors: imported.errors })
        send(res, 200, { ok: true, slug, files: imported.files })
        return
      }
      // Import folder: the page reads the folder and sends its files. Processes, run logs, and waiting requests come along when the folder has them.
      const parsed = JSON.parse(raw.toString('utf8')) as OrgBundle & BackupExtras
      // Requests go through the same reader as the file, so a bad entry is skipped.
      const sentRequests = Array.isArray(parsed.requests) ? parseRequests(JSON.stringify({ requests: parsed.requests })) : null
      const extras: BackupExtras = {
        processes: Array.isArray(parsed.processes) ? parsed.processes : undefined,
        runLogs: Array.isArray(parsed.runLogs) ? parsed.runLogs : undefined,
        requests: sentRequests?.ok ? sentRequests.requests : undefined,
      }
      const imported = importOrgBundle(root, slug, parsed, extras)
      if (!imported.ok) return send(res, imported.status, { errors: imported.errors })
      send(res, 200, { ok: true, slug, files: imported.files })
      return
    }
    send(res, 404, { error: 'Not found.' })
  } catch (error) {
    console.error(error)
    send(res, 400, { error: 'Could not save the org files.' })
  }
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Restores an exported zip into this org. A zip with backup.json also restores processes and run logs. */
export function importOrgBackup(root: string, slug: string, raw: Buffer): { ok: true; files: string[] } | { ok: false; status: number; errors: string[] } {
  let entries: { name: string; data: Buffer }[]
  try {
    entries = unzipStore(raw)
  } catch (error) {
    return { ok: false, status: 422, errors: [error instanceof Error ? error.message : 'Could not read the zip.'] }
  }
  const built = bundleFromZip(entries)
  if (!built.ok) return { ok: false, status: 422, errors: built.errors }
  return importOrgBundle(root, slug, built.bundle, built.extras)
}

/** Checks every process file and run-log name before anything on disk changes. */
function checkExtras(extras: BackupExtras): string[] {
  const errors: string[] = []
  for (const item of extras.processes ?? []) {
    if (!item || typeof item.slug !== 'string' || !SEAT_SLUG.test(item.slug) || typeof item.source !== 'string') {
      errors.push('processes: a file name is not valid.')
      continue
    }
    const parsed = parseProcessMarkdown(item.slug, normalizeText(item.source))
    if (!parsed.ok) errors.push(...parsed.errors.map((error) => `processes/${item.slug}.md: ${error}`))
  }
  for (const item of extras.runLogs ?? []) {
    if (!item || typeof item.name !== 'string' || !isRunLogName(item.name) || typeof item.source !== 'string') errors.push('log: a run log name is not valid.')
  }
  return errors
}

/** Replaces the .md files of one folder with the backup's. */
function replaceFolder(dir: string, keep: (name: string) => boolean, files: { name: string; source: string }[]): string[] {
  mkdirSync(dir, { recursive: true })
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.md') && keep(name)) unlinkSync(resolve(dir, name))
  }
  for (const file of files) writeFileSync(resolve(dir, file.name), normalizeText(file.source))
  return files.map((file) => file.name)
}

function importOrgBundle(root: string, slug: string, parsed: OrgBundle, extras: BackupExtras = {}): { ok: true; files: string[] } | { ok: false; status: number; errors: string[] } {
  const extraErrors = checkExtras(extras)
  if (extraErrors.length) return { ok: false, status: 422, errors: extraErrors }
  const bundle: OrgBundle = {
    id: slug,
    org: parsed.org,
    seats: parsed.seats,
    work: parsed.work,
    activity: (parsed.activity ?? []).map((event) => ({ ...event, orgId: slug })),
  }
  for (const seat of bundle.seats) {
    const check = parseSeatMarkdown(seat.slug, seat.source || serializeSeat(seat))
    if (!check.ok) return { ok: false, status: 422, errors: check.errors.map((error) => `${seat.slug}.md: ${error}`) }
    Object.assign(seat, check.seat)
    const cardErrors = activeBotCardErrors(seat)
    if (cardErrors.length) return { ok: false, status: 422, errors: cardErrors }
  }
  const activityErrors = bundle.activity.flatMap((event, index) => validateActivity(event, slug).map((error) => error.replace('activity.jsonl:', `activity.jsonl line ${index + 1}:`)))
  if (activityErrors.length) return { ok: false, status: 422, errors: activityErrors }
  const logDir = resolve(root, 'log')
  if (existsSync(logDir)) {
    // Log events are replaced. Daily run logs are only replaced when the backup carries them.
    for (const name of readdirSync(logDir)) {
      if (!name.endsWith('.md')) continue
      if (isRunLogName(name) && !extras.runLogs) continue
      unlinkSync(resolve(logDir, name))
    }
  }
  const written = writeOrgDir(root, bundle)
  if (written.errors.length) return { ok: false, status: 422, errors: written.errors }
  const files = written.files.map((file) => `orgs/${slug}/${file}`)
  if (extras.runLogs) {
    for (const name of replaceFolder(logDir, (file) => isRunLogName(file), extras.runLogs)) files.push(`orgs/${slug}/log/${name}`)
  }
  if (extras.processes) {
    const processes = extras.processes.map((item) => ({ name: `${item.slug}.md`, source: item.source }))
    for (const name of replaceFolder(resolve(root, 'processes'), () => true, processes)) files.push(`orgs/${slug}/processes/${name}`)
  }
  if (extras.requests) {
    // A request names its seat file by absolute path, so it points at this computer's copy. Seats the backup lacks lose theirs.
    const seats = new Set(bundle.seats.map((seat) => seat.slug))
    const kept = extras.requests.filter((item) => seats.has(item.seat)).map((item) => ({ ...item, seatFile: resolve(root, 'seats', `${item.seat}.md`) }))
    if (kept.length || existsSync(resolve(root, REQUESTS_PATH))) {
      writeRequests(root, kept)
      files.push(`orgs/${slug}/${REQUESTS_PATH}`)
    }
  }
  return { ok: true, files }
}

function bundleFromZip(entries: { name: string; data: Buffer }[]): { ok: true; bundle: OrgBundle; extras: BackupExtras } | { ok: false; errors: string[] } {
  const prefix = zipPrefix(entries.map((entry) => entry.name))
  const files = new Map(entries.map((entry) => [prefix ? entry.name.slice(prefix.length) : entry.name, entry.data]))
  const errors: string[] = []
  let org: OrgDocument
  let work: WorkDocument
  const orgMd = files.get('org.md')
  const workMd = files.get('work-chart.md')
  if (orgMd && workMd && (orgMd.toString('utf8').includes('\n## Chart') || orgMd.toString('utf8').startsWith('## Chart'))) {
    const parsedOrg = parseOrgMarkdown(orgMd.toString('utf8'))
    if (!parsedOrg.ok) return parsedOrg
    const parsedWork = parseWorkMarkdown(workMd.toString('utf8'))
    if (!parsedWork.ok) return parsedWork
    org = parsedOrg.org
    work = parsedWork.work
  } else {
    const orgFile = files.get('org.json')
    const workFile = files.get('workchart.json')
    if (!orgFile) errors.push('org.md: file is missing.')
    if (!workFile) errors.push('work-chart.md: file is missing.')
    if (!orgFile || !workFile) return { ok: false, errors }
    try {
      org = JSON.parse(orgFile.toString('utf8')) as OrgDocument
    } catch {
      return { ok: false, errors: ['org.json: could not read organization data.'] }
    }
    try {
      work = JSON.parse(workFile.toString('utf8')) as WorkDocument
    } catch {
      return { ok: false, errors: ['workchart.json: could not read the work chart.'] }
    }
  }
  const activity: FileActivity[] = []
  const activityText = files.get('activity.jsonl')?.toString('utf8') ?? ''
  if (activityText.trim()) {
    try {
      activity.push(...activityText.trim().split(/\n/).map((line) => JSON.parse(line) as FileActivity))
    } catch {
      return { ok: false, errors: ['activity.jsonl: not JSON.'] }
    }
  }
  const runLogs: { name: string; source: string }[] = []
  for (const [name, data] of files) {
    const match = /^log\/(.+\.md)$/.exec(name)
    if (!match) continue
    // A daily run log is not an event; it is restored as it is.
    if (isRunLogName(match[1]!)) {
      runLogs.push({ name: match[1]!, source: data.toString('utf8') })
      continue
    }
    const parsed = parseLogMarkdown(data.toString('utf8'), name)
    if (!parsed.ok) return parsed
    activity.push(parsed.event)
  }
  const processes: { slug: string; source: string }[] = []
  for (const [name, data] of files) {
    const match = /^processes\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(name)
    if (match) processes.push({ slug: match[1]!, source: data.toString('utf8') })
  }
  // A full backup says so; then processes and run logs are restored exactly, even when it has none.
  let full = false
  let savesRequests = false
  const note = files.get(BACKUP_NOTE)
  if (note) {
    try {
      const data = JSON.parse(normalizeText(note.toString('utf8'))) as { includes?: unknown }
      full = Array.isArray(data.includes) && data.includes.includes('processes') && data.includes.includes('runLogs')
      savesRequests = Array.isArray(data.includes) && data.includes.includes('requests')
    } catch {
      return { ok: false, errors: [`${BACKUP_NOTE}: not JSON.`] }
    }
  }
  // A backup that saved requests restores them, none included; a bad requests file is skipped and the ones here stay.
  const requestsFile = files.get(REQUESTS_PATH)
  const parsedRequests = requestsFile ? parseRequests(requestsFile.toString('utf8')) : null
  const extras: BackupExtras = {
    processes: full || processes.length ? processes : undefined,
    runLogs: full || runLogs.length ? runLogs : undefined,
    requests: parsedRequests ? (parsedRequests.ok ? parsedRequests.requests : undefined) : savesRequests ? [] : undefined,
  }
  const seats: SeatDocument[] = []
  for (const [name, data] of files) {
    const match = /^seats\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(name)
    if (!match) continue
    seats.push({ slug: match[1]!, source: data.toString('utf8') } as SeatDocument)
  }
  if (!seats.length) return { ok: false, errors: ['seats: folder is missing.'] }
  return { ok: true, bundle: { id: 'import', org, seats, work, activity }, extras }
}

function zipPrefix(names: string[]): string {
  if (names.includes('org.json') || names.includes('org.md')) return ''
  const tops = [...new Set(names.map((name) => name.split('/')[0]).filter(Boolean))]
  if (tops.length !== 1) return ''
  const top = `${tops[0]}/`
  return names.some((name) => name === `${top}org.json` || name === `${top}org.md`) ? top : ''
}

function readRaw(req: IncomingMessage): Promise<Buffer | 'too-big'> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY) {
        req.destroy()
        resolveBody('too-big')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function readBody(req: IncomingMessage): Promise<string | 'too-big'> {
  return readRaw(req).then((body) => (body === 'too-big' ? body : body.toString('utf8')))
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/**
 * An org's folder name, and its id: org- and 8 letters or digits without look-alikes. It never changes, so a bot
 * that was told the folder path always finds its files; the name lives in org.md alone.
 */
export function newOrgId(random: () => number = Math.random): string {
  let id = 'org-'
  for (let n = 0; n < 8; n += 1) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)]
  return id
}

export function uniqueOrgId(orgsDir: string, random: () => number = Math.random): string {
  for (let tries = 0; tries < 100; tries += 1) {
    const id = newOrgId(random)
    if (!existsSync(resolve(orgsDir, id))) return id
  }
  return `org-${Date.now().toString(36)}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'OR'
}

function blankSeat(owner: string): SeatDocument {
  const seat: SeatDocument = {
    slug: 'you',
    title: owner,
    department: 'general',
    reportsTo: '',
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'human',
    role: 'Owner',
    personId: 'person-you',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    owns: ['The approve'],
    may: ['Edit this org'],
    mustAskBefore: ['Anything that cannot be undone'],
    doneWhen: ['A person has approved it'],
    source: '',
  }
  seat.source = serializeSeat(seat)
  return seat
}

function blankWork(ownerSeatId: string): WorkDocument {
  return {
    triggers: [{ id: 'start', source: 'management', label: 'Start', example: 'Name the work' }],
    workstreams: [{ id: 'main', triggerId: 'start', outcome: 'The work is done', ownerSeatId, kind: 'main', stepIds: ['step-1'] }],
    steps: [{ id: 'step-1', workstreamId: 'main', name: 'First step', level: 2, executorSeatId: ownerSeatId }],
    handoffs: [],
    checkpoints: [],
  }
}

if (process.argv[1] && process.argv[1].endsWith('template-server.ts')) {
  const dir = orgsDirFromEnv()
  mkdirSync(dirname(resolve(dir, DEFAULT_ORG_SLUG, 'org.md')), { recursive: true })
  void startTemplateServer({ orgsDir: dir })
}
