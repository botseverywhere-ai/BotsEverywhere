import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { anyBlocks, copyBlocks, ownerText } from './bot-blocks.ts'
import type { BotsFileRow } from './bots-file.ts'
import { GROK_DATA_FILE, readTextFile } from './connector-files.ts'
import { CONNECTOR_BOT_NAME } from './connector-prompt.ts'
import type { AccountApp, Snapshot } from './grok-sync.ts'
import { normalizeText } from './normalize-text.ts'
import { cleanRoutines, type BotRoutine, type BotSkill, type OrgBundle, type SeatDocument } from './org-files.ts'
import { EVENT_SOURCES, type EventSource, type ProcessImportRow, type ProcessTrigger } from './processes.ts'

/**
 * What the Connector's run writes to orgs/grok-data.json: everything it can see in Grok Bot, and nothing it cannot. The app
 * decides from it which bots belong where and builds each organization's snapshot. A value left out is unknown.
 */
export interface GrokDataBot {
  id: string
  name: string
  grokBotUrl: string
  /** The bot's full instructions, exactly as Grok Bot holds them. */
  description: string
  section?: string
  createdAt?: string
  lastActive?: string
  runs30d?: number
  /** True only when the run could see this bot's routines. */
  routinesVisible: boolean
  routines?: BotRoutine[]
  tasksDone30d?: number
  publicUrl?: string
  /** The skills turned on for the bot, by name, as Grok Bot shows them. Absent from a Connector on older rules. */
  skills?: string[]
  /** For a bot new to the app: a card summed up from its description, used only to fill a new seat. */
  card?: { owns: string[]; may: string[]; needsApproval: string[]; doneWhen: string }
  /** Who the bot's own text, outside every BotsEverywhere block, says it reports to, by its name in Grok Bot. */
  reportsTo?: string
  alsoReportsTo?: string[]
}

export interface GrokData {
  dumpedAt: string
  copy: string
  bots: GrokDataBot[]
  skills: { name: string; description: string }[]
  /** The Connector itself, which the bots list leaves out. Absent from a Connector on older rules. */
  self?: { id: string; name: string; grokBotUrl: string }
}

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const date = (value: unknown): string | undefined => (str(value) && !Number.isNaN(Date.parse(str(value))) ? str(value) : undefined)
const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])

/**
 * Reads the dump. Anything malformed refuses the whole dump: a bot quietly skipped would look deleted from Grok Bot.
 */
