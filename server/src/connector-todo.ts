import { copyBlocks, orgBlocks, otherCopyIds, ownerText, sha256, withCopyBlocks } from './bot-blocks.ts'
import { botForSeat, linkedBotIds, type GrokData, type GrokDataBot } from './grok-data.ts'
import type { GrokRequest } from './grok-requests.ts'
import { normalizeText } from './normalize-text.ts'
import type { BotRoutine, OrgBundle } from './org-files.ts'

/**
 * The Connector's to-do list. The app works out every change Grok Bot still needs, with the exact text to send; the
 * Connector carries it out and writes a result per key. Every cycle recomputes it from the files, the latest dump, and
 * the results, so nothing depends on remembering an earlier run.
 */

export type TodoKind = 'create' | 'describe' | 'skill' | 'routine' | 'profile' | 'cleanup'

export interface TodoItem {
  /** `<kind>:<who>:<hash of the content>#<attempt>`. A new change is a new key; a failure comes back as the next attempt. */
  key: string
  kind: TodoKind
  bot: string
  botId?: string
  org: string
  expectedBefore?: string
  expectedBeforeSha?: string
  description?: string
  descriptionSha?: string
  skill?: { name: string; description: string }
  message?: string
  section?: string
  /** The dump this item was first listed after, and how many dumps it has been listed after. The app sets both. */
  since?: string
  runs?: number
}

export interface TodoFile {
  basedOn: string
  items: TodoItem[]
  /** What the Connector cannot do on its own, with the reason, for the owner. */
  stuck: { bot: string; org: string; why: string }[]
  /** Blocks other copies of BotsEverywhere left in bots. Removed only when the owner asks. */
  otherCopies: { copy: string; bots: string[] }[]
  /** Describes reported done, until a newer dump shows them; flaggedSha is the text that did not match. The app keeps it. */
  verify?: VerifyEntry[]
  /** The app's own copy of every cleanup and routine result, so "once" and "twice" never depend on the Connector's file. */
  ledger?: ResultsFile['results']
}

export interface VerifyEntry {
  key: string
  botId: string
  bot: string
  org: string
  /** sha256 of the owner text before the change, and of the whole text sent. */
  ownerSha: string
  descriptionSha: string
  doneAt: string
  flaggedSha?: string
}

export interface ResultsFile {
  results: { key: string; status: 'done' | 'failed' | 'changed'; at: string; why?: string; botId?: string }[]
  confirmations: { line: string; from: string; at: string }[]
}

