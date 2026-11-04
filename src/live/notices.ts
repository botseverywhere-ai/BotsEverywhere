import type { RunLine } from '../../server/src/run-log.ts'

/** A link goes to a tab; openSync opens the Sync drawer of that org. */
export type NoticeLink = { label: string; href: string } | { label: string; openSync: string }

export interface NoticeInput {
  /** Green when done, yellow when it needs a look, red when it failed. */
  kind: 'ok' | 'warn' | 'bad'
  message: string
  link?: NoticeLink
  /** Raised by the run log or the Connector, not by a click. */
  live?: boolean
}

export interface Notice extends NoticeInput {
  id: string
}

export const MAX_NOTICES = 4
export const OPEN_SYNC_EVENT = 'be:open-sync'

export function createNoticeStore() {
  let notices: Notice[] = []
  let next = 0
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    get: () => notices,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    push(input: NoticeInput): string {
      next += 1
      const id = `notice-${next}`
      notices = [...notices.filter((item) => item.message !== input.message), { ...input, id }].slice(-MAX_NOTICES)
      emit()
      return id
    },
    dismiss(id: string) {
      if (!notices.some((item) => item.id === id)) return
      notices = notices.filter((item) => item.id !== id)
      emit()
    },
  }
}

/** One store for the whole app, so notices outlive a tab switch. */
export const notices = createNoticeStore()
export const pushNotice = notices.push
export const dismissNotice = notices.dismiss

let pendingSync = ''

/** Opens the Sync drawer of an org, going to that org first when it is not on screen. */
export function requestOpenSync(orgSlug: string) {
  pendingSync = orgSlug
  if (!window.location.hash.startsWith(`#/org/${orgSlug}/`)) {
    window.location.hash = `#/org/${orgSlug}/org-chart`
    return
  }
  window.dispatchEvent(new Event(OPEN_SYNC_EVENT))
}

/** True once for the org a Review the sync link asked for. */
export function takePendingSync(orgSlug: string): boolean {
  if (pendingSync !== orgSlug) return false
  pendingSync = ''
  return true
}

function lineKey(line: RunLine): string {
  return [line.date, line.index, line.time, line.bot, line.process, line.step, line.status].join('|')
}

export function newRunLines(before: RunLine[], after: RunLine[]): RunLine[] {
  const seen = new Set(before.map(lineKey))
  return after.filter((line) => !seen.has(lineKey(line)))
}

export function runLinesNotice(lines: RunLine[], workHref = ''): NoticeInput | null {
  if (lines.length === 0) return null
  const failed = lines.filter((line) => line.status === 'failed').length
  const warned = lines.some((line) => line.status === 'skipped' || line.status === 'waiting')
  const kind = failed ? 'bad' : warned ? 'warn' : 'ok'
  const link = { label: 'See the Work Chart', href: workHref }
  if (lines.length === 1) {
    const [only] = lines
    const note = only.note && only.note !== '-' ? ` · ${only.note}` : ''
    return { kind, message: `${only.bot} · ${only.process} · ${only.step}: ${only.status}${note}`, link }
  }
  const message = failed ? `${lines.length} new run-log lines, ${failed} failed` : `${lines.length} new run-log lines`
  return { kind, message, link }
}

interface SnapshotLook {
  snapshot: { stamp: string } | null
  plan: { writes: number } | null
}

/** previousStamp is undefined before the first look, '' when there was no snapshot. */
export function snapshotNotice(previousStamp: string | undefined, status: SnapshotLook, orgSlug: string): NoticeInput | null {
  if (previousStamp === undefined) return null
  const stamp = status.snapshot?.stamp ?? ''
  const writes = status.plan?.writes ?? 0
  if (!stamp || stamp === previousStamp || writes === 0) return null
  return {
    kind: 'warn',
    message: `Grok Bot sent a new snapshot: ${writes} ${writes === 1 ? 'change' : 'changes'} to sync`,
    link: { label: 'Review the sync', openSync: orgSlug },
  }
}
