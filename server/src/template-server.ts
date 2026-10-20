import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readText } from './text-file.ts'
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
  validateActivity,
  activeBotCardErrors,
  cardUnchanged,
  validateBundle,
  type FileActivity,
  type GrokSyncState,
  type OrgBundle,
  type OrgDocument,
  type OrgProfile,
  type SeatDocument,
  type WorkDocument,
} from './org-files.js'
import { logFileName, parseLogMarkdown, parseOrgMarkdown, parseWorkMarkdown, serializeLogMarkdown, serializeOrgMarkdown, serializeWorkMarkdown } from './org-markdown.js'
import { deleteProcessFile, importProcessRows, readProcessDir, writeProcessFile } from './process-files.js'
import { parseProcessesFile, parseProcessMarkdown, type ProcessFile } from './processes.js'
import { createLiveHub, type LiveKind } from './live-hub.js'
import { isRunLogName, planRun } from './run-log.js'
import { playRun, readRunLogDir } from './run-log-files.js'
import { parseBotsFile, resolveManager, type BotsFileRow } from './bots-file.js'
import { unzipStore, zipStore } from './zip-store.js'
import { parseSnapshot, planSync, patchSeatSource, summaryLine, type ProjectInfo, type Snapshot, type SyncCounts, type SyncPlan, type SyncStatus } from './grok-sync.js'
import { SNAPSHOT_PATH, connectorName } from './connector-prompt.js'
import { ensureProjectId, readConnector, readSyncMinutes, writeSyncMinutes } from './project.js'
import { checkConnectorStopped, recordConnectorRun } from './connector-log.js'
import { REQUESTS_PATH, addDelete, addRequest, canDelete, canRequest, deleteFor, dropRequests, fulfilledSeats, parseRequests, serializeRequests, stillInGrok, type GrokDelete, type GrokRequest, type ReportedBot } from './grok-requests.js'

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
  const slug = uniqueSlug(orgsDir, slugify(name))
  if (!SEAT_SLUG.test(slug)) return { ok: false, errors: ['Org name needs at least one letter or number.'] }
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
  const slug = uniqueSlug(orgsDir, slugify(companyName) || templateSlug)
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
  // The rest of the organization, as the files are on disk. grok/ stays out: the Connector rewrites it every run.
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
  files.push({ name: BACKUP_NOTE, data: Buffer.from(`${JSON.stringify({ app: 'BotsEverywhere', version: 2, exportedAt: new Date().toISOString(), includes: ['processes', 'runLogs'] }, null, 2)}\n`) })
  return { ok: true, body: zipStore(files), filename: `${slug}.zip` }
}

/** Says the zip is a full backup, so Import replaces processes and run logs too. Older zips have no note. */
const BACKUP_NOTE = 'backup.json'

interface BackupExtras {
  processes?: { slug: string; source: string }[]
  runLogs?: { name: string; source: string }[]
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
  const actor = read.bundle.seats.find((seat) => seat.kind === 'human')?.slug || slug
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
  botStatus?: SeatDocument['botStatus']
  /** Set by Sync with Grok Bot when the seat comes from a snapshot. */
  grokSync?: GrokSyncState
  grokSyncedAt?: string
  /** Bots-file import may omit card sections. The Add existing bot form still requires them. */
  allowEmptyCard?: boolean
}

/** Writes one seat for a bot the user already has. A taken slug is saved as `<slug>-2`. */
export function createExistingBot(
  root: string,
  orgId: string,
  input: ExistingBotInput,
): { ok: true; slug: string; file: string } | { ok: false; errors: string[] } {
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
    grokBotUrl,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.lastActive ? { lastActive: input.lastActive } : {}),
    ...(input.runs30d !== undefined ? { runs30d: input.runs30d } : {}),
    ...(input.tasksDone30d !== undefined ? { tasksDone30d: input.tasksDone30d } : {}),
    ...(input.routines?.length ? { routines: input.routines } : {}),
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
    grokBotUrl,
    reportsTo,
    ...card,
    createdAt: input.createdAt,
    lastActive: input.lastActive,
    runs30d: input.runs30d,
    tasksDone30d: input.tasksDone30d,
    routines: input.routines,
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
  const actor = read.bundle.seats.find((seat) => seat.kind === 'human')?.slug || reportsTo
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
}

