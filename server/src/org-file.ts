import { readBotsJson, stringList } from './bots-file.ts'
import { CONNECTOR_BOT_NAME } from './connector-prompt.ts'
import type { SeatDocument } from './org-files.ts'

/** Shown on Option 4 and sent by the writer when the organization already has seats besides You. */
export const ORG_IMPORT_LOCKED = 'This organization already has seats besides You, so importing an organization file is off: it would add a second copy of each person. Import it into a new organization.'

/** The organization fields an organization file fills. The organization keeps the name it was created with. */
export interface OrgFileOrganization {
  name: string
  description: string
  purpose: string
  industry: string
  size: string
}

/** One person from an organization file, after the field names are normalized. */
export interface OrgFilePerson {
  name: string
  title: string
  /** Department name. '' puts the person in General. */
  department: string
  /** The chart line: another person's name in this file, or '' for the top. */
  reportsTo: string
  /** Other managers. The chart has one line per seat, so these go on the person's About line. */
  alsoReportsTo: string[]
  owns: string[]
  email: string
  phone: string
  location: string
  about: string
  /** Soft issues. The person still imports. */
  note: string
  error: string
}

/** An existing organization: its fields, departments, people, and who is importing it. */
export interface OrgFile {
  organization: OrgFileOrganization
  departments: string[]
  people: OrgFilePerson[]
  /** The person importing, as named in people. '' when they are not in the list. */
  you: string
  /** Notes about the file as a whole, such as a you that matches nobody. */
  notes: string[]
}

/**
 * An organization file fills a new organization once: You, and the Connector's seat when Step 1 came first. Any other
 * seat means the structure is already there, and a second import would write a copy of each person.
 */
export function orgImportLocked(seats: (Pick<SeatDocument, 'slug' | 'kind' | 'title'> & { grokBotUrl?: string })[], mainBot = ''): boolean {
  const isMain = (link = '') => Boolean(mainBot) && /[?&]id=([^&#s]+)/.exec(link)?.[1] === mainBot
  return seats.some((seat) => seat.slug !== 'you' && !(seat.kind === 'bot' && (seat.title.trim().toLowerCase().startsWith(CONNECTOR_BOT_NAME.toLowerCase()) || isMain(seat.grokBotUrl))))
}

/** A file name from a name: accents become plain letters, so José is jose, not jos-. */
export function plainSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Reads an organization file from any AI. A bad document fails the whole file. A person fails only without a name or as a second copy. */
export function parseOrgFile(source: string): { ok: true; file: OrgFile } | { ok: false; errors: string[] } {
  let parsed: unknown
  try {
    parsed = readBotsJson(source)
  } catch {
    return { ok: false, errors: ['This file is not JSON.'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['The file must be a JSON object with a people list.'] }
  }
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.people)) return { ok: false, errors: ['The file needs a people list.'] }
  if (record.people.length === 0) return { ok: false, errors: ['Add at least one person.'] }
  const people = record.people.map((entry, index) => readPerson(entry, index))
  const names = new Map<string, string>()
  for (const person of people) {
    if (person.error) continue
    const key = fold(person.name)
    if (names.has(key)) person.error = `${person.name} is already in this file.`
    else names.set(key, person.name)
  }
  const notes: string[] = []
  const flagged = record.people.findIndex((entry) => isRecord(entry) && entry.you === true)
  const named = text(record.you) || (flagged >= 0 && !people[flagged]!.error ? people[flagged]!.name : '')
  const you = named ? names.get(fold(named)) ?? '' : ''
  if (named && !you) notes.push(`${named} is not in the people list, so You stays as it is.`)
  const managers = record.people.map((entry) => (isRecord(entry) ? managerNames(entry.reportsTo ?? entry.managers) : []))
  people.forEach((person, index) => {
    if (!person.error) resolveManagers(person, managers[index]!, names, you)
  })
  breakLoops(people)
  return {
    ok: true,
    file: {
      organization: readOrganization(record.organization),
      departments: readDepartments(record.departments),
      people,
      you,
      notes,
    },
  }
}

function readPerson(entry: unknown, index: number): OrgFilePerson {
  const person: OrgFilePerson = {
    name: `Person ${index + 1}`,
    title: '',
    department: '',
    reportsTo: '',
    alsoReportsTo: [],
    owns: [],
    email: '',
    phone: '',
    location: '',
    about: '',
    note: '',
    error: '',
  }
  if (!isRecord(entry)) return { ...person, error: 'Each person must be a JSON object.' }
  const name = text(entry.name)
  return {
    ...person,
    name: name || person.name,
    title: text(entry.title ?? entry.jobTitle ?? entry.role),
    department: text(entry.department),
    owns: stringList(entry.owns),
    email: text(entry.email),
    phone: text(entry.phone),
    location: text(entry.location),
    about: text(entry.about ?? entry.bio),
    error: name ? '' : 'Name is required.',
  }
}

/** reportsTo as written: one name, a list of names, or nothing for the top. */
function managerNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean)
  const name = text(value)
  return name ? [name] : []
}

