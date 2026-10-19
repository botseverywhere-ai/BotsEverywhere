import { useState } from 'react'
import type { CompanySeed, Seat, Step } from '../data/mock-companies'
import { Button } from './Button'

export function WorkChart({
  company,
  steps,
  byId,
  openLane,
  showException,
  pulse,
  fading,
  leastId,
  allowHire = true,
  onOpenLane,
  onException,
  onSeat,
  onHire,
}: {
  company: CompanySeed
  steps: Step[]
  byId: Map<string, Seat>
  openLane: string
  showException: boolean
  pulse: string
  fading: string
  leastId?: string
  allowHire?: boolean
  onOpenLane: (id: string) => void
  onException: () => void
  onSeat: (id: string) => void
  onHire?: (stepId: string) => void
}) {
  const mains = company.workstreams.filter((stream) => stream.kind === 'main')
  const extras = company.workstreams.filter((stream) => stream.kind === 'contingency')
  const lanes = [...mains, ...(showException ? extras : [])]
  return (
    <div className="work-board" data-testid="work-chart">
      {allowHire && onHire ? (
        <div className="work-board-tools">
          <Button variant="primary" type="button"  onClick={() => onHire('')}>
            Hire bot
          </Button>
        </div>
      ) : null}
      <ul className="work-legend">
        <li><i className="shape shape-human" /> Human</li>
        <li><i className="shape shape-bot" /> Bot</li>
        <li><i className="shape shape-system" /> System</li>
        <li><i className="shape shape-check" /> Needs approval</li>
        <li><i className="shape shape-open" /> No one assigned</li>
      </ul>
      {mains.map((stream) => {
        const trigger = company.triggers.find((item) => item.id === stream.triggerId)
        const owner = byId.get(stream.ownerSeatId)
        const open = openLane === stream.id
        const laneSteps = stream.stepIds.map((id) => steps.find((step) => step.id === id)).filter((step) => step != null)
        return (
          <section key={stream.id} className={open ? 'lane open' : 'lane'} id={stream.id}>
            <button type="button" className="lane-head" aria-expanded={open} onClick={() => onOpenLane(open ? '' : stream.id)}>
              <span className="stream-kicker">Trigger · {trigger?.source}</span>
              <strong>{trigger?.label}</strong>
              <span>{stream.outcome}</span>
            </button>
            {open ? (
              <div className="lane-scroll">
                <article className="flow-card flow-trigger">
                  <p className="stream-kicker">Trigger</p>
                  <h2>{trigger?.label}</h2>
                  <p>{trigger?.example}</p>
                </article>
                <span className="flow-arrow" aria-hidden="true">→</span>
                <article className="flow-card flow-outcome">
                  <p className="stream-kicker">Outcome · human owner</p>
                  <h2>{stream.outcome}</h2>
                  <button type="button" className="text-button" onClick={() => owner && onSeat(owner.id)}>
                    {owner?.name} · {owner?.role}
                  </button>
                </article>
                <span className="flow-arrow" aria-hidden="true">→</span>
                <LaneSteps
                  steps={laneSteps}
                  company={company}
                  byId={byId}
                  pulse={pulse}
                  fading={fading}
                  leastId={leastId}
                  allowHire={allowHire}
                  onSeat={onSeat}
                  onHire={onHire}
                  onException={onException}
                />
              </div>
            ) : null}
            {!showException && extras.length && open ? (
              <button type="button" className="exception-chip" onClick={onException}>
                ↳ {extras.length} exception
              </button>
            ) : null}
          </section>
        )
      })}
      {showException
        ? extras.map((stream) => (
            <section key={stream.id} className="lane exception open" id={stream.id}>
              <p className="stream-kicker">Exception</p>
              <h2>{stream.outcome}</h2>
              <div className="lane-scroll">
                {stream.stepIds.map((id) => steps.find((step) => step.id === id)).filter((step) => step != null).map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    company={company}
                    byId={byId}
                    pulse={pulse === step.id}
                    fading={fading === step.executorSeatId}
                    least={leastId === step.executorSeatId}
                    allowHire={allowHire}
                    onSeat={onSeat}
                    onHire={onHire}
                    onException={onException}
                  />
                ))}
              </div>
            </section>
          ))
        : null}
      {lanes.length === 0 ? <p>No workstream in this org.</p> : null}
    </div>
  )
}