/**
 * Writes one seat file per bot. Pass 1 creates every file. Pass 2 points
 * reportsTo at other bots from this same file, which did not exist yet in pass 1.
 * A slug that is already on disk is saved as `<slug>-2` and the first file is left alone.
 */
export function importBotsFile(
  root: string,
  orgId: string,
  rows: BotsFileRow[],
  stamp?: { grokSync: GrokSyncState; grokSyncedAt: string },
): BotsFileResult {
  if (!orgExists(root)) return { imported: [], errors: [{ name: 'File', error: 'Org not found.' }] }
  const read = readOrgDir(root, orgId)
  if (!read.ok) return { imported: [], errors: read.errors.map((error) => ({ name: 'File', error })) }
  const existing = read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title }))
  const taken = new Set(existing.map((seat) => seat.slug))
  const errors: { name: string; error: string }[] = []
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
  const batch = new Map<string, string>()
  for (const item of planned) {
    if (!item.slug) continue
    batch.set(item.row.name.trim().toLowerCase(), item.slug)
    batch.set(item.slug, item.slug)
  }
  const writes: { row: BotsFileRow; slug: string; manager: string; managerIsNew: boolean }[] = []
  for (const item of planned) {
    if (!item.slug) continue
    const resolved = resolveManager(item.row.reportsTo, item.row.name, existing, batch)
    if (!resolved.ok) {
      errors.push({ name: item.row.name, error: resolved.error })
      batch.delete(item.row.name.trim().toLowerCase())
      batch.delete(item.slug)
      continue
    }
    writes.push({ row: item.row, slug: item.slug, manager: resolved.slug, managerIsNew: resolved.isNew })
  }
  const dropped = new Set(writes.filter((item) => item.managerIsNew && !writes.some((other) => other.slug === item.manager)).map((item) => item.slug))
  const imported: { name: string; slug: string; file: string }[] = []
  for (const item of writes) {
    if (dropped.has(item.slug)) {
      errors.push({ name: item.row.name, error: `Reports to a bot that was not imported.` })
      continue
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
      createdAt: item.row.createdAt,
      lastActive: item.row.lastActive,
      runs30d: item.row.runs30d,
      tasksDone30d: item.row.tasksDone30d,
      routines: item.row.routines,
      botStatus: item.row.botStatus || undefined,
      grokSync: stamp?.grokSync,
      grokSyncedAt: stamp?.grokSyncedAt,
      allowEmptyCard: true,
    })
    if (!created.ok) {
      errors.push({ name: item.row.name, error: created.errors.join(' ') })
      continue
    }
    imported.push({ name: item.row.name, slug: created.slug, file: created.file })
  }
  const importedSlugs = new Set(imported.map((item) => item.slug))
  for (const item of writes) {
    if (!item.managerIsNew || !importedSlugs.has(item.slug)) continue
    if (!importedSlugs.has(item.manager)) {
      errors.push({ name: item.row.name, error: 'Reports to a bot that was not imported.' })
      continue
    }
    const pointed = retargetSeat(root, item.slug, item.manager)
    if (!pointed.ok) errors.push({ name: item.row.name, error: pointed.errors.join(' ') })
  }
  return { imported, errors }
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
export function readRequests(root: string): { requests: GrokRequest[]; deletes: GrokDelete[]; error: string } {
  const path = resolve(root, REQUESTS_PATH)
  if (!existsSync(path)) return { requests: [], deletes: [], error: '' }
  try {
    const parsed = parseRequests(readText(path))
    return parsed.ok ? { requests: parsed.requests, deletes: parsed.deletes, error: '' } : { requests: [], deletes: [], error: parsed.error }
  } catch {
    return { requests: [], deletes: [], error: 'grok/requests.json could not be read.' }
  }
}

function writeRequests(root: string, file: { requests: GrokRequest[]; deletes: GrokDelete[] }) {
  mkdirSync(resolve(root, 'grok'), { recursive: true })
  writeFileSync(resolve(root, REQUESTS_PATH), serializeRequests(file.requests, file.deletes))
}