/**
 * The first manager found in the file is the chart line, the rest are kept as also reports to. One string that names
 * several people, like "Ada and Ben", counts when every part is a person in the file.
 */
function resolveManagers(person: OrgFilePerson, written: string[], names: Map<string, string>, you: string) {
  const found: string[] = []
  const notes: string[] = []
  for (const name of written) {
    const whole = fold(name) === 'you' && you ? you : names.get(fold(name))
    const parts = whole ? [whole] : splitNames(name, names)
    if (parts.length === 0) {
      notes.push(`${name} is not in this file.`)
      continue
    }
    for (const part of parts) {
      if (part === person.name) notes.push(`${person.name} cannot report to themself.`)
      else if (!found.includes(part)) found.push(part)
    }
  }
  person.reportsTo = found[0] ?? ''
  person.alsoReportsTo = found.slice(1)
  if (notes.length && !found.length) notes.push(`${person.name} sits at the top.`)
  person.note = notes.join(' ')
}

function splitNames(value: string, names: Map<string, string>): string[] {
  const parts = value.split(/\s*(?:,|;|&|\band\b)\s*/i).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return []
  const found = parts.map((part) => names.get(fold(part)))
  return found.every(Boolean) ? (found as string[]) : []
}

/** A reporting line that leads back to the same person is cut there, and that person sits at the top. */
function breakLoops(people: OrgFilePerson[]) {
  const byName = new Map(people.filter((person) => !person.error).map((person) => [person.name, person]))
  for (const person of byName.values()) {
    const seen = new Set<string>([person.name])
    let cursor = person.reportsTo ? byName.get(person.reportsTo) : undefined
    while (cursor) {
      if (cursor.name === person.name || seen.has(cursor.name)) break
      seen.add(cursor.name)
      cursor = cursor.reportsTo ? byName.get(cursor.reportsTo) : undefined
    }
    if (cursor?.name !== person.name) continue
    const note = `${person.name}'s reporting line made a loop, so ${person.name} sits at the top.`
    person.note = person.note ? `${person.note} ${note}` : note
    person.reportsTo = ''
  }
}

function readOrganization(value: unknown): OrgFileOrganization {
  const record = isRecord(value) ? value : {}
  return {
    name: text(record.name),
    description: text(record.description),
    purpose: text(record.purpose),
    industry: text(record.industry),
    size: text(record.size),
  }
}

/** Department names: a list of names, or of objects with a name. Repeats are dropped. */
function readDepartments(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const name = isRecord(item) ? text(item.name) : text(item)
    if (name && !names.some((known) => fold(known) === fold(name))) names.push(name)
  }
  return names
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** One line of text. Numbers are kept as text; anything else is empty. */
function text(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** Names match without regard to case or accents, so Nunez finds Núñez. */
function fold(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}