export function parseGrokData(text: string): { ok: true; data: GrokData } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(normalizeText(text))
  } catch {
    return { ok: false, error: 'grok-data.json is not JSON.' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'grok-data.json is not an object.' }
  const dumpedAt = date(raw.dumpedAt)
  if (!dumpedAt) return { ok: false, error: 'grok-data.json has no dumpedAt date.' }
  if (!Array.isArray(raw.bots)) return { ok: false, error: 'grok-data.json has no bots list.' }
  const bots: GrokDataBot[] = []
  const ids = new Set<string>()
  for (const [index, item] of raw.bots.entries()) {
    if (!isRecord(item)) return { ok: false, error: `Bot ${index + 1} in grok-data.json is not an object.` }
    const id = str(item.id)
    if (!id) return { ok: false, error: `Bot ${index + 1} in grok-data.json has no id.` }
    if (ids.has(id)) return { ok: false, error: `Bot id ${id} is in grok-data.json twice.` }
    ids.add(id)
    const name = str(item.name)
    if (!name) return { ok: false, error: `Bot ${id} in grok-data.json has no name.` }
    if (typeof item.description !== 'string') return { ok: false, error: `Bot ${name} in grok-data.json has no description.` }
    const routinesVisible = item.routinesVisible === true
    const card = isRecord(item.card) ? { owns: strings(item.card.owns), may: strings(item.card.may), needsApproval: strings(item.card.needsApproval), doneWhen: str(item.card.doneWhen) } : undefined
    const publicUrl = /^https:\/\/\S+$/.test(str(item.publicUrl)) ? str(item.publicUrl) : ''
    bots.push({
      id,
      name,
      grokBotUrl: str(item.grokBotUrl) || `grokbot://app/v1/agent?id=${id}`,
      // Exactly as Grok Bot holds it, CRs included: the Connector checks the hash of this text before it changes anything.
      description: item.description,
      ...(str(item.section) ? { section: str(item.section) } : {}),
      ...(date(item.createdAt) ? { createdAt: date(item.createdAt) } : {}),
      ...(date(item.lastActive) ? { lastActive: date(item.lastActive) } : {}),
      ...(count(item.runs30d) !== undefined ? { runs30d: count(item.runs30d) } : {}),
      routinesVisible,
      ...(routinesVisible ? { routines: cleanRoutines(item.routines) } : {}),
      ...(routinesVisible && count(item.tasksDone30d) !== undefined ? { tasksDone30d: count(item.tasksDone30d) } : {}),
      ...(publicUrl ? { publicUrl } : {}),
      ...(Array.isArray(item.skills) ? { skills: strings(item.skills) } : {}),
      ...(card ? { card } : {}),
      // A manager that does not read is dropped, never the dump: it only places a new seat.
      ...(str(item.reportsTo) ? { reportsTo: str(item.reportsTo) } : {}),
      ...(strings(item.alsoReportsTo).length ? { alsoReportsTo: strings(item.alsoReportsTo) } : {}),
    })
  }
  const skills = Array.isArray(raw.skills) ? raw.skills.filter(isRecord).map((skill) => ({ name: str(skill.name), description: str(skill.description) })).filter((skill) => skill.name) : []
  const self = isRecord(raw.self) && str(raw.self.id) && str(raw.self.name)
    ? { id: str(raw.self.id), name: str(raw.self.name), grokBotUrl: str(raw.self.grokBotUrl) || `grokbot://app/v1/agent?id=${str(raw.self.id)}` }
    : undefined
  return { ok: true, data: { dumpedAt, copy: str(raw.copy), bots, skills, ...(self ? { self } : {}) } }
}

export function readGrokData(orgsDir: string): { ok: true; data: GrokData; stamp: string } | { ok: false; error: string; missing: boolean } {
  const path = resolve(orgsDir, GROK_DATA_FILE)
  const text = readTextFile(path)
  if (text === null) return { ok: false, error: 'No data from the Connector yet.', missing: true }
  const parsed = parseGrokData(text)
  if (!parsed.ok) return { ...parsed, missing: false }
  let stamp = ''
  try {
    const stat = statSync(path)
    stamp = `${Math.round(stat.mtimeMs)}:${stat.size}`
  } catch {
    // The text was read; the stamp only tells runs apart.
  }
  return { ok: true, data: parsed.data, stamp }
}

const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
const linkId = (link: string) => /[?&]id=([^&#\s]+)/.exec(link)?.[1] ?? ''
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text: string, name: string) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, 'i').test(text)

/** The seat a bot is, by its id in a seat's link, its title, or "Title · Organization name". */
export function seatForBot(bot: Pick<GrokDataBot, 'id' | 'name' | 'grokBotUrl'>, seats: SeatDocument[], orgName: string): SeatDocument | undefined {
  return seats.find((seat) => seat.grokBotUrl && (linkId(seat.grokBotUrl) === bot.id || seat.grokBotUrl.trim() === bot.grokBotUrl))
    ?? seats.find((seat) => seat.kind !== 'human' && (norm(seat.title) === norm(bot.name) || norm(`${seat.title} · ${orgName}`) === norm(bot.name)))
}

/** Ids of the bots a seat of this copy links to, in any organization. */
export function linkedBotIds(bundles: OrgBundle[]): Set<string> {
  return new Set(bundles.flatMap((bundle) => bundle.seats.map((seat) => linkId(seat.grokBotUrl?.trim() ?? '')).filter(Boolean)))
}

/**
 * The bot a seat is: by the id in its link. A seat whose link names a bot never falls back to its title. A seat without
 * one is "Title · Organization name", else its title, among bots no seat of this copy links (`taken`).
 */