/** Asks the Connector to create one bot in Grok Bot. Writes grok/requests.json only; the seat file is untouched. */
export function requestGrokBot(root: string, orgId: string, seatSlug: string, orgsDir = ''): { ok: true; request: GrokRequest } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === seatSlug)
  if (!seat) return { ok: false, errors: [`seats/${seatSlug}.md is not in this org.`] }
  if (!canRequest(seat)) return { ok: false, errors: [`${seat.title} is already in Grok Bot or is not an active bot.`] }
  const path = seatFile(root, seat.slug)
  if (!path) return { ok: false, errors: ['That seat slug is not valid.'] }
  // The directory sits beside orgs/ at the repo root.
  const directory = seat.directoryId && SEAT_SLUG.test(seat.directoryId) ? resolve(root, '..', '..', 'directory', `${seat.directoryId}.md`) : ''
  const request: GrokRequest = {
    seat: seat.slug,
    // Grok Bot keeps one bot per name across the whole project, so a title another org uses gets this org's name.
    name: (orgsDir ? renamedSeats(orgsDir, orgId)[seat.slug] : '') || seat.title,
    seatFile: path,
    promptFile: directory && existsSync(directory) ? directory : '',
    requestedAt: new Date().toISOString(),
  }
  const current = readRequests(root)
  writeRequests(root, { requests: addRequest(current.requests, request), deletes: current.deletes })
  const owner = read.bundle.seats.find((item) => item.kind === 'human' && item.status !== 'retired')
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
    stats: [`Name in Grok Bot=${request.name.replace(/[|=]/g, '/')}`, `Prompt=${request.promptFile ? 'from the directory' : 'from the seat card'}`, `Waiting=${readRequests(root).requests.length}`].join('|'),
  })
  return { ok: true, request }
}

/**
 * After a confirmed sync, drops requests for bots the snapshot found and for seats that are gone.
 * Each bot the Connector actually created gets one "Created in Grok Bot" line in Logs.
 */
export function clearFulfilledRequests(root: string, orgId: string, plan: SyncPlan) {
  const current = readRequests(root)
  if (current.error || current.requests.length === 0) return
  const read = readOrgDir(root, orgId)
  const found = fulfilledSeats(plan)
  const done = new Set(found)
  if (read.ok) {
    for (const item of current.requests) {
      const seat = read.bundle.seats.find((entry) => entry.slug === item.seat)
      if (!seat || !canRequest(seat)) done.add(item.seat)
    }
  }
  const next = dropRequests(current.requests, done)
  if (next.length === current.requests.length) return
  writeRequests(root, { requests: next, deletes: current.deletes })
  const owner = read.ok ? read.bundle.seats.find((item) => item.kind === 'human' && item.status !== 'retired') : undefined
  const at = new Date().toISOString()
  for (const item of current.requests) {
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

/** Asks the Connector to delete one retired bot in Grok Bot, by its link. Every retired seat here with that link shares the request. */
export function requestGrokDelete(root: string, orgId: string, seatSlug: string): { ok: true; request: GrokDelete } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === seatSlug)
  if (!seat) return { ok: false, errors: [`seats/${seatSlug}.md is not in this org.`] }
  if (!canDelete(seat)) return { ok: false, errors: [`${seat.title} is not a retired bot with a Grok Bot link.`] }
  const current = readRequests(root)
  if (current.error) return { ok: false, errors: [current.error] }
  const link = (seat.grokBotUrl ?? '').trim()
  const request: GrokDelete = {
    grokBotUrl: link,
    name: seat.title,
    seats: read.bundle.seats.filter((item) => canDelete(item) && (item.grokBotUrl ?? '').trim() === link).map((item) => item.slug),
    requestedAt: new Date().toISOString(),
  }
  writeRequests(root, { requests: current.requests, deletes: addDelete(current.deletes, request) })
  const owner = read.bundle.seats.find((item) => item.kind === 'human' && item.status !== 'retired')
  appendActivity(root, {
    id: `grok-delete-${seat.slug}-${request.requestedAt}`,
    orgId,
    type: 'edit',
    actorSeatId: owner?.slug || seat.slug,
    actorType: owner ? 'human' : 'bot',
    timestamp: request.requestedAt,
    summary: `Asked the Connector to delete ${seat.title} in Grok Bot`,
    subjectSeatId: seat.slug,
    grok: 'out',
    kind: 'request',
  })
  return { ok: true, request }
}