function LaneSteps({
  steps,
  company,
  byId,
  pulse,
  fading,
  leastId,
  allowHire,
  onSeat,
  onHire,
  onException,
}: {
  steps: Step[]
  company: CompanySeed
  byId: Map<string, Seat>
  pulse: string
  fading: string
  leastId?: string
  allowHire: boolean
  onSeat: (id: string) => void
  onHire?: (stepId: string) => void
  onException: () => void
}) {
  const [expanded, setExpanded] = useState(steps.length <= 5)
  const shown = expanded ? steps : steps.slice(0, 5)
  const hidden = expanded ? [] : steps.slice(5)
  return (
    <>
      {shown.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          company={company}
          byId={byId}
          pulse={pulse === step.id}
          fading={fading === step.executorSeatId}
          least={leastId === step.executorSeatId}
          allowHire={allowHire}
          onSeat={onSeat}
          onHire={onHire}
          onException={onException}
        />
      ))}
      {hidden.length ? (
        <button type="button" className="step-dots" onClick={() => setExpanded(true)}>
          {hidden.map((_, index) => (
            <span key={index}>{index + 6}</span>
          ))}
        </button>
      ) : null}
    </>
  )
}

function StepCard({
  step,
  company,
  byId,
  pulse,
  fading,
  least,
  allowHire,
  onSeat,
  onHire,
  onException,
}: {
  step: Step
  company: CompanySeed
  byId: Map<string, Seat>
  pulse: boolean
  fading: boolean
  least: boolean
  allowHire: boolean
  onSeat: (id: string) => void
  onHire?: (stepId: string) => void
  onException: () => void
}) {
  const seat = byId.get(step.executorSeatId)
  const unstaffed = step.staffing === 'unstaffed' || !seat
  const checkpoint = company.checkpoints.find((item) => item.id === step.checkpointId)
  const approver = checkpoint ? byId.get(checkpoint.approverSeatId) : undefined
  const { forward, loops } = stepEdges(company, step)
  return (
    <>
      <article id={`step-${step.id}`} className={`flow-step kind-${unstaffed ? 'open' : seat?.type} ${pulse ? 'step-pulse' : ''} ${fading ? 'step-fading' : ''} ${least ? 'step-least' : ''}`}>
        <p className="stream-kicker">
          {unstaffed ? (
            <>
              No one assigned
              <span className="unstaffed-warn">
                <button type="button" className="unstaffed-icon" aria-describedby={`unstaffed-${step.id}`}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M7 4v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="7" cy="10" r="0.8" fill="currentColor" />
                  </svg>
                  <span className="sr-only">No one assigned</span>
                </button>
                <span className="unstaffed-tip" id={`unstaffed-${step.id}`} role="tooltip">
                  No one assigned
                </span>
              </span>
            </>
          ) : (
            seat?.type
          )}
        </p>
        <h3>{step.name}</h3>
        {unstaffed ? (
          allowHire && onHire ? (
            <Button variant="secondary" type="button"  onClick={() => onHire(step.id)}>
              + Hire
            </Button>
          ) : null
        ) : (
          <button type="button" className="text-button" onClick={() => onSeat(seat.id)}>
            {seat.name}
            {seat.type === 'bot' ? <span className="bot-pill">BOT</span> : null}
            {least ? <span className="least-tag">Least used</span> : null}
          </button>
        )}
        {checkpoint ? (
          <p className="checkpoint">
            <span className="diamond" aria-hidden="true" /> Needs approval · {checkpoint.rule}
            {approver ? ` · ${approver.name}` : ''}
          </p>
        ) : null}
        {step.exceptionTo ? (
          <button type="button" className="exception-chip" onClick={onException}>
            ↳ 1 exception
          </button>
        ) : null}
        {loops.map((handoff) => {
          const target = company.steps.find((item) => item.id === handoff.toStepId)
          return (
            <p key={handoff.id} className="loop-edge">
              ↩ {handoff.condition ?? 'back'} → {target?.name ?? 'previous step'}
            </p>
          )
        })}
      </article>
      {forward ? <span className="flow-arrow" aria-hidden="true">→</span> : null}
    </>
  )
}

function stepEdges(company: CompanySeed, step: Step): { forward: boolean; loops: CompanySeed['handoffs'] } {
  const stream = company.workstreams.find((item) => item.stepIds.includes(step.id))
  const order = stream?.stepIds ?? []
  const nextId = order[order.indexOf(step.id) + 1]
  const outgoing = company.handoffs.filter((item) => item.fromStepId === step.id && item.condition !== 'mismatch')
  const forward = outgoing.find((item) => item.toStepId === nextId)
  return { forward: Boolean(forward), loops: outgoing.filter((item) => item !== forward) }
}
