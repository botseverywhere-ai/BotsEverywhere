import { Fragment, useEffect, useRef, useState } from 'react'
import type { ConnectorInfo } from '../../server/src/grok-sync.ts'
import { canEditFiles } from '../mode'
import { Button } from './Button'
import { connectorDetails, connectorRanAt, connectorState, headerBadgeLabel, lastRunShort, type ConnectorView } from './sync-copy'

const SAVING_OFF = 'The file writer is not running.'
/** The last state this browser saw, so the badge shows it at once on the next page instead of nothing until the writer answers. */
const REMEMBER_KEY = 'be:grok-status'

type Remembered = { slug: string; status: ConnectorView }

function remembered(): Remembered | null {
  try {
    const raw = sessionStorage.getItem(REMEMBER_KEY)
    const saved = raw ? (JSON.parse(raw) as Partial<Remembered>) : null
    return saved && typeof saved.slug === 'string' && saved.status && typeof saved.status === 'object' ? { slug: saved.slug, status: saved.status } : null
  } catch {
    return null
  }
}

function remember(slug: string, status: ConnectorView) {
  try {
    sessionStorage.setItem(REMEMBER_KEY, JSON.stringify({ slug, status }))
  } catch {
    // Storage can be off; the badge still works from the writer's answer.
  }
}

/**
 * Before Open your org, on every page of your own copy: is Grok Bot connected?
 * It asks the writer for the Connector's state alone (two small files), never for a sync plan, so it answers at once.
 */
export function GrokStatusBadge() {
  const [slug, setSlug] = useState(() => remembered()?.slug ?? '')
  const [status, setStatus] = useState<ConnectorView | null>(() => remembered()?.status ?? null)
  const [now, setNow] = useState(() => Date.now())
  const menuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    // A click anywhere else closes the dropdown.
    const close = (event: MouseEvent) => {
      const menu = menuRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    if (!canEditFiles) return
    let cancel = false
    // One request at a time: the minute timer and a slow writer must not stack them. The flag belongs to this
    // run of the effect: React starts it twice in development, and the first run is cancelled, so a shared flag
    // would make the second run skip its request and leave the badge on Checking.
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const response = await fetch('/api/connector')
        if (!response.ok || cancel) return
        const info = (await response.json()) as ConnectorInfo
        if (cancel) return
        const first = info.orgs[0] ?? ''
        const next: ConnectorView = { snapshot: null, error: '', project: info }
        setSlug(first)
        setStatus(next)
        setNow(Date.now())
        remember(first, next)
      } catch {
        if (!cancel) setStatus({ snapshot: null, error: SAVING_OFF })
      } finally {
        inFlight = false
      }
    }
    void load()
    // Every minute: a new run, or a missed one that turns it to Disconnected.
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])

  if (!canEditFiles) return null
  if (!status) {
    // Nothing known yet: hold the place, so the bar never looks as if there were no Grok Bot.
    return (
      <span className="grok-status is-checking" aria-label="Grok Bot: checking">
        <i aria-hidden="true" />
        <span className="grok-status-text">
          <strong>Checking…</strong>
          <small>Grok Bot</small>
        </span>
      </span>
    )
  }
  const { state, line } = connectorState(status, now)
  const label = headerBadgeLabel(state)
  const ranAt = state === 'connected' || state === 'stale' ? connectorRanAt(status) : undefined
  const ran = ranAt === undefined ? '' : lastRunShort(ranAt, now)
  if (!label) return null
  const details = connectorDetails(status, now)
  return (
    <details ref={menuRef} className="grok-status-menu">
      <summary className={`grok-status is-${state}`} title={line} aria-label={`Grok Bot: ${line}`}>
        <i aria-hidden="true" />
        <span className="grok-status-text">
          <strong>{label}</strong>
          <small>{ran ? `Grok Bot · ${ran}` : 'Grok Bot'}</small>
        </span>
      </summary>
      <div className={`grok-status-panel is-${details.state}`}>
        <div className="grok-status-head">
          <strong><i aria-hidden="true" />{details.title}</strong>
          <p>{details.note}</p>
        </div>
        {details.warning ? <p className="grok-status-warning" role="status">{details.warning}</p> : null}
        <dl className="grok-status-facts">
          {details.facts.map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        </dl>
        <Button variant="secondary" className="btn-block" href={slug ? `#/org/${slug}/connect-bots` : '#/orgs'} onClick={() => { if (menuRef.current) menuRef.current.open = false }}>
          Open Connect bots
        </Button>
      </div>
    </details>
  )
}