/** Takes back a delete the Connector has not done yet. */
export function cancelGrokDelete(root: string, orgId: string, seatSlug: string): { ok: true } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const seat = read.bundle.seats.find((item) => item.slug === seatSlug)
  if (!seat) return { ok: false, errors: [`seats/${seatSlug}.md is not in this org.`] }
  const current = readRequests(root)
  if (current.error) return { ok: false, errors: [current.error] }
  const waiting = deleteFor(current.deletes, seat)
  if (!waiting) return { ok: false, errors: [`No delete is waiting for ${seat.title}.`] }
  writeRequests(root, { requests: current.requests, deletes: current.deletes.filter((item) => item !== waiting) })
  const owner = read.bundle.seats.find((item) => item.kind === 'human' && item.status !== 'retired')
  const at = new Date().toISOString()
  appendActivity(root, {
    id: `grok-delete-cancel-${seat.slug}-${at}`,
    orgId,
    type: 'edit',
    actorSeatId: owner?.slug || seat.slug,
    actorType: owner ? 'human' : 'bot',
    timestamp: at,
    summary: `Cancelled the request to delete ${seat.title} in Grok Bot`,
    subjectSeatId: seat.slug,
    grok: 'out',
    kind: 'request',
  })
  return { ok: true }
}

/**
 * Called on each Connector run. Clears a delete request once a run newer than the request no longer reports
 * the bot anywhere: not in any org's snapshot and not in connector.json. An unreadable file counts as the bot still there.
 * Marks each seat of the request and logs one line. Returns the seats it marked per org, so the run log skips its own "no longer in Grok Bot" line for them.
 */
