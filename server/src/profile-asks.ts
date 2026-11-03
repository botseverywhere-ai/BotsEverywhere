import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeText } from './normalize-text.ts'
import { readTextFile } from './connector-files.ts'

/**
 * Sync bots: when the owner last asked every bot in an organization to write its profile file now. The next
 * cycle turns it into one profile item per bot, which the Connector sends from its chat. One object: `askedAt`.
 */
export const PROFILE_ASKS_FILE = 'grok/profile-asks.json'

/** When the owner last asked, as written; '' with no file or a bad one. Tolerates a BOM and CRLF. */
export function readProfileAsk(root: string): string {
  const text = readTextFile(resolve(root, PROFILE_ASKS_FILE))
  if (!text) return ''
  try {
    const data = JSON.parse(normalizeText(text)) as { askedAt?: unknown }
    const at = typeof data?.askedAt === 'string' ? data.askedAt.trim() : ''
    return Number.isFinite(Date.parse(at)) ? at : ''
  } catch {
    return ''
  }
}

export function writeProfileAsk(root: string, askedAt: string): void {
  const path = resolve(root, PROFILE_ASKS_FILE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ askedAt }, null, 2)}\n`, 'utf8')
}

/**
 * The skill names the library held at the last reading, so a cycle can tell a skill that is new since. A bot can save a
 * skill in its own chat; only the bot can say it uses it, so a new name makes the app ask every bot for its profile.
 */
export const LIBRARY_SEEN_FILE = 'library-skills.json'

/** The names remembered, lowercased; null with no file or a bad one, which counts as a first reading. */
export function readLibrarySeen(orgsDir: string): string[] | null {
  const text = readTextFile(resolve(orgsDir, LIBRARY_SEEN_FILE))
  if (!text) return null
  try {
    const data = JSON.parse(normalizeText(text)) as unknown
    return Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : null
  } catch {
    return null
  }
}

export function writeLibrarySeen(orgsDir: string, names: string[]): void {
  writeFileSync(resolve(orgsDir, LIBRARY_SEEN_FILE), `${JSON.stringify(names, null, 2)}\n`, 'utf8')
}
