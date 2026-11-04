import { Button } from './Button'

export interface SeatListRow {
  id: string
  name: string
  /** Role and manager, one line. */
  meta: string
  /** A bot's Grok Bot state, when the list shows it. */
  tag?: string
  /** False for a bot with no seat on this chart: it is listed, not found. */
  pickable?: boolean
}

/** The seats one count stands for, from the org chart legend or the Overview boxes. Choosing a row finds the seat on the chart. */
export function SeatListDrawer({ title, rows, note = 'Choose a seat to find it on the chart.', onPick, onClose }: { title: string; rows: SeatListRow[]; note?: string; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div className="be-scrim" onClick={onClose}>
      <aside className="be-drawer be-hire legend-drawer" role="dialog" aria-labelledby="legend-list-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="legend-list-title">{title} ({rows.length})</h2>
            <button type="button" className="be-icon" onClick={onClose} aria-label="Close">×</button>
          </header>
          <p className="overview-note">{note}</p>
          <ul className="retired-list">
            {rows.map((row) => {
              const body = (
                <>
                  <strong>{row.name}</strong>
                  <span className="retired-meta">{row.meta}</span>
                  {row.tag ? <span className="retired-meta">{row.tag}</span> : null}
                </>
              )
              return (
                <li key={row.id}>
                  {row.pickable === false ? <div className="retired-row">{body}</div> : (
                    <Button variant="ghost" type="button" className="legend-row" onClick={() => onPick(row.id)}>{body}</Button>
                  )}
                </li>
              )
            })}
          </ul>
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
