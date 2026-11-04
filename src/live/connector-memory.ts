import type { ConnectorInfo } from '../../server/src/grok-sync.ts'
import type { ConnectorView } from '../components/sync-copy.ts'

/**
 * The last Connector state this browser tab saw. The header badge and the connection bar show it at once on the next
 * page or tab instead of Checking, then ask the writer again.
 */
const REMEMBER_KEY = 'be:grok-status'

export type RememberedStatus = ConnectorView & { project?: ConnectorInfo }

type Remembered = { slug: string; status: RememberedStatus }

export function remembered(): Remembered | null {
  try {
    const raw = sessionStorage.getItem(REMEMBER_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Remembered>) : null
    return saved && typeof saved.slug === 'string' && saved.status && typeof saved.status === 'object' ? { slug: saved.slug, status: saved.status } : null
  } catch {
    return null
  }
}

export function remember(slug: string, status: RememberedStatus) {
  try {
    sessionStorage.setItem(REMEMBER_KEY, JSON.stringify({ slug, status }))
  } catch {
    // Storage can be off; the badge and the bar still work from the writer's answer.
  }
}
