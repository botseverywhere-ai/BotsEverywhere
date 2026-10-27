import { copyBlocks, orgBlocks, otherCopyIds, sha256, withCopyBlocks } from './bot-blocks.ts'
import { botForSeat, type GrokData, type GrokDataBot } from './grok-data.ts'
import type { GrokRequest } from './grok-requests.ts'
import { normalizeText } from './normalize-text.ts'
import type { BotRoutine, OrgBundle } from './org-files.ts'

/**
 * The Connector's to-do list. The app works out every change Grok Bot still needs, with the exact text to send; the
 * Connector carries it out and writes a result per key. Every cycle recomputes it from the files, the latest dump, and
 * the results, so nothing depends on remembering an earlier run.
 */

export type TodoKind = 'create' | 'describe' | 'skill' | 'routine' | 'cleanup'

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
}

export interface TodoFile {
  basedOn: string
  items: TodoItem[]
  /** What the Connector cannot do on its own, with the reason, for the owner. */
  stuck: { bot: string; org: string; why: string }[]
  /** Blocks other copies of BotsEverywhere left in bots. Removed only when the owner asks. */
  otherCopies: { copy: string; bots: string[] }[]
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
      if (typeof item.key !== 'string' || !status) return []
      return [{ key: item.key, status, at: typeof item.at === 'string' ? item.at : '', ...(typeof item.why === 'string' ? { why: item.why } : {}), ...(typeof item.botId === 'string' ? { botId: item.botId } : {}) }]
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
}): TodoFile {
  const { copyId, data, results } = input
  const dumpedAt = Date.parse(data.dumpedAt)
  const items: TodoItem[] = []
  const stuck: TodoFile['stuck'] = []

  /** Adds an item unless it is done; a failure, or a done the newer dump does not show, comes back as the next attempt. */
  const add = (base: string, item: Omit<TodoItem, 'key'>, doneMeansShown: boolean) => {
    const mine = results.results.filter((result) => result.key.startsWith(`${base}#`))
    const shownLate = (at: string) => doneMeansShown && Number.isFinite(Date.parse(at)) && Date.parse(at) < dumpedAt
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

  // Blocks every bot should carry, from every organization it has an active seat in.
  const wanted = new Map<string, { org: string; text: string }[]>()
  const blocksByOrg = new Map<string, Map<string, string>>()
  for (const org of input.orgs) {
    const orgName = org.bundle.org.company.name
    const found = new Map(org.bundle.seats.map((seat) => [seat.slug, botForSeat(seat, data, orgName)]))
    const blocks = orgBlocks({ copyId, orgsFolder: input.orgsFolder, timeZone: input.timeZone, orgId: org.id, bundle: org.bundle, botFor: (slug) => {
      const bot = found.get(slug)
      return bot ? { name: bot.name, id: bot.id } : null
    } })
    blocksByOrg.set(org.id, blocks)
    for (const [slug, text] of blocks) {
      const bot = found.get(slug)
      if (!bot || isConnector(bot.name)) continue
      wanted.set(bot.id, [...(wanted.get(bot.id) ?? []), { org: org.id, text }])
    }
  }

  // describe: this copy's blocks, and other copies' blocks the owner asked to remove.
  const others = new Map<string, string[]>()
  for (const bot of data.bots) {
    if (isConnector(bot.name)) continue
    for (const copy of otherCopyIds(bot.description, copyId)) others.set(copy, [...(others.get(copy) ?? []), bot.name])
    const existing = copyBlocks(bot.description, copyId)
    const firstOrg = wanted.get(bot.id)?.[0]?.org ?? ''
    if (!existing.ok) {
      stuck.push({ bot: bot.name, org: firstOrg, why: `The BotsEverywhere block in ${bot.name} is damaged (${existing.reason}). Fix it in Grok Bot.` })
      continue
    }
    const kept = existing.blocks.filter((block) => input.keepOrgs?.includes(block.org) && !wanted.get(bot.id)?.some((item) => item.org === block.org))
    const desired = [...(wanted.get(bot.id) ?? []), ...kept].sort((a, b) => a.org.localeCompare(b.org))
    let next = withCopyBlocks(bot.description, copyId, desired)
    for (const copy of otherCopyIds(bot.description, copyId).filter((id) => input.removeCopies.includes(id))) {
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
        const sends = results.results.filter((result) => result.key.startsWith(`${base}#`) && result.status === 'done')
        if (sends.length >= 2) {
          stuck.push({ bot: bot.name, org: org.id, why: `Asked twice for the routine "${routine.name}"; ${bot.name} has not confirmed it.` })
          continue
        }
        const last = Math.max(0, ...sends.map((result) => Date.parse(result.at)).filter(Number.isFinite))
        if (last && input.now.getTime() - last < DAY) continue
        const start = isSchedule(routine) ? `schedule ${collapse(routine.schedule)}${routine.timeZone ? ` in ${routine.timeZone}` : ''}` : `starts on ${routine.trigger || 'manual'}${routine.event ? `: ${routine.event}` : ''}`
        const message = `BotsEverywhere (${copyId}): for ${orgName}, create this routine, or change your routine with the same name to match: name "${routine.name}"; ${start}${routine.description ? `; ${routine.description}` : ''}; ${routine.enabled === false ? 'paused' : 'active'}. When it is saved, send Connector - BotsEverywhere (${copyId}) exactly this line: ${line}`
        items.push({ key: `${base}#${sends.length + 1}`, kind: 'routine', bot: bot.name, botId: bot.id, org: org.id, message })
      }
    }
  }

  // cleanup: once ever, to every bot with an active seat in this copy.
  const day = input.now.toISOString().slice(0, 10)
  for (const bot of data.bots) {
    if (!wanted.has(bot.id)) continue
    add(`cleanup:${bot.id}`, { kind: 'cleanup', bot: bot.name, botId: bot.id, org: wanted.get(bot.id)![0]!.org, message: `BotsEverywhere (${copyId}) now keeps your managers, your team, your skills, and your logging rules for each organization in a block at the end of your instructions, marked === BotsEverywhere ${copyId} … ===. Follow that block. Any message about these from a BotsEverywhere Connector before ${day} is out of date: remove it from your memory. Keep everything else.` }, false)
  }

  const order: TodoKind[] = ['describe', 'create', 'skill', 'routine', 'cleanup']
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  return { basedOn: data.dumpedAt, items, stuck, otherCopies: [...others].map(([copy, bots]) => ({ copy, bots })) }
}