const DAY = 24 * 60 * 60 * 1000
const short = (text: string) => sha256(text).slice(0, 16)
const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()
const isConnector = (name: string) => /^Connector - BotsEverywhere\b/.test(name)
const linkId = (link: string) => /[?&]id=([^&#\s]+)/.exec(link)?.[1] ?? ''

export function parseResults(text: string): ResultsFile {
  try {
    const data = JSON.parse(normalizeText(text)) as { results?: unknown; confirmations?: unknown }
    const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object'
    const results = (Array.isArray(data?.results) ? data.results : []).filter(record).flatMap((item) => {
      const status: ResultsFile['results'][number]['status'] | null = item.status === 'done' || item.status === 'failed' || item.status === 'changed' ? item.status : null
      // Without a real date a result cannot be weighed against a dump, so it is not taken; the item stays and shows as not acted on.
      if (typeof item.key !== 'string' || !status || typeof item.at !== 'string' || !Number.isFinite(Date.parse(item.at))) return []
      return [{ key: item.key, status, at: item.at, ...(typeof item.why === 'string' ? { why: item.why } : {}), ...(typeof item.botId === 'string' ? { botId: item.botId } : {}) }]
    })
    const confirmations = (Array.isArray(data?.confirmations) ? data.confirmations : []).filter(record).flatMap((item) => (typeof item.line === 'string' ? [{ line: item.line, from: typeof item.from === 'string' ? item.from : '', at: typeof item.at === 'string' ? item.at : '' }] : []))
    return { results, confirmations }
  } catch {
    return { results: [], confirmations: [] }
  }
}

/** A bot's confirmation line: `BotsEverywhere routine saved: org | seat | name | schedule or event | time zone | active or paused`. */
export function routineConfirmed(line: string): { org: string; seat: string; name: string; start: string; timeZone: string; enabled: boolean } | null {
  const body = /^BotsEverywhere routine saved: (.+)$/.exec(line.trim())?.[1]
  const parts = body?.split(' | ').map((part) => part.trim())
  if (!parts || parts.length !== 6) return null
  return { org: parts[0]!, seat: parts[1]!, name: parts[2]!, start: parts[3]!, timeZone: parts[4]!, enabled: parts[5] === 'active' }
}

const isSchedule = (routine: BotRoutine) => routine.trigger === 'schedule' || (!routine.trigger && Boolean(routine.schedule))

/** The exact line the bot sends back once the routine is saved. */
function confirmationLine(orgId: string, seat: string, routine: BotRoutine): string {
  const start = isSchedule(routine) ? collapse(routine.schedule) : routine.trigger || 'manual'
  return `BotsEverywhere routine saved: ${orgId} | ${seat} | ${routine.name} | ${start} | ${routine.timeZone || '-'} | ${routine.enabled === false ? 'paused' : 'active'}`
}

function routineShown(want: BotRoutine, bot: GrokDataBot | undefined): boolean {
  if (!bot?.routinesVisible) return false
  return (bot.routines ?? []).some((have) => norm(have.name) === norm(want.name)
    && (isSchedule(want) ? collapse(have.schedule) === collapse(want.schedule) : (have.trigger ?? '') === (want.trigger ?? ''))
    && (!want.timeZone || have.timeZone === want.timeZone)
    && (have.enabled ?? true) === (want.enabled ?? true))
}

function routineDone(orgId: string, seat: string, routine: BotRoutine, bot: GrokDataBot | undefined, results: ResultsFile): boolean {
  const line = norm(confirmationLine(orgId, seat, routine))
  return results.confirmations.some((item) => norm(item.line) === line) || routineShown(routine, bot)
}

function requestBot(request: GrokRequest, data: GrokData): GrokDataBot | undefined {
  const id = request.grokBotUrl ? linkId(request.grokBotUrl) : ''
  return (id ? data.bots.find((bot) => bot.id === id) : undefined) ?? data.bots.find((bot) => norm(bot.name) === norm(request.name))
}

function skillInLibrary(skill: { name: string; description?: string }, data: GrokData): boolean {
  return data.skills.some((item) => norm(item.name) === norm(skill.name) && (!skill.description || collapse(item.description) === collapse(skill.description)))
}

/** Update requests of one organization that Grok Bot now shows fully done. `blocks` are that organization's blocks by seat. */
export function updatedFor(orgId: string, requests: GrokRequest[], data: GrokData, results: ResultsFile, blocks: Map<string, string>): { seat: string; requestedAt: string }[] {
  return requests.filter((request) => {
    if (request.kind !== 'update') return false
    const bot = requestBot(request, data)
    if (!bot) return false
    const block = blocks.get(request.seat)
    if (block && !bot.description.includes(block)) return false
    if (!(request.skills ?? []).every((skill) => skillInLibrary(skill, data))) return false
    return (request.routines ?? []).every((routine) => routineDone(orgId, request.seat, routine, bot, results))
  }).map((request) => ({ seat: request.seat, requestedAt: request.requestedAt }))
}

/**
 * Each seat's bot in one organization. A bot claimed by an earlier seat there is not the later seat's too: one bot gets one
 * block per organization. `twins` lists the later seats.
 */
export function seatBots(bundle: OrgBundle, data: GrokData, taken: Set<string>): { bots: Map<string, GrokDataBot | undefined>; twins: { seat: string; first: string; bot: GrokDataBot }[] } {
  const orgName = bundle.org.company.name
  const bots = new Map<string, GrokDataBot | undefined>()
  const twins: { seat: string; first: string; bot: GrokDataBot }[] = []
  const claimed = new Map<string, string>()
  for (const seat of bundle.seats) {
    const bot = seat.status === 'retired' ? undefined : botForSeat(seat, data, orgName, taken)
    const first = bot ? claimed.get(bot.id) : undefined
    if (bot && first) {
      twins.push({ seat: seat.title, first, bot })
      bots.set(seat.slug, undefined)
      continue
    }
    if (bot) claimed.set(bot.id, seat.title)
    bots.set(seat.slug, bot)
  }
  return { bots, twins }
}

/** One organization's blocks by seat, naming each seat's bot as the dump shows it. */
export function orgBlocksFromData(args: { copyId: string; orgsFolder: string; timeZone: string; org: { id: string; bundle: OrgBundle }; data: GrokData; taken?: Set<string> }): Map<string, string> {
  const found = seatBots(args.org.bundle, args.data, args.taken ?? new Set()).bots
  return orgBlocks({ copyId: args.copyId, orgsFolder: args.orgsFolder, timeZone: args.timeZone, orgId: args.org.id, bundle: args.org.bundle, botFor: (slug) => {
    const bot = found.get(slug)
    return bot ? { name: bot.name, id: bot.id } : null
  } })
}

function cardPrompt(seat: { title: string; owns: string[]; may: string[]; mustAskBefore: string[]; doneWhen: string[] }): string {
  const list = (items: string[]) => (items.length ? items.join('; ') : 'not set')
  return [`You are ${seat.title}.`, `Owns: ${list(seat.owns)}`, `May: ${list(seat.may)}`, `Needs approval: ${list(seat.mustAskBefore)}`, `Done when: ${list(seat.doneWhen)}`].join('\n')
}

export function computeTodo(input: {
  copyId: string
  orgsFolder: string
  timeZone: string
  data: GrokData
  orgs: { id: string; bundle: OrgBundle; requests: GrokRequest[] }[]
  /** Organizations that exist but could not be read now: their blocks stay as they are. */
  keepOrgs?: string[]
  results: ResultsFile
  removeCopies: string[]
  now: Date
  /** The to-do list written last time: its describes reported done are checked against this dump, and its ledger kept. */
  previous?: TodoFile | null
}): TodoFile {
  const { copyId, data } = input
  const dumpedAt = Date.parse(data.dumpedAt)
  const items: TodoItem[] = []
  const stuck: TodoFile['stuck'] = []
  // The Connector's results, plus every cleanup and routine result the app already saw, in case its file lost them.
  const seen = new Set(input.results.results.map((result) => `${result.key}\u0000${result.status}\u0000${result.at}`))
  const results: ResultsFile = { ...input.results, results: [...input.results.results, ...(input.previous?.ledger ?? []).filter((result) => !seen.has(`${result.key}\u0000${result.status}\u0000${result.at}`))] }
  const ledger = results.results.filter((result) => /^(cleanup|routine):/.test(result.key))

  // A describe reported done must show in the next newer dump. If the owner's text around the blocks changed, nothing more is
  // sent to that bot until its text changes again: the owner restores it from the backup or edits it.
  const verify: VerifyEntry[] = []
  const held = new Set<string>()
  const carried = [...(input.previous?.verify ?? [])]
  for (const item of input.previous?.items ?? []) {
    if (item.kind !== 'describe' || !item.botId || item.expectedBefore === undefined || !item.descriptionSha || carried.some((entry) => entry.key === item.key)) continue
    const done = results.results.find((result) => result.key === item.key && result.status === 'done')
    if (done) carried.push({ key: item.key, botId: item.botId, bot: item.bot, org: item.org, ownerSha: sha256(ownerText(item.expectedBefore)), descriptionSha: item.descriptionSha, doneAt: done.at })
  }
  for (const entry of carried) {
    const bot = data.bots.find((item) => item.id === entry.botId)
    if (!bot) continue
    const now = sha256(bot.description)
    const hold = () => {
      held.add(bot.id)
      stuck.push({ bot: bot.name, org: entry.org, why: `${bot.name}'s instructions in Grok Bot changed when the Connector updated them: the text outside the BotsEverywhere blocks is not what it was. Put it back from the backup in connector-backups/${bot.id.replace(/[^A-Za-z0-9_-]/g, '_')}, or edit it in Grok Bot; nothing more is sent to it until it changes.` })
    }
    if (entry.flaggedSha) {
      if (now === entry.flaggedSha) {
        verify.push(entry)
        hold()
      }
      continue
    }
    if (!(Date.parse(entry.doneAt) < dumpedAt)) {
      verify.push(entry)
      continue
    }
    if (now === entry.descriptionSha || sha256(ownerText(bot.description)) === entry.ownerSha) continue
    verify.push({ ...entry, flaggedSha: now })
    hold()
  }

  /** Adds an item unless it is done; a failure, or a done the newer dump does not show, comes back as the next attempt. */
  const add = (base: string, item: Omit<TodoItem, 'key'>, doneMeansShown: boolean) => {
    const mine = results.results.filter((result) => result.key.startsWith(`${base}#`))
    const shownLate = (at: string) => doneMeansShown && Number.isFinite(Date.parse(at)) && Date.parse(at) < dumpedAt
    // changed: the Connector found other text than this dump. A newer dump with that same text means it reads Grok Bot differently.
    if (mine.some((result) => result.status === 'changed' && shownLate(result.at))) {
      stuck.push({ bot: item.bot, org: item.org, why: `The Connector saw different text in ${item.bot} than Grok Bot's data shows, so it changed nothing. Check how the Connector reads the bot's instructions.` })
      return
    }
    if (mine.some((result) => result.status === 'changed' || (result.status === 'done' && !shownLate(result.at)))) return
    const failures = mine.filter((result) => result.status === 'failed' || (result.status === 'done' && shownLate(result.at)))
    const why = (result: (typeof failures)[number]) => (result.status === 'done' ? 'reported done, but Grok Bot does not show it' : result.why || 'no reason given')
    if (failures.some((result) => /restore failed/i.test(result.why ?? ''))) {
      stuck.push({ bot: item.bot, org: item.org, why: `Restoring ${item.bot}'s instructions failed: put them back from the backup.` })
      return
    }
    if (failures.length >= 2) {
      stuck.push({ bot: item.bot, org: item.org, why: `Failed twice: ${why(failures.at(-1)!)}` })
      return
    }
    items.push({ ...item, key: `${base}#${failures.length + 1}` })
  }

  // Blocks every bot should carry, from every organization it has an active seat in: one per organization.
  const taken = linkedBotIds(input.orgs.map((org) => org.bundle))
  const wanted = new Map<string, { org: string; text: string }[]>()
  const blocksByOrg = new Map<string, Map<string, string>>()
  for (const org of input.orgs) {
    const blocks = orgBlocksFromData({ copyId, orgsFolder: input.orgsFolder, timeZone: input.timeZone, org, data, taken })
    blocksByOrg.set(org.id, blocks)
    const { bots, twins } = seatBots(org.bundle, data, taken)
    for (const twin of twins) stuck.push({ bot: twin.bot.name, org: org.id, why: `Two seats in ${org.bundle.org.company.name} are the same bot in Grok Bot (${twin.bot.name}): ${twin.first} and ${twin.seat}. Retire one of them.` })
    for (const [slug, text] of blocks) {
      const bot = bots.get(slug)
      if (!bot || isConnector(bot.name)) continue
      wanted.set(bot.id, [...(wanted.get(bot.id) ?? []), { org: org.id, text }])
    }
  }

  // describe: this copy's blocks, and other copies' blocks the owner asked to remove.
  const others = new Map<string, string[]>()
  for (const bot of data.bots) {
    if (isConnector(bot.name)) continue
    for (const copy of otherCopyIds(bot.description, copyId)) others.set(copy, [...(others.get(copy) ?? []), bot.name])
    if (held.has(bot.id)) continue
    const existing = copyBlocks(bot.description, copyId)
    const firstOrg = wanted.get(bot.id)?.[0]?.org ?? ''
    if (!existing.ok) {
      stuck.push({ bot: bot.name, org: firstOrg, why: `The BotsEverywhere block in ${bot.name} is damaged (${existing.reason}). Fix it in Grok Bot.` })
      continue
    }
    const kept = existing.blocks.filter((block) => input.keepOrgs?.includes(block.org) && !wanted.get(bot.id)?.some((item) => item.org === block.org))
    const desired = [...(wanted.get(bot.id) ?? []), ...kept].sort((a, b) => a.org.localeCompare(b.org))
    const removing = otherCopyIds(bot.description, copyId).filter((id) => input.removeCopies.includes(id))
    // This copy's blocks already right: leave them where they are, so two live copies never keep moving each other's to the end.
    const same = existing.blocks.length === desired.length && existing.blocks.every((block, index) => block.org === desired[index]!.org && block.text === desired[index]!.text)
    if (same && !removing.length) continue
    let next = withCopyBlocks(bot.description, copyId, desired)
    for (const copy of removing) {
      if (next.ok) next = withCopyBlocks(next.text, copy, [])
    }
    if (!next.ok) {
      stuck.push({ bot: bot.name, org: firstOrg, why: `A BotsEverywhere block in ${bot.name} is damaged (${next.reason}). Fix it in Grok Bot.` })
      continue
    }
    if (next.text === bot.description) continue
    add(`describe:${bot.id}:${short(`${bot.description}\u0000${next.text}`)}`, { kind: 'describe', bot: bot.name, botId: bot.id, org: firstOrg, expectedBefore: bot.description, expectedBeforeSha: sha256(bot.description), description: next.text, descriptionSha: sha256(next.text) }, true)
  }

  // create, skill, routine: only what the owner asked for.
  const skills = new Set<string>()
  for (const org of input.orgs) {
    const orgName = org.bundle.org.company.name
    const blocks = blocksByOrg.get(org.id) ?? new Map<string, string>()
    for (const request of org.requests) {
      const bot = requestBot(request, data)
      if (request.kind !== 'update' && !bot) {
        const seat = org.bundle.seats.find((item) => item.slug === request.seat)
        const prompt = request.prompt.trim() || (seat ? cardPrompt(seat) : '')
        const block = blocks.get(request.seat)
        add(`create:${request.seat}:${short(`${request.name}\u0000${request.requestedAt}`)}`, { kind: 'create', bot: request.name, org: org.id, description: block ? `${prompt}\n\n${block}` : prompt, section: orgName }, true)
      }
      for (const skill of request.skills ?? []) {
        const base = `skill:${short(norm(skill.name))}:${short(`${skill.name}\u0000${skill.description ?? ''}`)}`
        if (skills.has(base) || skillInLibrary(skill, data)) continue
        skills.add(base)
        add(base, { kind: 'skill', bot: request.name, org: org.id, skill: { name: skill.name, description: skill.description ?? '' } }, true)
      }
      if (request.kind !== 'update' || !bot) continue
      for (const routine of request.routines ?? []) {
        if (routineDone(org.id, request.seat, routine, bot, results)) continue
        const line = confirmationLine(org.id, request.seat, routine)
        const base = `routine:${org.id}:${request.seat}:${short(line)}`
        // Every result counts toward the next attempt: a failed ask is sent again at once, a sent one waits a day.
        const mine = results.results.filter((result) => result.key.startsWith(`${base}#`))
        const sends = mine.filter((result) => result.status === 'done')
        const failures = mine.filter((result) => result.status === 'failed')
        if (failures.length >= 2) {
          stuck.push({ bot: bot.name, org: org.id, why: `Failed twice: ${failures.at(-1)!.why || 'no reason given'}` })
          continue
        }
        if (sends.length >= 2) {
          stuck.push({ bot: bot.name, org: org.id, why: `Asked twice for the routine "${routine.name}"; ${bot.name} has not confirmed it.` })
          continue
        }
        const last = Math.max(0, ...sends.map((result) => Date.parse(result.at)).filter(Number.isFinite))
        if (last && input.now.getTime() - last < DAY) continue
        const start = isSchedule(routine) ? `schedule ${collapse(routine.schedule)}${routine.timeZone ? ` in ${routine.timeZone}` : ''}` : `starts on ${routine.trigger || 'manual'}${routine.event ? `: ${routine.event}` : ''}`
        const message = `BotsEverywhere (${copyId}): for ${orgName}, create this routine, or change your routine with the same name to match: name "${routine.name}"; ${start}${routine.description ? `; ${routine.description}` : ''}; ${routine.enabled === false ? 'paused' : 'active'}. When it is saved, send Connector - BotsEverywhere (${copyId}) exactly this line: ${line}`
        items.push({ key: `${base}#${mine.length + 1}`, kind: 'routine', bot: bot.name, botId: bot.id, org: org.id, message })
      }
    }
  }

  // No profile asks and no one-time note: each bot writes its own profile file, and its block replaces what earlier
  // Connector messages said. Both would be messages, which Grok Bot sends only when the owner is in the Connector's chat.

  const order: TodoKind[] = ['describe', 'create', 'skill', 'routine', 'profile', 'cleanup']
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  return { basedOn: data.dumpedAt, items, stuck, otherCopies: [...others].map(([copy, bots]) => ({ copy, bots })), verify, ledger }
}