export function botForSeat(seat: SeatDocument, data: GrokData, orgName: string, taken: Set<string> = new Set()): GrokDataBot | undefined {
  const link = seat.grokBotUrl?.trim() ?? ''
  const id = link ? linkId(link) : ''
  const linked = link ? data.bots.find((bot) => (id && bot.id === id) || bot.grokBotUrl === link) : undefined
  if (linked || id || seat.kind === 'human') return linked
  const free = data.bots.filter((bot) => !taken.has(bot.id))
  return free.find((bot) => norm(bot.name) === norm(`${seat.title} · ${orgName}`)) ?? free.find((bot) => norm(bot.name) === norm(seat.title))
}

/** Bots that belong to one organization: a seat there, or a create request from there (`created`, by name). */
export function orgBots(data: GrokData, bundle: OrgBundle, orgName: string, created: string[]): GrokDataBot[] {
  const asked = new Set(created.map(norm))
  return data.bots.filter((bot) => seatForBot(bot, bundle.seats, orgName) || asked.has(norm(bot.name)))
}

function managerFromBlock(description: string, copyId: string, orgId: string): string | undefined {
  const found = copyBlocks(description, copyId)
  if (!found.ok) return undefined
  const block = found.blocks.find((item) => item.org === orgId)
  const line = block ? /^Main manager: (.+)$/m.exec(block.text)?.[1] : undefined
  return line?.replace(/\s*\([^()]*\)\s*$/, '').trim() || undefined
}

function managerFromOwnerText(own: string, seats: SeatDocument[]): string | undefined {
  const named = /reports to ([^.\n]+)/i.exec(own)?.[1]?.trim()
  return named ? seats.find((seat) => norm(seat.title) === norm(named))?.title : undefined
}

/**
 * The skills Grok Bot shows turned on for the bot, with the library's description when it has one. A Connector on older
 * rules reports none per bot: then a library skill the bot's own text names is taken as its.
 */
function skillsFor(bot: GrokDataBot, own: string, data: GrokData): BotSkill[] {
  const describe = (name: string): BotSkill => {
    const description = data.skills.find((skill) => norm(skill.name) === norm(name))?.description
    return { name, ...(description ? { description } : {}) }
  }
  if (bot.skills) return bot.skills.map(describe)
  return data.skills.filter((skill) => mentions(own, skill.name)).map((skill) => describe(skill.name))
}

function rowFor(bot: GrokDataBot, data: GrokData, args: { seats: SeatDocument[]; orgId: string; copyId: string; apps: AccountApp[] | undefined; seat: SeatDocument | undefined }): BotsFileRow {
  const own = ownerText(bot.description)
  const routines = bot.routinesVisible ? bot.routines ?? [] : []
  const routineText = routines.map((routine) => [routine.name, routine.description ?? '', routine.event ?? ''].join(' ')).join(' ')
  const fromBlock = managerFromBlock(bot.description, args.copyId, args.orgId)
  return {
    name: bot.name,
    grokBotUrl: bot.grokBotUrl,
    // This organization's block first; else who the bot's own text names, as the Connector read it.
    reportsTo: fromBlock ?? bot.reportsTo ?? managerFromOwnerText(own, args.seats) ?? 'You',
    ...(!fromBlock && bot.alsoReportsTo?.length ? { alsoReportsTo: bot.alsoReportsTo } : {}),
    owns: bot.card?.owns ?? [],
    may: bot.card?.may ?? [],
    needsApproval: bot.card?.needsApproval ?? [],
    doneWhen: bot.card?.doneWhen ? [bot.card.doneWhen] : [],
    createdAt: bot.createdAt ?? '',
    lastActive: bot.lastActive ?? '',
    ...(bot.runs30d !== undefined ? { runs30d: bot.runs30d } : {}),
    ...(bot.tasksDone30d !== undefined ? { tasksDone30d: bot.tasksDone30d } : {}),
    routines,
    skills: skillsFor(bot, own, data),
    // Unknown account apps never clear a seat's apps, and neither do routines Grok Bot does not show.
    apps: args.apps ? appsFor(args.apps.filter((app) => mentions(own, app.name) || mentions(routineText, app.name)).map((app) => app.name), bot.routinesVisible ? [] : args.seat?.apps ?? []) : args.seat?.apps ?? [],
    publicUrl: bot.publicUrl ?? '',
    botStatus: '',
    note: '',
    error: '',
  }
}

