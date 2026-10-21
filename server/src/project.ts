import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BotsFileRow } from './bots-file.ts'
import { parseSnapshot } from './grok-sync.ts'
import { normalizeText } from './normalize-text.ts'
import { DEFAULT_SYNC_MINUTES, validSyncMinutes } from './connector-timing.ts'

/** The app writes this once per copy of BotsEverywhere. The Connector only reads it. */
export const PROJECT_FILE = 'project.json'
/** The project Connector overwrites this every run: when it ran, and the bots no organization has. */
export const CONNECTOR_FILE = 'connector.json'

/** No 0/o, 1/l/i, so the id reads the same in Grok Bot as here. */
export const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'
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

/** How often the Connector runs, from project.json. A missing or bad value is the default. */
export function parseSyncMinutes(source: string): number {
  try {
    const data = JSON.parse(normalizeText(source)) as { syncMinutes?: unknown }
    return validSyncMinutes(data?.syncMinutes) ?? DEFAULT_SYNC_MINUTES
  } catch {
    return DEFAULT_SYNC_MINUTES
  }
}

function readProjectText(orgsDir: string): string {
  try {
    const path = resolve(orgsDir, PROJECT_FILE)
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

function writeProjectFile(orgsDir: string, id: string, syncMinutes: number): boolean {
  // The default interval is not written, so a copy that never changed it keeps the file it had.
  const data = syncMinutes === DEFAULT_SYNC_MINUTES ? { id } : { id, syncMinutes }
  try {
    writeFileSync(resolve(orgsDir, PROJECT_FILE), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** The id of this copy. A missing or bad project.json gets a fresh id written; a write that fails still returns one. */
export function ensureProjectId(orgsDir: string): string {
  const text = readProjectText(orgsDir)
  const found = text ? parseProjectFile(text) : ''
  if (found) return found
  const id = newProjectId()
  // A file with a bad id keeps its interval.
  writeProjectFile(orgsDir, id, text ? parseSyncMinutes(text) : DEFAULT_SYNC_MINUTES)
  return id
}

export function readSyncMinutes(orgsDir: string): number {
  const text = readProjectText(orgsDir)
  return text ? parseSyncMinutes(text) : DEFAULT_SYNC_MINUTES
}

/** Saves how often the Connector runs. The prompt on Connect bots is built from it. */
export function writeSyncMinutes(orgsDir: string, minutes: number): { ok: true; minutes: number } | { ok: false; error: string } {
  const valid = validSyncMinutes(minutes)
  if (valid === null) return { ok: false, error: 'Pick between 15 minutes and 7 days.' }
  return writeProjectFile(orgsDir, ensureProjectId(orgsDir), valid) ? { ok: true, minutes: valid } : { ok: false, error: 'Could not write project.json.' }
}

export interface ConnectorFile {
  /** File time and size, so a run shows even when the content is bad. */
  stamp: string
  syncedAt: string
  unassigned: BotsFileRow[]
  error: string
  /** How often the Connector says it runs. Absent from a Connector on an older prompt. */
  syncMinutes?: number
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
  let data: { syncedAt?: unknown; unassigned?: unknown; syncMinutes?: unknown }
  try {
    data = JSON.parse(normalizeText(readFileSync(path, 'utf8'))) as typeof data
  } catch {
    return { stamp, syncedAt: '', unassigned: [], error: 'connector.json is not JSON.' }
  }
  const bots = Array.isArray(data?.unassigned) ? data.unassigned : []
  // Same bot rules as a snapshot, so a bad row is skipped the same way.
  const parsed = parseSnapshot(JSON.stringify({ syncedAt: data?.syncedAt, bots }), fallback)
  if (!parsed.ok) return { stamp, syncedAt: '', unassigned: [], error: parsed.error }
  const syncMinutes = validSyncMinutes(data?.syncMinutes)
  return { stamp, syncedAt: parsed.snapshot.syncedAt, unassigned: parsed.snapshot.bots.filter((bot) => !bot.error), error: '', ...(syncMinutes === null ? {} : { syncMinutes }) }
}
