import { useState } from 'react'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { canDelete } from '../../server/src/grok-requests.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { retiredGroups, retiredKindLabel, retiredGrokLine } from './sync-copy'

/**
 * Everyone retired from this organization, opened from Retired in the org chart legend.
 * Grok Bot gives the Connector no delete tool, so a retired bot is deleted there by hand: the row links to the bot,
 * and the next Connector run that no longer lists it turns the row to Deleted.
 */
function retiredDay(seat: SeatDocument): string {
  return seat.retiredAt ? formatShortDate(seat.retiredAt.slice(0, 10)) : 'date unknown'
}

export function RetiredDrawer({
  seats,
  activeElsewhere,
  onClose,
}: {
  /** Retired seats only. */
  seats: SeatDocument[]
  /** Retired bot seat → organizations where the same bot is still active. */
  activeElsewhere: Record<string, string[]>
  onClose: () => void
}) {
  // Seats of one bot are one row.
  const groups = retiredGroups(seats)
  // The retired bot whose delete steps are open.
  const [deleting, setDeleting] = useState<SeatDocument | null>(null)
  const deletingElsewhere = deleting ? activeElsewhere[deleting.slug] ?? [] : []
  return (
    <div className="be-scrim" onClick={deleting ? () => setDeleting(null) : onClose}>
      <aside className="be-drawer be-hire retired-drawer" role="dialog" aria-labelledby="retired-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="retired-title">Retired ({groups.length})</h2>
            <button type="button" className="be-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <p className="overview-note">
            Retire takes a seat out of this organization only. A retired bot keeps running in Grok Bot until you delete it there.
            The row says Deleted after the Connector&apos;s next run.
          </p>
          {groups.length ? (
            <ul className="retired-list">
              {groups.map((group) => {
                const seat = group.find((item) => canDelete(item)) ?? group[0]!
                const elsewhere = activeElsewhere[seat.slug] ?? []
                const others = group.filter((item) => item !== group[0])
                return (
                  <li key={seat.slug}>
                    <div className="retired-row">
                      <strong>{seat.title}</strong>
                      <span className="retired-meta">{retiredKindLabel(seat.kind)} · retired {retiredDay(group[0]!)}</span>
                      {others.length ? <span className="retired-meta">{group.length} seats for this bot, also retired {others.map(retiredDay).join(', ')}</span> : null}
                      {seat.kind === 'bot' ? <span className="retired-meta">{retiredGrokLine(seat)}</span> : null}
                      {elsewhere.length ? <span className="grok-status-warning">Still active in {elsewhere.join(', ')}. Deleting it in Grok Bot stops it there too.</span> : null}
                    </div>
                    {canDelete(seat) ? (
                      <Button variant="secondary" type="button" onClick={() => setDeleting(seat)}>Delete in Grok Bot…</Button>
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
            <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          </div>
        </footer>
      </aside>
      {deleting ? (
        <div className="be-modal" role="dialog" aria-labelledby="delete-grok-title" onClick={(event) => event.stopPropagation()}>
          <h2 id="delete-grok-title">Delete {deleting.title} in Grok Bot</h2>
          <p>
            Grok Bot does not let the Connector, or any app outside Grok Bot, delete a bot. Open the bot in Grok Bot and delete it there:
            right-click <strong>{deleting.title}</strong> in the sidebar, choose Delete, and confirm. That removes the bot and its chat history.
          </p>
          {deletingElsewhere.length ? (
            <p className="grok-status-warning" role="alert">{deleting.title} is still active in {deletingElsewhere.join(', ')}. Deleting it in Grok Bot stops it there too.</p>
          ) : null}
          <p className="overview-note">The row here says Deleted after the Connector&apos;s next run.</p>
          <Button variant="secondary" type="button" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="primary" href={(deleting.grokBotUrl ?? '').trim()} target="_blank" rel="noreferrer" onClick={() => setDeleting(null)}>
            Open {deleting.title} in Grok Bot
          </Button>
        </div>
      ) : null}
    </div>
  )
}