/**
 * Someone a block names, as a manager here. A bot is found by its id, so a renamed bot still matches; one the dump no longer
 * has keeps the name the block gave it. A person is You: the only person an organization of bots has.
 */
function blockParty(label: string, data: GrokData): string {
  const text = label.trim()
  const byId = /^(.*\S)\s+\(id ([^()]+)\)$/.exec(text)
  if (byId) {
    const id = byId[2]!.trim()
    return [...data.bots, ...(data.self ? [data.self] : [])].find((bot) => bot.id === id)?.name ?? byId[1]!
  }
  const waiting = /^(.*\S)\s+\(not in Grok Bot yet\)$/.exec(text)
  return waiting ? waiting[1]! : 'You'
}

/**
 * The managers another copy of BotsEverywhere gave a bot in an organization with this name: the structure the owner built
 * there. Read from the first such block, so moving to a new copy keeps the org chart instead of what the bot's own text says.
 */
function managersFromNamedBlock(description: string, data: GrokData, copyId: string, orgName: string): { main: string; also: string[] } | undefined {
  const wanted = norm(orgName)
  if (!wanted) return undefined
  for (const block of anyBlocks(description)) {
    if (block.copy === copyId) continue
    const org = /^Organization: (.+)$/m.exec(block.text)?.[1]
    const main = /^Main manager: (.+)$/m.exec(block.text)?.[1]
    if (!org || norm(org) !== wanted || !main) continue
    const also = /^Also reports to: (.+)$/m.exec(block.text)?.[1]
    return { main: blockParty(main, data), also: also ? also.split(', ').map((label) => blockParty(label, data)) : [] }
  }
  return undefined
}

/**
 * Every bot in the dump as a bots-file row for one organization, and the Connector itself. A bot is placed by this copy's
 * block for the organization; else by another copy's block for an organization with the same name; else by who its own
 * text names. Another copy's Connector is left out: it works for that copy, not for any organization here.
 */
export function rowsFromDump(data: GrokData, copyId: string, orgId: string, orgName = ''): BotsFileRow[] {
  const rows = data.bots.filter((bot) => !isOtherConnector(bot, data)).map((bot) => {
    const row = rowFor(bot, data, { seats: [], orgId, copyId, apps: undefined, seat: undefined })
    if (managerFromBlock(bot.description, copyId, orgId) !== undefined) return row
    const named = managersFromNamedBlock(bot.description, data, copyId, orgName)
    if (!named) return row
    const placed: BotsFileRow = { ...row, reportsTo: named.main }
    delete placed.alsoReportsTo
    if (named.also.length) placed.alsoReportsTo = named.also
    return placed
  })
  return data.self ? [...rows, botRow(data.self.name, data.self.grokBotUrl)] : rows
}

/**
 * A Connector in the dump that is not this copy's own. The dump lists every bot but the Connector writing it, so a bot named
 * like a Connector belongs to another copy of BotsEverywhere, such as an older one not deleted yet in Grok Bot.
 */
export function isOtherConnector(bot: { id: string; name: string }, data: GrokData): boolean {
  return bot.name.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase()) && bot.id !== data.self?.id
}

/** A bot row with a name and a link and nothing else, under You. */
export function botRow(name: string, grokBotUrl: string): BotsFileRow {
  return { name, grokBotUrl, reportsTo: 'You', owns: [], may: [], needsApproval: [], doneWhen: [], createdAt: '', lastActive: '', routines: [], skills: [], apps: [], publicUrl: '', botStatus: '', note: '', error: '' }
}

