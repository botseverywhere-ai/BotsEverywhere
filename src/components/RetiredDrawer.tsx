import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { canDelete } from '../../server/src/grok-requests.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { retiredKindLabel, retiredGrokLine } from './sync-copy'

/**
 * Everyone retired from this organization, opened from Retired in the org chart legend.
 * Grok Bot gives the Connector no delete tool, so a retired bot is deleted there by hand: the row links to the bot,
 * and the next Connector run that no longer lists it turns the row to Deleted.
 */
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
  const sorted = [...seats].sort((a, b) => (b.retiredAt || '').localeCompare(a.retiredAt || ''))
  return (
    <div className="be-scrim" onClick={onClose}>
      <aside className="be-drawer be-hire retired-drawer" role="dialog" aria-labelledby="retired-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="retired-title">Retired ({seats.length})</h2>
            <button type="button" className="be-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <p className="overview-note">
            Retire takes a seat out of this organization only. A retired bot keeps running in Grok Bot until you delete it there:
            choose <strong>Delete in Grok Bot</strong> to open the bot, then right-click it in the Grok Bot sidebar, choose Delete, and confirm.
            The row says Deleted after the Connector&apos;s next run.
          </p>
          {sorted.length ? (
            <ul className="retired-list">
              {sorted.map((seat) => {
                const elsewhere = activeElsewhere[seat.slug] ?? []
                return (
                  <li key={seat.slug}>
                    <div className="retired-row">
                      <strong>{seat.title}</strong>
                      <span className="retired-meta">{retiredKindLabel(seat.kind)} · retired {seat.retiredAt ? formatShortDate(seat.retiredAt.slice(0, 10)) : 'date unknown'}</span>
                      {seat.kind === 'bot' ? <span className="retired-meta">{retiredGrokLine(seat)}</span> : null}
                      {elsewhere.length ? <span className="grok-status-warning">Still active in {elsewhere.join(', ')}. Deleting it in Grok Bot stops it there too.</span> : null}
                    </div>
                    {canDelete(seat) ? (
                      <Button variant="secondary" href={(seat.grokBotUrl ?? '').trim()} target="_blank" rel="noreferrer">Delete in Grok Bot</Button>
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
    </div>
  )
}
