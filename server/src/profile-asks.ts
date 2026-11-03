import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeText } from './normalize-text.ts'
import { readTextFile } from './connector-files.ts'

/**
 * Get the bots' profiles: when the owner last asked every bot in an organization to write its profile file now. The next
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