export function clearDeletedBots(orgsDir: string): Map<string, Set<string>> {
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
    const current = readRequests(root)
    if (current.error || current.deletes.length === 0) continue
    const done = current.deletes.filter((item) => {
      const asked = Date.parse(item.requestedAt)
      return !Number.isNaN(asked) && ranAt > asked && !stillInGrok(item, reported)
    })
    if (!done.length) continue
    writeRequests(root, { requests: current.requests, deletes: current.deletes.filter((item) => !done.includes(item)) })
    const read = readOrgDir(root, orgId)
    const owner = read.ok ? read.bundle.seats.find((item) => item.kind === 'human' && item.status !== 'retired') : undefined
    const seats = marked.get(orgId) ?? new Set<string>()
    for (const item of done) {
      for (const slug of item.seats) {
        if (markSeatDeleted(root, slug, item.grokBotUrl, at)) seats.add(slug)
      }
      appendActivity(root, {
        id: `grok-deleted-${item.seats[0] || 'bot'}-${at}`,
        orgId,
        type: 'edit',
        actorSeatId: owner?.slug || 'connector',
        actorType: owner ? 'human' : 'bot',
        timestamp: at,
        summary: `Deleted in Grok Bot: ${item.name}`,
        subjectSeatId: item.seats[0],
        grok: 'in',
        kind: 'deleted',
        stats: [`Asked=${item.requestedAt ? localStamp(item.requestedAt) : '-'}`, `Took=${item.requestedAt ? waitedFor(item.requestedAt, at) : '-'}`].join('|'),
      })
    }
    marked.set(orgId, seats)
  }
  return marked
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
  const { requests, deletes } = readRequests(root)
  const project = orgsDir ? projectInfo(orgsDir, orgId) : undefined
  const snap = readSnapshot(root)
  if (!snap.ok) {
    if (snap.missing) return { ok: true, status: { snapshot: null, error: '', plan: null, lastConfirmed, folder, requests, deletes, project } }
    return { ok: true, status: { snapshot: { stamp: snap.stamp, syncedAt: '' }, error: snap.error, plan: null, lastConfirmed, folder, requests, deletes, project } }
  }
  const plan = planSync(snap.snapshot, read.bundle.seats, read.bundle.processes ?? [], read.bundle.org.company.name, orgsDir ? accountBots(orgsDir, orgId) : [])
  return { ok: true, status: { snapshot: { stamp: snap.stamp, syncedAt: snap.snapshot.syncedAt }, error: '', plan, lastConfirmed, folder, requests, deletes, project } }
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
function projectBots(orgsDir: string): { orgId: string; orgName: string; slug: string; title: string }[] {
  return listOrgSlugs(orgsDir).flatMap((orgId) => {
    const read = readOrgDir(resolve(orgsDir, orgId), orgId)
    if (!read.ok) return []
    return read.bundle.seats
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

export function projectInfo(orgsDir: string, orgId: string): ProjectInfo {
  const id = ensureProjectId(orgsDir)
  const connector = readConnector(orgsDir)
  const bots = projectBots(orgsDir)
  return {
    id,
    connectorName: connectorName(id),
    orgsFolder: resolve(orgsDir),
    connector: connector ? { stamp: connector.stamp, syncedAt: connector.syncedAt, error: connector.error } : null,
    unassigned: connector?.unassigned.map((bot) => bot.name) ?? [],
    bots: bots.length,
    renamed: renamedSeats(orgsDir, orgId, bots),
    syncMinutes: readSyncMinutes(orgsDir),
  }
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
    const owner = read.bundle.seats.find((seat) => seat.kind === 'human' && seat.status !== 'retired')
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

export function previewSnapshotJson(root: string, orgId: string, json: string): { ok: true; status: SyncStatus } | { ok: false; errors: string[] } {
  const read = readOrgDir(root, orgId)
  if (!read.ok) return read
  const parsed = parseSnapshot(json, new Date().toISOString())
  if (!parsed.ok) return { ok: false, errors: [parsed.error] }
  const plan = planSync(parsed.snapshot, read.bundle.seats, read.bundle.processes ?? [], read.bundle.org.company.name)
  return { ok: true, status: { snapshot: { stamp: '', syncedAt: parsed.snapshot.syncedAt }, error: '', plan, lastConfirmed: lastSyncConfirmed(read.bundle), folder: resolve(root) } }
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
export function setSeatManager(root: string, orgId: string, slug: string, reportsTo: string): { ok: true; file: string } | { ok: false; errors: string[] } {
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
  const file = `orgs/${orgId}/seats/${slug}.md`
  if (seat.reportsTo === target) return { ok: true, file }
  const pointed = retargetSeat(root, slug, target)
  if (!pointed.ok) return pointed
  const actor = read.bundle.seats.find((item) => item.kind === 'human')?.slug || 'you'
  const stamp = new Date().toISOString()
  appendActivity(root, {
    id: `move-${slug}-${stamp}`,
    orgId,
    type: 'edit',
    actorSeatId: actor,
    actorType: 'human',
    timestamp: stamp,
    summary: `Moved ${seat.title} under ${manager.title}`,
    subjectSeatId: slug,
  })
  return { ok: true, file }
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
  if (!others.length) return { ok: false, status: 409, error: 'This is your only organization. Create another one first.' }
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
  return { ok: true, next: others[0]! }
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
  const hub = createLiveHub(orgsDir, (change) => {
    if (change.slug !== '*') return
    if (runTimer) clearTimeout(runTimer)
    runTimer = setTimeout(logRun, 2000)
  })
  // A run that happened while the writer was off, then a check every minute for a Connector that stopped.
  logRun()
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
      send(res, 200, { minutes: saved.minutes })
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
      if (!created.ok) return send(res, 422, { errors: created.errors })
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
    const runLogMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/run-log$/.exec(url.pathname)
    if (runLogMatch && req.method === 'GET') {
      const slug = runLogMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      send(res, 200, readRunLogDir(root))
      return
    }
    const simulateMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/processes\/([a-z0-9]+(?:-[a-z0-9]+)*)\/simulate$/.exec(url.pathname)
    if (simulateMatch && req.method === 'POST') {
      const slug = simulateMatch[1]!
      const processSlug = simulateMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      const process = (read.bundle.processes ?? []).find((item) => item.slug === processSlug)
      if (!process) return send(res, 404, { error: 'Process not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      let pace = 2000
      if (body.trim()) {
        try {
          const parsed = JSON.parse(body) as { paceMs?: unknown }
          if (typeof parsed.paceMs === 'number') pace = parsed.paceMs
        } catch {
          return send(res, 422, { errors: ['That body is not JSON.'] })
        }
      }
      const paceMs = Number.isFinite(pace) && pace >= 0 && pace <= 5000 ? pace : 2000
      const lines = planRun(process, read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title, kind: seat.kind, mustAskBefore: seat.mustAskBefore })))
      void playRun(root, lines, paceMs, () => hub.publish(slug, 'log'))
      send(res, 202, { ok: true, lines: lines.length })
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
      send(res, 200, importProcessRows(root, parsed.rows, read.bundle.seats.map((seat) => ({ slug: seat.slug, title: seat.title }))))
      return
    }
    const processMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/processes\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname)
    if (processMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const slug = processMatch[1]!
      const processSlug = processMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      if (req.method === 'DELETE') {
        const removed = deleteProcessFile(root, processSlug)
        if (!removed.ok) return send(res, 422, { errors: removed.errors })
        send(res, 200, { ok: true })
        return
      }
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const draft = JSON.parse(body) as ProcessFile
      const written = writeProcessFile(root, { ...draft, slug: processSlug }, draft.slug && draft.slug !== processSlug ? draft.slug : '')
      if (!written.ok) return send(res, 422, { errors: written.errors })
      send(res, 200, written)
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
      send(res, 200, importBotsFile(root, slug, parsed.rows))
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
      const plan = planSync(snapshot, read.bundle.seats, read.bundle.processes ?? [], read.bundle.org.company.name, accountBots(orgsDir, slug))
      const applied = applySync(root, slug, plan)
      if (!applied.ok) return send(res, 422, { errors: applied.errors })
      // Only the Connector's own snapshot proves a bot exists; a pasted file does not clear requests.
      if (request.source !== 'json') clearFulfilledRequests(root, slug, plan)
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
    const deletesMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/grok\/deletes$/.exec(url.pathname)
    if (deletesMatch && req.method === 'GET') {
      // Before the confirm: which organizations still have this bot active.
      const slug = deletesMatch[1]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const read = readOrgDir(root, slug)
      if (!read.ok) return send(res, 422, { errors: read.errors })
      const seat = read.bundle.seats.find((item) => item.slug === (url.searchParams.get('seat') ?? ''))
      if (!seat) return send(res, 404, { error: 'Seat not found.' })
      send(res, 200, { activeIn: activeWithLink(orgsDir, seat.grokBotUrl ?? '') })
      return
    }
    if (deletesMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const slug = deletesMatch[1]!
      // This route leads to a bot being deleted in Grok Bot, so only this computer may reach it, as for a create.
      const origin = req.headers.origin
      if (typeof origin === 'string' && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Only this computer may ask to delete a bot.' })
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
      if (req.method === 'DELETE') {
        const cancelled = cancelGrokDelete(root, slug, seat)
        if (!cancelled.ok) return send(res, 422, { errors: cancelled.errors })
        send(res, 200, { ok: true })
        return
      }
      const made = requestGrokDelete(root, slug, seat)
      if (!made.ok) return send(res, 422, { errors: made.errors })
      send(res, 200, { ok: true, request: made.request })
      return
    }
    const managerMatch = /^\/api\/orgs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/seats\/([a-z0-9]+(?:-[a-z0-9]+)*)\/manager$/.exec(url.pathname)
    if (managerMatch && req.method === 'PUT') {
      const slug = managerMatch[1]!
      const seatSlug = managerMatch[2]!
      const root = orgRoot(orgsDir, slug)
      if (!root || !orgExists(root)) return send(res, 404, { error: 'Org not found.' })
      const body = await readBody(req)
      if (body === 'too-big') return send(res, 413, { error: 'Request is too large.' })
      const parsed = JSON.parse(body) as { reportsTo?: string }
      const moved = setSeatManager(root, slug, seatSlug, parsed.reportsTo || '')
      if (!moved.ok) return send(res, 422, { errors: moved.errors })
      send(res, 200, { ok: true, file: moved.file })
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
      const actor = bundle.seats.find((seat) => seat.kind === 'human')?.slug || written.retired[0]?.slug || 'you'
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
      // Import folder: the page reads the folder and sends its files. Processes and run logs come along when the folder has them.
      const parsed = JSON.parse(raw.toString('utf8')) as OrgBundle & BackupExtras
      const extras: BackupExtras = {
        processes: Array.isArray(parsed.processes) ? parsed.processes : undefined,
        runLogs: Array.isArray(parsed.runLogs) ? parsed.runLogs : undefined,
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
  const note = files.get(BACKUP_NOTE)
  if (note) {
    try {
      const data = JSON.parse(normalizeText(note.toString('utf8'))) as { includes?: unknown }
      full = Array.isArray(data.includes) && data.includes.includes('processes') && data.includes.includes('runLogs')
    } catch {
      return { ok: false, errors: [`${BACKUP_NOTE}: not JSON.`] }
    }
  }
  const extras: BackupExtras = {
    processes: full || processes.length ? processes : undefined,
    runLogs: full || runLogs.length ? runLogs : undefined,
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

function uniqueSlug(orgsDir: string, base: string): string {
  const slug = base || 'org'
  if (!existsSync(resolve(orgsDir, slug))) return slug
  for (let n = 2; n < 100; n += 1) {
    const next = `${slug}-${n}`
    if (!existsSync(resolve(orgsDir, next))) return next
  }
  return `${slug}-${Date.now()}`
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
