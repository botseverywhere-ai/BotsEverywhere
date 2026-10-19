import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BotsFileRow } from './bots-file.ts'
import { parseSnapshot } from './grok-sync.ts'
import { normalizeText } from './normalize-text.ts'

/** The app writes this once per copy of BotsEverywhere. The Connector only reads it. */
export const PROJECT_FILE = 'project.json'
/** The project Connector overwrites this every run: when it ran, and the bots no organization has. */
export const CONNECTOR_FILE = 'connector.json'

/** No 0/o, 1/l/i, so the id reads the same in Grok Bot as here. */
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
const ID = /^[a-hjkmnp-z2-9]{4,12}$/

export function newProjectId(random: () => number = Math.random): string {
  let id = ''
  for (let n = 0; n < 4; n += 1) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)]
  return id
}

export function parseProjectFile(source: string): string {
  try {
    const data = JSON.parse(normalizeText(source)) as { id?: unknown }
    return typeof data?.id === 'string' && ID.test(data.id) ? data.id : ''
  } catch {
    return ''
  }
}

/** The id of this copy. A missing or bad project.json gets a fresh id written; a write that fails still returns one. */
export function ensureProjectId(orgsDir: string): string {
  const path = resolve(orgsDir, PROJECT_FILE)
  try {
    if (existsSync(path)) {
      const id = parseProjectFile(readFileSync(path, 'utf8'))
      if (id) return id
    }
  } catch {
    // An unreadable file is replaced below.
  }
  const id = newProjectId()
  try {
    writeFileSync(path, `${JSON.stringify({ id }, null, 2)}\n`, 'utf8')
  } catch {
    // The id still names the Connector for this run of the writer.
  }
  return id
}

export interface ConnectorFile {
  /** File time and size, so a run shows even when the content is bad. */
  stamp: string
  syncedAt: string
  unassigned: BotsFileRow[]
  error: string
}

/** Reads orgs/connector.json. Null when the project Connector never wrote it. Never throws. */
export function readConnector(orgsDir: string): ConnectorFile | null {
  const path = resolve(orgsDir, CONNECTOR_FILE)
  if (!existsSync(path)) return null
  let stamp = ''
  let fallback = new Date().toISOString()
  try {
    const stat = statSync(path)
    stamp = `${Math.round(stat.mtimeMs)}:${stat.size}`
    fallback = stat.mtime.toISOString()
  } catch {
    return { stamp: '', syncedAt: '', unassigned: [], error: 'Could not read connector.json.' }
  }
  let data: { syncedAt?: unknown; unassigned?: unknown }
  try {
    data = JSON.parse(normalizeText(readFileSync(path, 'utf8'))) as typeof data
  } catch {
    return { stamp, syncedAt: '', unassigned: [], error: 'connector.json is not JSON.' }
  }
  const bots = Array.isArray(data?.unassigned) ? data.unassigned : []
  // Same bot rules as a snapshot, so a bad row is skipped the same way.
  const parsed = parseSnapshot(JSON.stringify({ syncedAt: data?.syncedAt, bots }), fallback)
  if (!parsed.ok) return { stamp, syncedAt: '', unassigned: [], error: parsed.error }
  return { stamp, syncedAt: parsed.snapshot.syncedAt, unassigned: parsed.snapshot.bots.filter((bot) => !bot.error), error: '' }
}
