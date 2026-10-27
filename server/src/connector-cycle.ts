import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKUPS_DIR, GUIDE_FILE, RESULTS_FILE, TODO_FILE, UNASSIGNED_FILE, readTextFile, writeFileAtomic } from './connector-files.ts'
import { SNAPSHOT_PATH, connectorGuide } from './connector-prompt.ts'
import { computeTodo, orgBlocksFromData, parseResults, updatedFor, type TodoFile } from './connector-todo.ts'
import { botJson, readGrokData, snapshotFromData, snapshotJson, unassignedFromData } from './grok-data.ts'
import type { GrokRequest } from './grok-requests.ts'
import type { ConnectorState } from './grok-sync.ts'
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
  writeIfChanged(resolve(orgsDir, TODO_FILE), `${JSON.stringify(withRuns(todo, readTodo(orgsDir)), null, 2)}\n`)
  return { ok: true, dumpedAt: data.dumpedAt }
}

function readTodo(orgsDir: string): TodoFile | null {
  try {
    const text = readTextFile(resolve(orgsDir, TODO_FILE))
    const data = text ? JSON.parse(text) as TodoFile : null
    return data && Array.isArray(data.items) ? data : null
  } catch {
    return null
  }
}

/** Each item keeps the dump it was first listed after; its count goes up once per newer dump it is still listed after. */
function withRuns(todo: TodoFile, previous: TodoFile | null): TodoFile {
  const before = new Map((previous?.items ?? []).map((item) => [item.key, item]))
  const newer = previous?.basedOn !== todo.basedOn
  return {
    ...todo,
    items: todo.items.map((item) => {
      const last = before.get(item.key)
      const runs = last && typeof last.runs === 'number' ? last.runs + (newer ? 1 : 0) : 1
      return { ...item, since: typeof last?.since === 'string' ? last.since : todo.basedOn, runs }
    }),
  }
}

/**
 * What the Connector could not do, for one organization's Sync drawer: stuck items with their reason, items on their
 * second try, items listed after more than two dumps, a dump that could not be read, and other copies' blocks.
 */
export function connectorState(orgsDir: string, orgId: string): ConnectorState {
  const dump = readGrokData(orgsDir)
  const dumpError = !dump.ok && !dump.missing ? dump.error : ''
  const todo = readTodo(orgsDir)
  const results = parseResults(readTextFile(resolve(orgsDir, RESULTS_FILE)) ?? '')
  const removing = readRemoveCopies(orgsDir)
  const here = (org: string) => org === orgId || org === ''
  const items = (todo?.items ?? []).filter((item) => here(item.org))
  const failed = items.flatMap((item) => {
    const attempt = Number(/#(\d+)$/.exec(item.key)?.[1] ?? 1)
    if (attempt < 2) return []
    const last = results.results.filter((result) => result.key === item.key.replace(/#\d+$/, `#${attempt - 1}`)).at(-1)
    return [{ bot: item.bot, why: last?.status === 'done' ? 'reported done, but Grok Bot does not show it' : last?.why || 'no reason given' }]
  })
  const late = items.filter((item) => (item.runs ?? 0) > 2)
  return {
    stuck: (todo?.stuck ?? []).filter((item) => here(item.org)).map((item) => ({ bot: item.bot, why: item.why })),
    failed,
    pending: late.length,
    pendingSince: late.map((item) => item.since ?? '').filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? '',
    dumpError,
    otherCopies: (todo?.otherCopies ?? []).map((item) => ({ copy: item.copy, bots: item.bots, removing: removing.includes(item.copy) })),
  }
}