function appsFor(found: string[], kept: string[]): string[] {
  return [...found, ...kept.filter((name) => !found.some((app) => norm(app) === norm(name)))]
}

function triggerFor(routine: BotRoutine): ProcessTrigger {
  if (routine.trigger === 'schedule' || (!routine.trigger && routine.schedule)) return { type: 'schedule', schedule: routine.schedule, source: '', description: routine.description ?? '' }
  const source = (EVENT_SOURCES as readonly string[]).includes(routine.trigger ?? '') ? (routine.trigger as EventSource) : ''
  return source ? { type: 'event', schedule: '', source, description: routine.event ?? '' } : { type: 'manual', schedule: '', source: '', description: routine.description ?? '' }
}

/** One organization's snapshot, built from the dump in the format the rest of the app reads. `updated` is set by the caller. */
export function snapshotFromData(data: GrokData, bundle: OrgBundle, orgName: string, copyId: string, apps: AccountApp[] | undefined, created: string[]): Snapshot {
  const bots = orgBots(data, bundle, orgName, created)
  const processes: ProcessImportRow[] = bots.flatMap((bot) => (bot.routinesVisible ? bot.routines ?? [] : []).map((routine) => ({
    name: routine.name,
    trigger: triggerFor(routine),
    steps: [{ seat: bot.name, action: routine.description || routine.name }],
    doneWhen: '',
    next: '',
    notes: [],
    error: '',
  })))
  return {
    syncedAt: data.dumpedAt,
    bots: bots.map((bot) => rowFor(bot, data, { seats: bundle.seats, orgId: bundle.id, copyId, apps, seat: seatForBot(bot, bundle.seats, orgName) })),
    processes,
  }
}

/** A bot row in the bots-file format, which snapshots and the unassigned list are read back with. */
export function botJson(row: BotsFileRow): Record<string, unknown> {
  return {
    name: row.name,
    ...(row.grokBotUrl ? { grokBotUrl: row.grokBotUrl } : {}),
    reportsTo: row.reportsTo,
    owns: row.owns,
    may: row.may,
    needsApproval: row.needsApproval,
    doneWhen: row.doneWhen.join(' '),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    ...(row.lastActive ? { lastActive: row.lastActive } : {}),
    ...(row.runs30d !== undefined ? { runs30d: row.runs30d } : {}),
    ...(row.tasksDone30d !== undefined ? { tasksDone30d: row.tasksDone30d } : {}),
    routines: row.routines,
    skills: row.skills,
    apps: row.apps,
    ...(row.publicUrl ? { publicUrl: row.publicUrl } : {}),
    ...(row.botStatus ? { status: row.botStatus } : {}),
  }
}

/** The snapshot file the app writes from the dump, in the format `parseSnapshot` reads. */
export function snapshotJson(snapshot: Snapshot): string {
  return `${JSON.stringify({
    syncedAt: snapshot.syncedAt,
    bots: snapshot.bots.map(botJson),
    processes: snapshot.processes.map((process) => ({
      name: process.name,
      trigger: { type: process.trigger.type, schedule: process.trigger.schedule, ...(process.trigger.source ? { source: process.trigger.source } : {}), description: process.trigger.description },
      steps: process.steps,
      doneWhen: process.doneWhen,
      ...(process.next ? { next: process.next } : {}),
    })),
    ...(snapshot.updated?.length ? { updated: snapshot.updated } : {}),
  }, null, 2)}\n`
}

/** Bots in no organization of this copy. */
export function unassignedFromData(data: GrokData, orgs: { bundle: OrgBundle; orgName: string; created: string[] }[]): BotsFileRow[] {
  const placed = new Set(orgs.flatMap((org) => orgBots(data, org.bundle, org.orgName, org.created).map((bot) => bot.id)))
  return data.bots.filter((bot) => !placed.has(bot.id) && !isOtherConnector(bot, data)).map((bot) => rowFor(bot, data, { seats: [], orgId: '', copyId: data.copy, apps: undefined, seat: undefined }))
}
