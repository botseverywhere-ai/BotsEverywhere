import { createHash } from 'node:crypto'
import type { OrgBundle, SeatDocument } from './org-files.ts'
import { PROFILES_DIR } from './profile-files.ts'
import { profileForm } from './profile-reports.ts'

/**
 * The BotsEverywhere block: one per organization at the end of a bot's instructions in Grok Bot. It names the bot's
 * managers, its team, its skills, its files, and its logging rules. The app builds the exact text here; the Connector only
 * copies it, so the same files always give the same text.
 */

/** Someone a block names: a bot (with its Grok Bot id once it has one) or a person. */
export type Party = { kind: 'bot'; name: string; id?: string } | { kind: 'person'; name: string }

export interface BlockInput {
  copyId: string
  orgId: string
  orgName: string
  orgsFolder: string
  timeZone: string
  /** The bot's own name, as its log lines carry it. */
  botName: string
  /** The seat's slug, which names the bot's profile file and the seat in it. */
  seat: string
  seatFile: string
  main: Party
  also: Party[]
  /** Seats this one manages: as their main manager, or as an extra one. */
  team: { party: Party; main: boolean }[]
  skills: string[]
  processFiles: string[]
}

const START = /^=== BotsEverywhere ([a-z0-9]+) ([a-z0-9]+(?:-[a-z0-9]+)*) ===\r?$/gm
const END = /^=== end BotsEverywhere ([a-z0-9]+) ([a-z0-9]+(?:-[a-z0-9]+)*) ===\r?$/gm
/** What sits between the owner's text and a block, and between blocks. Removing a block removes it too. */
const GAP = '\n\n'

function label(party: Party, note = ''): string {
  if (party.kind === 'person') return note ? `${party.name} (${note})` : party.name
  const where = party.id ? `id ${party.id}` : 'not in Grok Bot yet'
  return `${party.name} (${where}${note ? `, ${note}` : ''})`
}

export function blockText(input: BlockInput): string {
  const lines = [
    `=== BotsEverywhere ${input.copyId} ${input.orgId} ===`,
    `Organization: ${input.orgName}`,
    `Seat file: ${input.seatFile}`,
    `Main manager: ${label(input.main)}`,
  ]
  if (input.also.length) lines.push(`Also reports to: ${input.also.map((party) => label(party)).join(', ')}`)
  if (input.team.length) lines.push(`Your team: ${input.team.map((item) => label(item.party, item.main ? 'main manager: you' : 'also reports to you')).join(', ')}`)
  lines.push(
    `Skills to use: ${input.skills.length ? input.skills.join(', ') : 'none'}`,
    `Processes: ${input.processFiles.length ? input.processFiles.join(', ') : 'none'}`,
    'Take work only from your managers above. Send each result to the manager who gave you the work. When that is not your main manager, also send your main manager one line on what you did.',
  )
  if (input.team.length) lines.push('Brief your team with SendToAgent. Give work only to bots in your team.')
  lines.push(
    'When a manager is a person, keep the result in your chat for them.',
    'Before each run of a routine, read your seat file and your process files.',
    // A file, not a message: a bot writes it on its own runs, so nothing waits for the owner to tell the Connector's chat.
    `Profile file: ${orgPath(input.orgsFolder, input.orgId, PROFILES_DIR, `${input.seat}.md`)}. Each time you are active, in a chat, on a message, or when one of your routines finishes, check it. If it is missing, more than a day old, or no longer matches your routines, the private skills you use in your work, the apps you use, or the work you regularly hand on or get, write it with Shell, exactly in this form and nothing else:`,
    ...profileForm(input.orgId, input.seat),
    `Run log: ${orgPath(input.orgsFolder, input.orgId, 'log', 'YYYY-MM-DD.md')}, in local time for ${input.timeZone}. If the file is missing, start it with "# Run log YYYY-MM-DD".`,
    'After each step of a routine, append exactly one line:',
    `- HH:MM | ${input.botName} | <process name> | <step> | done|failed|skipped|waiting|running | note or -`,
    'Each time someone uses you in a chat for this organization, append exactly one line:',
    `- HH:MM | ${input.botName} | chat | what you were asked, in a few words | done|failed|waiting | note or -`,
    'Before a checkpoint, write waiting and ask the owner before you continue.',
    `For ${input.orgName}, this block replaces anything else in your instructions or memory about who you report to, whom you brief, which skills you use, and how you log.`,
    `=== end BotsEverywhere ${input.copyId} ${input.orgId} ===`,
  )
  return lines.join('\n')
}

/** A path inside an organization folder, with the separator the orgs folder itself uses. */
export function orgPath(orgsFolder: string, orgId: string, ...parts: string[]): string {
  const sep = orgsFolder.includes('\\') ? '\\' : '/'
  return [orgsFolder.replace(/[\\/]+$/, ''), orgId, ...parts].join(sep)
}

