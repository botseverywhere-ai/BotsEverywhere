import type { FileGuideKey, FileGuideRow } from '../../server/src/file-guide.ts'
import type { ProjectInfo } from '../../server/src/grok-sync.ts'
import { connectorRanAt, lastRunShort } from './sync-copy.ts'

/** Your files on Organization Overview, grouped by who writes each part. */
export const FILE_GROUPS: { title: string; keys: FileGuideKey[] }[] = [
  { title: 'Your organization', keys: ['org', 'seats', 'processes'] },
  { title: 'Your bots and the app write these', keys: ['log'] },
  { title: 'The app writes these from Grok Bot', keys: ['grok'] },
  { title: 'The Connector writes these', keys: ['connector'] },
]

export const FILE_ID_NOTE = "The folder name is this organization's ID. It never changes, so bots always find their files."

export const FILE_NAMES: Record<FileGuideKey, string> = {
  org: 'org.md',
  seats: 'seats/',
  processes: 'processes/',
  log: 'log/',
  grok: 'grok/',
  connector: 'connector.json',
}

export const FILE_WHAT: Record<FileGuideKey, string> = {
  org: 'Name, purpose, and who reports to whom',
  seats: 'One file per person or bot: what it owns, may do, and must ask before doing',
  processes: 'The work: what starts it and each step',
  log: 'What each bot did, one file per day, and events like hires, syncs, and Connector runs',
  grok: "What Grok Bot showed on the Connector's last run, and the bots and changes waiting to go to Grok Bot",
  connector: 'When the Connector last ran. It sits in the orgs folder, beside every organization',
}

/** What is in one part of the folder right now. */
export function fileFact(row: FileGuideRow, now = Date.now()): string {
  const time = row.updatedAt ? lastRunShort(Date.parse(row.updatedAt), now) : ''
  switch (row.key) {
    case 'org':
      return time ? `Saved ${time}` : 'Not there yet'
    case 'seats':
    case 'processes':
      return row.files === 0 ? 'No files yet' : count(row.files, 'file')
    case 'log': {
      if (row.files === 0) return 'Nothing logged yet'
      const days = row.days ?? 0
      return `${count(days, 'day')} of run logs, ${count(row.files - days, 'event')} · last written ${time}`
    }
    case 'grok':
      return time ? `Updated ${time}` : 'Nothing yet'
    case 'connector':
      return time ? `Last run ${time}` : 'The Connector has not run yet'
  }
}

/** Step 1 shows the orgs folder right above, so the Status file row leaves out where the file sits. */
const STATUS_FILE_WHAT = 'When the Connector last ran'

/**
 * Status file on Connect bots: connector.json, with the name and fact Your files gives it. The time is the one the
 * Status line reads. The fact stays empty until the writer answers.
 */
export function connectorStatusFile(status: { project?: Pick<ProjectInfo, 'orgsFolder' | 'connector'> } | null, now = Date.now()): { name: string; path: string; what: string; fact: string } {
  const folder = status?.project?.orgsFolder.trim() || 'orgs'
  const sep = folder.includes('\\') ? '\\' : '/'
  const path = `${folder}${sep}${FILE_NAMES.connector}`
  if (!status?.project) return { name: FILE_NAMES.connector, path, what: STATUS_FILE_WHAT, fact: '' }
  const ran = status.project.connector ? connectorRanAt({ snapshot: null, project: status.project }) : undefined
  const row: FileGuideRow = { key: 'connector', path, files: ran ? 1 : 0, updatedAt: ran ? new Date(ran).toISOString() : '' }
  return { name: FILE_NAMES.connector, path, what: STATUS_FILE_WHAT, fact: fileFact(row, now) }
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

/** Step 2 on Connect bots once the organization has bots: how many active bots it has. The Connector only syncs files. */
export function botsLine(seats: { kind: string; title: string; status: string }[]): string {
  const count = seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired' && !seat.title.trim().toLowerCase().startsWith('connector - botseverywhere')).length
  return `${count} ${count === 1 ? 'bot' : 'bots'} in this organization`
}
