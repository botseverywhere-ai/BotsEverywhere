import type { FileGuideKey, FileGuideRow } from '../../server/src/file-guide.ts'
import { lastRunShort } from './sync-copy.ts'

/** Your files on Organization Overview, grouped by who writes each part. */
export const FILE_GROUPS: { title: string; keys: FileGuideKey[] }[] = [
  { title: 'Your organization', keys: ['org', 'seats', 'processes'] },
  { title: 'Your bots write these', keys: ['log'] },
  { title: 'The Connector writes these', keys: ['grok', 'connector'] },
]

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
  log: 'What each bot did, one file per day, and events like hires and syncs',
  grok: 'What the Connector last saw in Grok Bot, and the bots the app asked it to create',
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

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}
