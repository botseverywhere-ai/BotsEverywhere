import { useState } from 'react'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { canDelete, deleteFor, type GrokDelete } from '../../server/src/grok-requests.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { DEFAULT_SYNC_MINUTES, everyLabel } from '../../server/src/connector-timing.ts'
import { retiredKindLabel, retiredGrokLine } from './sync-copy'

/**
 * Everyone retired from this organization, opened from Retired in the org chart legend.
 * Grok Bot cannot delete bots itself, so the person deletes a retired bot there; the app waits until the Connector stops reporting it.
 */
export function RetiredDrawer({
  syncMinutes = DEFAULT_SYNC_MINUTES,
  seats,
  deletes,
  onClose,
  onDelete,
  onCancel,
  checkDelete,
}: {
  /** How often the Connector runs, so the confirm says when the row updates. */
  syncMinutes?: number
  /** Retired seats only. */
  seats: SeatDocument[]
  deletes: GrokDelete[]
  onClose: () => void
  onDelete: (seat: SeatDocument) => Promise<boolean>
  onCancel: (seat: SeatDocument) => Promise<void>
  /** Organizations that still have this bot active. */
  checkDelete: (seat: SeatDocument) => Promise<string[]>
}) {
  const [confirm, setConfirm] = useState<{ seat: SeatDocument; activeIn: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const sorted = [...seats].sort((a, b) => (b.retiredAt || '').localeCompare(a.retiredAt || ''))

  async function ask(seat: SeatDocument) {
    setBusy(true)
    const activeIn = await checkDelete(seat)
    setBusy(false)
    setConfirm({ seat, activeIn })
  }

  async function confirmDelete() {
    if (!confirm || busy) return
    setBusy(true)
    const ok = await onDelete(confirm.seat)
    setBusy(false)
    if (ok) setConfirm(null)
  }

  async function cancel(seat: SeatDocument) {
    setBusy(true)
    await onCancel(seat)
    setBusy(false)
  }

  return (
    <div className="be-scrim" onClick={busy ? undefined : onClose}>
      <aside className="be-drawer be-hire retired-drawer" role="dialog" aria-labelledby="retired-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="retired-title">Retired ({seats.length})</h2>
            <button type="button" className="be-icon" onClick={onClose} aria-label="Close" disabled={busy}>
              ×
            </button>
          </header>
          <p className="overview-note">
            Retire takes a seat out of this organization only. A retired bot keeps running in Grok Bot until you delete it there.
          </p>
          {sorted.length ? (
            <ul className="retired-list">
              {sorted.map((seat) => {
                const waiting = seat.kind === 'bot' ? deleteFor(deletes, seat) : undefined
                return (
                  <li key={seat.slug}>
                    <div className="retired-row">
                      <strong>{seat.title}</strong>
                      <span className="retired-meta">{retiredKindLabel(seat.kind)} · retired {seat.retiredAt ? formatShortDate(seat.retiredAt.slice(0, 10)) : 'date unknown'}</span>
                      {seat.kind === 'bot' ? <span className="retired-meta">{retiredGrokLine(seat, waiting)}</span> : null}
                    </div>
                    {waiting && !seat.grokDeletedAt ? (
                      <Button variant="secondary" type="button" disabled={busy} onClick={() => void cancel(seat)}>Cancel</Button>
                    ) : canDelete(seat) ? (
                      <Button variant="secondary" type="button" disabled={busy} onClick={() => void ask(seat)}>Delete in Grok Bot…</Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="overview-note">Nobody has been retired from this organization.</p>
          )}
        </div>
        <footer className="be-hire-foot">
          <div className="dir-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>Close</Button>
          </div>
        </footer>
      </aside>
      {confirm ? (
        <div className="be-modal" role="dialog" aria-labelledby="delete-grok-title" onClick={(event) => event.stopPropagation()}>
          <h2 id="delete-grok-title">Delete {confirm.seat.title} in Grok Bot</h2>
          <p>
            Grok Bot does not let the Connector delete bots, so you delete it there: in Grok Bot, right-click <strong>{confirm.seat.title}</strong> in the sidebar,
            choose Delete, and confirm. That removes the bot and its chat history.
          </p>
          <p className="overview-note">
            Choose Wait for it, and this row says the delete is waiting until the Connector&apos;s next run no longer lists the bot. It runs every {everyLabel(syncMinutes)}. The seat stays retired here.
          </p>
          {confirm.activeIn.length ? (
            <p className="grok-status-warning" role="alert">
              {confirm.seat.title} is still active in {confirm.activeIn.join(', ')}. Deleting it in Grok Bot stops it there too.
            </p>
          ) : null}
          <Button variant="secondary" type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" type="button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? 'Saving…' : 'Wait for it'}</Button>
        </div>
      ) : null}
    </div>
  )
}