/** Every active bot seat's block for one organization, by seat slug. `botFor` gives a seat's bot in Grok Bot, if any. */
export function orgBlocks(args: {
  copyId: string
  orgsFolder: string
  timeZone: string
  orgId: string
  bundle: OrgBundle
  botFor: (seatSlug: string) => { name: string; id: string } | null
}): Map<string, string> {
  const { bundle } = args
  const active = bundle.seats.filter((seat) => seat.status !== 'retired')
  const bySlug = new Map(active.map((seat) => [seat.slug, seat]))
  const party = (slug: string): Party => {
    if (!slug) return { kind: 'person', name: 'You' }
    const seat = bySlug.get(slug) ?? bundle.seats.find((item) => item.slug === slug)
    if (!seat) return { kind: 'bot', name: slug }
    if (seat.kind === 'human') return { kind: 'person', name: bundle.org.people.find((person) => person.id === seat.personId)?.name || seat.title }
    const bot = args.botFor(slug)
    return bot ? { kind: 'bot', name: bot.name, id: bot.id } : { kind: 'bot', name: seat.title }
  }
  const byTitle = (a: SeatDocument, b: SeatDocument) => a.title.localeCompare(b.title)
  const blocks = new Map<string, string>()
  for (const seat of active.filter((item) => item.kind === 'bot')) {
    const team = active
      .filter((item) => item.reportsTo === seat.slug || item.alsoReportsTo?.includes(seat.slug))
      .sort(byTitle)
      .map((item) => ({ party: party(item.slug), main: item.reportsTo === seat.slug }))
    const processFiles = (bundle.processes ?? [])
      .filter((process) => process.steps[0]?.seat === seat.slug)
      .map((process) => orgPath(args.orgsFolder, args.orgId, 'processes', `${process.slug}.md`))
      .sort()
    blocks.set(seat.slug, blockText({
      copyId: args.copyId,
      orgId: args.orgId,
      orgName: bundle.org.company.name,
      orgsFolder: args.orgsFolder,
      timeZone: args.timeZone,
      botName: args.botFor(seat.slug)?.name ?? seat.title,
      seat: seat.slug,
      seatFile: orgPath(args.orgsFolder, args.orgId, 'seats', `${seat.slug}.md`),
      main: party(seat.reportsTo),
      also: (seat.alsoReportsTo ?? []).filter((slug) => bySlug.has(slug)).map(party),
      team,
      skills: (seat.skills ?? []).map((skill) => skill.name),
      processFiles,
    }))
  }
  return blocks
}

interface Span {
  org: string
  start: number
  end: number
}

/** Where this copy's blocks are. Repeated, unpaired, or crossed markers make the text damaged. */
function scan(description: string, copyId: string): { ok: true; spans: Span[] } | { ok: false; reason: string } {
  const marks: { at: number; end: number; org: string; open: boolean }[] = []
  for (const [pattern, open] of [[START, true], [END, false]] as const) {
    for (const match of description.matchAll(pattern)) {
      if (match[1] !== copyId) continue
      marks.push({ at: match.index, end: match.index + match[0].replace(/\r$/, '').length, org: match[2]!, open })
    }
  }
  marks.sort((a, b) => a.at - b.at)
  const spans: Span[] = []
  const seen = new Set<string>()
  let current: { org: string; start: number } | null = null
  for (const mark of marks) {
    if (mark.open) {
      if (current) return { ok: false, reason: `a block for ${mark.org} starts inside the block for ${current.org}` }
      if (seen.has(mark.org)) return { ok: false, reason: `two blocks for ${mark.org}` }
      seen.add(mark.org)
      current = { org: mark.org, start: mark.at }
    } else {
      if (!current || current.org !== mark.org) return { ok: false, reason: `an end line for ${mark.org} without its start` }
      spans.push({ org: current.org, start: current.start, end: mark.end })
      current = null
    }
  }
  if (current) return { ok: false, reason: `the block for ${current.org} has no end line` }
  return { ok: true, spans }
}

/** This copy's blocks in a description, in order. */
export function copyBlocks(description: string, copyId: string): { ok: true; blocks: { org: string; text: string }[] } | { ok: false; reason: string } {
  const found = scan(description, copyId)
  if (!found.ok) return found
  return { ok: true, blocks: found.spans.map((span) => ({ org: span.org, text: description.slice(span.start, span.end) })) }
}

/**
 * The description with every block of this copy replaced by `blocks`, added at the end. Every other character stays as it
 * was, so writing the same blocks again gives the same text. A damaged description is refused.
 */
export function withCopyBlocks(description: string, copyId: string, blocks: { org: string; text: string }[]): { ok: true; text: string } | { ok: false; reason: string } {
  const found = scan(description, copyId)
  if (!found.ok) return found
  let rest = description
  for (const span of [...found.spans].reverse()) {
    let from = span.start
    let to = span.end
    if (from >= GAP.length && rest.slice(from - GAP.length, from) === GAP) from -= GAP.length
    else if (from === 0 && rest.slice(to, to + GAP.length) === GAP) to += GAP.length
    rest = rest.slice(0, from) + rest.slice(to)
  }
  if (!blocks.length) return { ok: true, text: rest }
  const added = blocks.map((block) => block.text).join(GAP)
  return { ok: true, text: rest ? `${rest}${GAP}${added}` : added }
}

const ANY_BLOCK = /(?:\n\n)?^=== BotsEverywhere ([a-z0-9]+) ([a-z0-9]+(?:-[a-z0-9]+)*) ===\r?$[\s\S]*?^=== end BotsEverywhere \1 \2 ===\r?$/gm

/** What the owner wrote: the description without any BotsEverywhere block, of this copy or another. */
export function ownerText(description: string): string {
  return description.replace(ANY_BLOCK, '')
}

/** Every BotsEverywhere block in a description, of this copy or another, in order. */
export function anyBlocks(description: string): { copy: string; org: string; text: string }[] {
  return [...description.matchAll(ANY_BLOCK)].map((match) => ({ copy: match[1]!, org: match[2]!, text: match[0].replace(/^\n\n/, '') }))
}

/** Ids of other copies whose blocks this description carries. */
export function otherCopyIds(description: string, copyId: string): string[] {
  const ids = [...description.matchAll(START)].map((match) => match[1]!).filter((id) => id !== copyId)
  return [...new Set(ids)]
}

/** SHA-256 hex over the text's UTF-8 bytes, as the Connector computes it with python3. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
