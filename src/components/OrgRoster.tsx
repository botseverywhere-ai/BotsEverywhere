import type { SeatRecord, WorkChart } from '../api'
import { displayCardText } from '../preview/card-text'
import { Button } from './Button'

export function SeatRoster({
  seats,
  selected,
  onSelect,
}: {
  seats: SeatRecord[]
  selected?: string
  onSelect?: (id: string) => void
}) {
  const byParent = new Map<string, SeatRecord[]>()
  for (const seat of seats) {
    const key = seat.reportsTo || ''
    const list = byParent.get(key) ?? []
    list.push(seat)
    byParent.set(key, list)
  }
  const roots = byParent.get('') ?? []

  function branch(seat: SeatRecord) {
    const children = byParent.get(seat.id) ?? []
    return (
      <li key={seat.id}>
        <details className={`roster-card${selected === seat.id ? ' is-selected' : ''}`}>
          <summary>
            <strong>{seat.name}</strong>
            <span>
              {seat.kind === 'human' ? 'Human' : seat.kind === 'system' ? 'System' : 'Bot'}
              {seat.role ? ` · ${seat.role}` : ''}
            </span>
            {onSelect ? (
              <Button variant="secondary"
                type="button"
                
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSelect(seat.id)
                }}
              >
                Open
              </Button>
            ) : null}
          </summary>
          <SeatCardFields seat={seat} />
        </details>
        {children.length > 0 ? <ul className="roster-children">{children.map(branch)}</ul> : null}
      </li>
    )
  }

  if (roots.length === 0) return null
  return <ul className="roster-root">{roots.map(branch)}</ul>
}

export function SeatCardFields({ seat }: { seat: SeatRecord }) {
  const fields = [
    ['Owns', seat.owns],
    ['May', seat.may],
    ['Needs approval', seat.mustAskBefore],
    ['Done when', seat.doneWhen],
  ] as const
  return (
    <dl className="seat-card-fields">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ? displayCardText(value) : 'No text in the seat card.'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function WorkChain({ chart }: { chart: WorkChart }) {
  if (chart.workstreams.length === 0) return <p className="auth-note">No work chart yet.</p>
  const names = new Map(chart.seats.map((seat) => [seat.id, seat.name]))
  return (
    <div className="work-chains">
      {chart.workstreams.map((stream) => {
        const steps = chart.steps.filter((step) => step.workstreamId === stream.id)
        const backTo = new Set(
          chart.handoffs
            .filter((edge) => {
              const from = steps.find((step) => step.id === edge.fromStepId)
              const to = steps.find((step) => step.id === edge.toStepId)
              return from && to && from.sortOrder > to.sortOrder
            })
            .map((edge) => edge.fromStepId),
        )
        return (
          <article key={stream.id} className="work-chain">
            <h3>{stream.outcome}</h3>
            <p className="auth-note">
              {stream.triggerLabel}. Accountable: {names.get(stream.ownerSeatId) ?? 'Unknown'}.
            </p>
            <ol>
              {steps.map((step) => {
                const next = chart.handoffs.find((edge) => edge.fromStepId === step.id && !backTo.has(step.id))
                const back = chart.handoffs.find((edge) => edge.fromStepId === step.id && backTo.has(step.id))
                const gates = chart.checkpoints.filter((item) => item.stepId === step.id)
                return (
                  <li key={step.id}>
                    <div className="work-step">
                      <strong>{names.get(step.executorSeatId) ?? 'Seat'}</strong>
                      <span>{step.name}</span>
                    </div>
                    {gates.map((gate) => (
                      <p key={gate.id} className="checkpoint">
                        Human checkpoint. {names.get(gate.approverSeatId) ?? 'Approver'}: {gate.rule}
                      </p>
                    ))}
                    {next ? <p className="work-arrow">Hands off to {names.get(steps.find((item) => item.id === next.toStepId)?.executorSeatId ?? '') ?? 'the next seat'}</p> : null}
                    {back ? <p className="work-arrow">Reports back to {names.get(steps.find((item) => item.id === back.toStepId)?.executorSeatId ?? '') ?? 'the earlier seat'}</p> : null}
                  </li>
                )
              })}
            </ol>
          </article>
        )
      })}
    </div>
  )
}
