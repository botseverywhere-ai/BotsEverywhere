import { useEffect, useState } from 'react'
import type { SyncStatus } from '../../server/src/grok-sync.ts'
import { canEditFiles } from '../mode'
import { connectorState, headerBadgeLabel } from './sync-copy'

const SAVING_OFF = 'The file writer is not running.'

/**
 * Before Open your org, on every page of your own copy: is Grok Bot connected?
 * One Connector serves every org in the folder, so any org's status tells it.
 */
export function GrokStatusBadge() {
  const [slug, setSlug] = useState('')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!canEditFiles) return
    let cancel = false
    const load = async () => {
      try {
        const list = await fetch('/api/orgs')
        const orgs = list.ok ? ((await list.json()) as { orgs?: { slug: string; ok: boolean }[] }).orgs ?? [] : []
        const first = orgs.find((item) => item.ok)?.slug ?? ''
        if (!first) return
        const response = await fetch(`/api/orgs/${first}/sync`)
        if (!response.ok || cancel) return
        const next = (await response.json()) as SyncStatus
        if (cancel) return
        setSlug(first)
        setStatus(next)
        setNow(Date.now())
      } catch {
        if (!cancel) setStatus({ snapshot: null, error: SAVING_OFF, plan: null, lastConfirmed: '', folder: '' })
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

  if (!canEditFiles || !status) return null
  const { state, line } = connectorState(status, now)
  const label = headerBadgeLabel(state)
  if (!label) return null
  return (
    <a className={`grok-status is-${state}`} href={slug ? `#/org/${slug}/connect-bots` : '#/orgs'} title={line} aria-label={`Grok Bot: ${line}`}>
      <i aria-hidden="true" />
      <span className="grok-status-text">
        <strong>{label}</strong>
        <small>Grok Bot</small>
      </span>
    </a>
  )
}
