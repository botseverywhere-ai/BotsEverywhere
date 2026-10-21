export type FileGuideKey = 'org' | 'seats' | 'processes' | 'log' | 'grok' | 'connector'

/** One part of an org folder on this computer, as it is right now. */
export interface FileGuideRow {
  key: FileGuideKey
  /** Absolute path of the file or folder. */
  path: string
  files: number
  /** ISO time the newest file was written. Empty when nothing is there. */
  updatedAt: string
  /** Dated run logs in log/. Only on the log row. */
  days?: number
}

/** What GET /api/orgs/<slug>/files returns. */
export interface FileGuide {
  /** Absolute path of the org folder. */
  folder: string
  rows: FileGuideRow[]
}
