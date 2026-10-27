import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeText } from './normalize-text.ts'

/** Files at the root of the orgs folder that the app and the Connector exchange. */
export const GROK_DATA_FILE = 'grok-data.json'
export const TODO_FILE = 'connector-todo.json'
export const RESULTS_FILE = 'connector-results.json'
export const GUIDE_FILE = 'CONNECTOR.md'
export const BACKUPS_DIR = 'connector-backups'

/** Writes the whole file at once: a temporary file beside it, then a rename, so a reader never sees half of it. */
export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`)
  writeFileSync(temp, text, 'utf8')
  renameSync(temp, path)
}

/** The file's text with one byte-order mark removed and LF line endings, or null when it is missing or unreadable. */
export function readTextFile(path: string): string | null {
  try {
    return existsSync(path) ? normalizeText(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}
