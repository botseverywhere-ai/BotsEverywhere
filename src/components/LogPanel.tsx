import { useState } from 'react'
import { canDelete } from '../../server/src/grok-requests.ts'
import type { FileActivity, SeatDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { DeleteInGrokBot } from './RetiredDrawer'
import { grokDirection, grokDirectionLabel, isGrokEvent, logLabel, parseStats } from './sync-copy'

type LogFilter = 'all' | 'grok' | 'team'

const FILTERS: [LogFilter, string][] = [
  ['all', 'Everything'],
  ['grok', 'Grok Bot and the Connector'],
  ['team', 'Team and work'],
]

export function LogPanel({
  events,
  waiting,
  stepNames,
  onStep,
  retired,
}: {
  events: FileActivity[]
  /** To Grok Bot lines still waiting for the Connector. They pulse like the Sync drawer's waiting list. */
  waiting?: Set<string>
  stepNames: Map<string, { workstream: string; index: number }>
  onStep: (stepId: string) => void
  /** Your own orgs only: retired seats, so a Retired line can offer Delete in Grok Bot like the Retired list does. */
  retired?: { seats: SeatDocument[]; activeElsewhere: Record<string, string[]> }
}) {
  const [filter, setFilter] = useState<LogFilter>('all')
  // The retired bot whose delete steps are open.
  const [deleting, setDeleting] = useState<SeatDocument | null>(null)
  const rows = [...events]
    .filter((event) => filter === 'all' || (filter === 'grok') === isGrokEvent(event))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  return (
    <section className="be-log" aria-label="Log">
      <header>
        <h2>Log</h2>
        <label className="be-log-filter">
          <span className="sr-only">Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as LogFilter)}>
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </header>
      {rows.length === 0 ? (
        <p className="be-empty">
          {filter === 'all' ? 'Nothing logged yet. Hires, retirements, work, approvals, and every Connector run will show up here.' : 'Nothing of this kind logged yet.'}
        </p>
      ) : null}
      <ul>
        {rows.map((event) => {
          const step = event.stepId ? stepNames.get(event.stepId) : undefined
          const direction = grokDirection(event)
          // One line per entry: the figures follow the summary in small type; hovering shows all of it.
          const figures = parseStats(event.stats).map(([label, value]) => `${label} ${value}`).join(' · ')
          const deletable = event.type === 'fire' ? retired?.seats.find((seat) => seat.slug === event.subjectSeatId && canDelete(seat)) : undefined
          return (
            <li key={event.id} className={event.kind ? `is-${event.kind}` : undefined}>
              <div className="be-log-line" title={figures ? `${event.summary}\n${figures}` : event.summary}>
                <time dateTime={event.timestamp}>{formatWhen(event.timestamp)}</time>
                <strong>{logLabel(event).toUpperCase()}</strong>
                {direction ? <span className={`grok-badge is-${direction}`}>{grokDirectionLabel(direction)}</span> : null}
                <span className="be-log-text">
                  {event.summary}
                  {figures ? <small className="be-log-figures"> · {figures}</small> : null}
                  {waiting?.has(event.id) ? <span className="be-log-syncing be-connecting"><i className="be-pulse" aria-hidden="true" />Syncing with Grok Bot</span> : null}
                  {deletable ? <Button variant="secondary" type="button" className="be-log-delete" onClick={() => setDeleting(deletable)}>Delete in Grok Bot…</Button> : null}
                </span>
                {step && event.stepId ? (
                  <button type="button" className="be-step-chip" onClick={() => onStep(event.stepId!)}>
                    Step {step.index}
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {deleting ? (
        <DeleteInGrokBot
          deleting={deleting}
          elsewhere={retired?.activeElsewhere[deleting.slug] ?? []}
          note="Logs shows Deleted in Grok Bot after the Connector's next run."
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date)
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  return `${day} ${time}`
}
