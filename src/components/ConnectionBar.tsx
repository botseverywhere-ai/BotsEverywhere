import { useEffect, useRef, useState } from 'react'
import { pushNotice } from '../live/notices'
import { orgFolder } from '../org/folder-path'
import { Button } from './Button'
import { connectorChangeNotice, connectorState, type ConnectionView, type ConnectorState } from './sync-copy'

const HIDDEN_KEY = 'be-connection-bar-hidden:'

function readHidden(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeHidden(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // The bar still hides for this page; it just shows again on the next load.
  }
}

/**
 * The project folder, this org's folder, and whether the project Connector writes to them. A warning only; it never blocks the org.
 * Once connected it can be closed; it comes back on its own when the Connector stops or breaks.
 */
export function ConnectionBar({ slug, status }: { slug: string; status: ConnectionView | null }) {
  const [now, setNow] = useState(() => Date.now())
  const key = HIDDEN_KEY + (status?.project?.id || slug)
  const [hidden, setHidden] = useState(() => readHidden(key))
  useEffect(() => {
    // "last run 4 min ago" ages, and a missed run turns it to stopped.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    // The project id arrives with the writer's answer, so read the remembered choice again for it.
    // oxlint-disable-next-line react/set-state-in-effect -- the key depends on the writer's answer
    setHidden(readHidden(key))
  }, [key])
  const folder = status?.project?.orgsFolder || status?.folder || orgFolder(slug)
  const { state, line } = connectorState(status, now)
  const ok = state === 'connected'
  // An alert card when the connection changes while you work. This runs even while the bar is closed.
  const seen = useRef<ConnectorState | null>(null)
  const name = status?.project?.connectorName || 'The Connector'
  useEffect(() => {
    const notice = connectorChangeNotice(seen.current, state, name, slug)
    if (state !== 'checking') seen.current = state
    if (notice) pushNotice(notice)
  }, [state, name, slug])
  if (ok && hidden) return null
  return (
    <div className={`org-connection is-${state}`} role={ok || state === 'checking' ? 'status' : 'alert'}>
      <span className="org-connection-folder">
        <span className="org-connection-label">Folder</span>
        <code title={folder}>{folder}</code>
        {status?.project ? <span className="org-connection-org">· this organization: {slug}</span> : null}
      </span>
      <span className="org-connection-state">
        <i className="org-connection-dot" aria-hidden="true" />
        {status?.project ? <span className="org-connection-name">{status.project.connectorName}</span> : null}
        {line}
        {!ok && state !== 'checking' ? <a href={`#/org/${slug}/connect-bots`}>Set up the Connector</a> : null}
        {ok ? (
          <Button
            variant="ghost"
            type="button"
            className="org-connection-close"
            aria-label="Close. The bar comes back if the Connector stops."
            onClick={() => {
              writeHidden(key)
              setHidden(true)
            }}
          >
            ×
          </Button>
        ) : null}
      </span>
    </div>
  )
}
