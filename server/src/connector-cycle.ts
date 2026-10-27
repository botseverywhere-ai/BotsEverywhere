import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKUPS_DIR, GUIDE_FILE, RESULTS_FILE, TODO_FILE, UNASSIGNED_FILE, readTextFile, writeFileAtomic } from './connector-files.ts'
import { SNAPSHOT_PATH, connectorGuide } from './connector-prompt.ts'
import { computeTodo, orgBlocksFromData, parseResults, updatedFor, type TodoFile } from './connector-todo.ts'
import { botJson, readGrokData, snapshotFromData, snapshotJson, unassignedFromData } from './grok-data.ts'
import type { GrokRequest } from './grok-requests.ts'
import type { OrgBundle } from './org-files.ts'
import { readConnector, readRemoveCopies, readSyncMinutes } from './project.ts'
import { listOrgSlugs, readOrgDir, readRequests } from './template-server.ts'

/**
 * One cycle of Connector v2, run by the writer when a dump, a result, or an organization's files change: each
 * organization's snapshot from the dump (with the updates Grok Bot shows done), the bots in no organization, a backup of
 * every bot about to change, and the Connector's to-do list. A file is only written when its text changes.
 */

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

function writeIfChanged(path: string, text: string): boolean {
  if (readTextFile(path) === text) return false
  writeFileAtomic(path, text)
  return true
}

/** CONNECTOR.md for this copy, from its id, folder, interval, time zone, and platform. */
export function writeConnectorGuide(orgsDir: string, copyId: string): boolean {
  return writeIfChanged(resolve(orgsDir, GUIDE_FILE), connectorGuide({ id: copyId, orgsFolder: resolve(orgsDir), syncMinutes: readSyncMinutes(orgsDir), timeZone: timeZone(), windows: process.platform === 'win32' }))
}

/** Keeps the text a bot had before the Connector changes it, once per distinct text. */
function backUp(orgsDir: string, todo: TodoFile, now: Date) {
  for (const item of todo.items) {
    if (item.kind !== 'describe' || !item.botId || item.expectedBefore === undefined) continue
    const dir = resolve(orgsDir, BACKUPS_DIR, item.botId.replace(/[^A-Za-z0-9_-]/g, '_'))
    const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.txt')).sort() : []
    const last = names.at(-1)
    if (last && readTextFile(join(dir, last)) === item.expectedBefore) continue
    writeFileAtomic(join(dir, `${now.toISOString().replace(/[:.]/g, '-')}.txt`), item.expectedBefore)
  }
}

export function runConnectorCycle(orgsDir: string, copyId: string, now = new Date()): { ok: true; dumpedAt: string } | { ok: false; error: string; missing: boolean } {
  const dump = readGrokData(orgsDir)
  // No dump yet: an older Connector still writes the snapshots itself, so nothing here is touched.
  if (!dump.ok) return dump
  const { data } = dump
  const orgsFolder = resolve(orgsDir)
  const zone = timeZone()
  const results = parseResults(readTextFile(resolve(orgsDir, RESULTS_FILE)) ?? '')
  const apps = readConnector(orgsDir)?.apps
  const orgs: { id: string; bundle: OrgBundle; requests: GrokRequest[] }[] = []
  const keepOrgs: string[] = []
  for (const slug of listOrgSlugs(orgsDir)) {
    const root = resolve(orgsDir, slug)
    const read = readOrgDir(root, slug)
    if (!read.ok) {
      keepOrgs.push(slug)
      continue
    }
    orgs.push({ id: slug, bundle: read.bundle, requests: readRequests(root).requests })
  }
  for (const org of orgs) {
    const orgName = org.bundle.org.company.name
    const created = org.requests.filter((request) => request.kind !== 'update').map((request) => request.name)
    const snapshot = snapshotFromData(data, org.bundle, orgName, copyId, apps, created)
    const blocks = orgBlocksFromData({ copyId, orgsFolder, timeZone: zone, org, data })
    const updated = updatedFor(org.id, org.requests, data, results, blocks)
    writeIfChanged(resolve(orgsDir, org.id, SNAPSHOT_PATH), snapshotJson({ ...snapshot, ...(updated.length ? { updated } : {}) }))
  }
  const unassigned = unassignedFromData(data, orgs.map((org) => ({ bundle: org.bundle, orgName: org.bundle.org.company.name, created: org.requests.filter((request) => request.kind !== 'update').map((request) => request.name) })))
  writeIfChanged(resolve(orgsDir, UNASSIGNED_FILE), `${JSON.stringify({ syncedAt: data.dumpedAt, unassigned: unassigned.map(botJson) }, null, 2)}\n`)
  const todo = computeTodo({ copyId, orgsFolder, timeZone: zone, data, orgs, keepOrgs, results, removeCopies: readRemoveCopies(orgsDir), now })
  backUp(orgsDir, todo, now)
  writeIfChanged(resolve(orgsDir, TODO_FILE), `${JSON.stringify(todo, null, 2)}\n`)
  return { ok: true, dumpedAt: data.dumpedAt }
}
