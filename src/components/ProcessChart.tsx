import { useMemo, useRef, useState } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import {
  grokProcessesPrompt,
  deriveSteps,
  processSlug,
  stepText,
  triggerLabel,
  waitsForYou,
  type ProcessFile,
  type TriggerType,
} from '../../server/src/processes.ts'
import { activitySentence, latestStepStatus, newestFirst, waitingLines, type RunLine } from '../../server/src/run-log.ts'
import { CopyPromptButton } from '../directory/prompt-actions'
import { Button } from './Button'
import { ChartPngButton } from './ChartPngButton'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import type { RoutineBoard } from '../../server/src/routine-board-types.ts'
import { HANDOFFS_HINT, IDLE_HINT, OFF_CHART_HINT, ROUTINES_HINT, flowSegment, idleWithRoutines, importSummary, laneNoRoutine, laneProblems, lanePaused, laneRoutine, laneWhen, routinesOffChart, scheduleWords } from './routine-board-copy'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

/** Which segments the Work Chart shows: all of them, or one. */
type Show = 'all' | 'routines' | 'handoffs' | 'off' | 'idle'

export function ProcessChart({
  orgId,
  editable,
  seats,
  processes,
  fallbackProcess = 'triage',
  focusSeat = '',
  runLines = [],
  onSeat,
  onReload,
  png,
  board,
}: {
  orgId: string
  editable: boolean
  seats: SeatDocument[]
  processes: ProcessFile[]
  fallbackProcess?: string
  focusSeat?: string
  runLines?: RunLine[]
  onSeat: (slug: string) => void
  onReload: () => Promise<void>
  /** Your own orgs only: Download PNG on the line under the heading. */
  png?: { orgName: string }
  /** Your own orgs only: what each bot reports it runs in Grok Bot, shown in the flow it belongs to. */
  board?: RoutineBoard | null
}) {
  const lanesRef = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState<Show>('all')
  const [removing, setRemoving] = useState<ProcessFile | null>(null)
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const approvals = useMemo(() => waitingLines(runLines, processes), [processes, runLines])
  const feed = useMemo(() => newestFirst(runLines), [runLines])
  const offChart = useMemo(() => routinesOffChart(board, processes), [board, processes])
  const routineFlows = processes.filter((process) => flowSegment(process) === 'routines')
  const handoffFlows = processes.filter((process) => flowSegment(process) === 'handoffs')
  const seatRefs = useMemo(() => seats.map((seat) => ({ slug: seat.slug, title: seat.title, kind: seat.kind, mustAskBefore: seat.mustAskBefore })), [seats])
  const processesPrompt = useMemo(() => grokProcessesPrompt(seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired').map((seat) => seat.title)), [seats])
  const used = useMemo(() => new Set(processes.flatMap((process) => process.steps.map((step) => step.seat))), [processes])
  const idleBots = seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired' && !used.has(seat.slug))
  const focusName = seats.find((seat) => seat.slug === focusSeat)?.title || focusSeat

  async function remove(process: ProcessFile) {
    setBusy(true)
    try {
      const response = await fetch(`/api/orgs/${orgId}/processes/${process.slug}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = (await response.json()) as { errors?: string[]; error?: string }
        setNotice(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not delete the process.', 'Not deleted'))
        return
      }
      setRemoving(null)
      setNotice(saveNotice(true, 'Process deleted'))
      await onReload()
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not deleted'))
    } finally {
      setBusy(false)
    }
  }

  async function importFile(file: File) {
    setNotice(null)
    setBusy(true)
    try {
      const response = await fetch(`/api/orgs/${orgId}/processes-file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await file.text(),
      })
      const body = (await response.json()) as { errors?: { name: string; error: string }[] | string[]; notes?: string[]; imported?: { name: string; replaced?: boolean }[]; error?: string }
      if (!response.ok) {
        const errors = Array.isArray(body.errors) ? body.errors.map((item) => (typeof item === 'string' ? item : item.error)).join(' ') : body.error
        setNotice(saveNotice(false, errors || 'Could not import processes.', 'Not imported'))
        return
      }
      const notes = body.notes?.filter(Boolean) ?? []
      const skipped = (body.errors ?? []).map((item) => (typeof item === 'string' ? item : `Skipped ${item.name}: ${item.error}`)).join(' ')
      const summary = importSummary((body.imported ?? []).map((item) => ({ replaced: item.replaced === true })))
      setNotice(saveNotice(true, [summary, notes.join(' '), skipped].filter(Boolean).join(' ')))
      await onReload()
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    } finally {
      setBusy(false)
    }
  }

  // With no flows yet, the page explains itself and opens the import from Grok Bot; the boxes show what will go where.
  const empty = processes.length === 0
  const shows: { value: Show; label: string; count?: number }[] = [
    { value: 'all', label: 'All' },
    { value: 'routines', label: 'Routines', count: routineFlows.length },
    { value: 'handoffs', label: 'Handoffs', count: handoffFlows.length },
    { value: 'off', label: 'Routines without a flow', count: offChart.length },
    { value: 'idle', label: 'Bots without work', count: idleBots.length },
  ]
  const lane = (process: ProcessFile) => (
    <ProcessLane
      key={process.slug}
      process={process}
      processes={processes}
      live={laneRoutine(process, board)}
      allSeats={seats}
      seats={seatRefs}
      focusSeat={focusSeat}
      editable={editable}
      runLines={runLines}
      onSeat={onSeat}
      onDelete={() => setRemoving(process)}
    />
  )
  return (
    <div className="process-layout">
    <div className="process-board" data-testid="work-chart">
      <div className="process-head">
        <div>
          <div className="process-title">
            <h1>Work Chart</h1>
            {png && !empty ? <ChartPngButton chart="work" orgName={png.orgName} target={() => lanesRef.current} /> : null}
          </div>
          {empty ? null : <p className="process-fallback">Unmatched work uses {fallbackProcess}, owned by You.</p>}
          {editable && empty ? (
            <div className="process-intro">
              <p>The Work Chart shows the work your bots already do in Grok Bot: one flow for each routine or handoff, with its trigger (what starts it), each step in order, and who does it.</p>
              <ol>
                <li>Click <strong>Copy prompt</strong> below and paste it into Grok Bot.</li>
                <li>Grok Bot sends you a file named <code>botseverywhere-processes.json</code>. Save it.</li>
                <li>Click <strong>Import processes file</strong> and pick that file.</li>
              </ol>
            </div>
          ) : null}
        </div>
      </div>
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      <div className="process-show" role="group" aria-label="Show">
        {shows.map((item) => (
          <Button key={item.value} variant={show === item.value ? 'primary' : 'secondary'} type="button" aria-pressed={show === item.value} onClick={() => setShow(item.value)}>
            {item.label}{item.count === undefined ? null : <span className="process-show-count">{item.count}</span>}
          </Button>
        ))}
      </div>
      {focusSeat ? <p className="process-focus">Showing steps owned by {focusName}.</p> : null}
      <div className="process-segments" ref={lanesRef}>
        {show === 'all' || show === 'routines' ? (
          <section className="process-segment" aria-labelledby="segment-routines">
            <h2 id="segment-routines">Routines <span className="process-count">{routineFlows.length}</span></h2>
            <SegmentHint>{ROUTINES_HINT}</SegmentHint>
            {routineFlows.length ? <ul className="process-lanes">{routineFlows.map(lane)}</ul> : <p className="process-segment-empty">No routines on the Work Chart yet.</p>}
          </section>
        ) : null}
        {show === 'all' || show === 'handoffs' ? (
          <section className="process-segment" aria-labelledby="segment-handoffs">
            <h2 id="segment-handoffs">Handoffs <span className="process-count">{handoffFlows.length}</span></h2>
            <SegmentHint>{HANDOFFS_HINT}</SegmentHint>
            {handoffFlows.length ? <ul className="process-lanes">{handoffFlows.map(lane)}</ul> : <p className="process-segment-empty">No handoffs on the Work Chart yet.</p>}
          </section>
        ) : null}
        {show === 'all' || show === 'off' ? (
          <section className="process-segment" aria-labelledby="segment-off">
            <h2 id="segment-off">Routines without a flow <span className="process-count">{offChart.length}</span></h2>
            <SegmentHint>{OFF_CHART_HINT}</SegmentHint>
            {offChart.length ? (
              <ul className="process-off-list">
                {offChart.map((routine) => (
                  <li key={`${routine.bot}|${routine.name}`}>
                    <strong>{routine.name}</strong>
                    <span>{routine.bot} · Trigger: {routine.schedule}</span>
                    {routine.paused ? <span className="routine-state is-paused">Paused</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="process-segment-empty">None. Every routine your bots run has a flow.</p>}
          </section>
        ) : null}
        {show === 'all' || show === 'idle' ? (
          <section className="process-segment" aria-labelledby="segment-idle">
            <h2 id="segment-idle">Bots without work <span className="process-count">{idleBots.length}</span></h2>
            <SegmentHint>{[IDLE_HINT, idleWithRoutines(idleBots.map((seat) => seat.title), offChart)].filter(Boolean).join(' ')}</SegmentHint>
            {idleBots.length ? (
              <ul className="process-bot-list">
                {idleBots.map((seat) => <li key={seat.slug}>{seat.title}</li>)}
              </ul>
            ) : <p className="process-segment-empty">None. Every bot does a step in a flow.</p>}
          </section>
        ) : null}
      </div>
      {editable ? (
        <details className="link-panel" open={empty}>
          <summary>
            <span>Import processes from Grok Bot</span>
            <span className="grok-chevron" aria-hidden="true" />
          </summary>
          <div className="link-panel-body">
            <p>Paste this into Grok Bot. It asks for the routines and handoffs its bots already run.</p>
            <pre className="dir-prompt">{processesPrompt}</pre>
            <div className="dir-actions">
              <CopyPromptButton text={processesPrompt} onCopied={(message) => setNotice(saveNotice(true, message))} />
              <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Import processes file</Button>
            </div>
            <input ref={fileRef} className="be-file" type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void importFile(file)
            }} />
          </div>
        </details>
      ) : null}
      {removing ? (
        <div className="be-modal" role="dialog" aria-labelledby="delete-process-title">
          <h2 id="delete-process-title">Delete {removing.name}?</h2>
          <p>This removes the process file. Seats on the org chart stay.</p>
          <div className="be-modal-actions">
            <Button variant="secondary" type="button" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="primary" type="button" onClick={() => void remove(removing)} disabled={busy}>Delete</Button>
          </div>
        </div>
      ) : null}
    </div>
    <aside className="process-live" aria-label="Activity">
      <section aria-labelledby="approvals-title">
        <h2 id="approvals-title">Needs your approval</h2>
        {approvals.length ? (
          <ul>
            {approvals.map((line) => (
              <li key={`${line.date}-${line.index}`}>{activitySentence(line)}</li>
            ))}
          </ul>
        ) : <p>Nothing is waiting.</p>}
      </section>
      <section aria-labelledby="activity-title">
        <h2 id="activity-title">Activity</h2>
        {feed.length ? (
          <ul>
            {feed.map((line) => (
              <li key={`${line.date}-${line.index}`}>{activitySentence(line)}</li>
            ))}
          </ul>
        ) : <p>No runs yet.</p>}
      </section>
    </aside>
    </div>
  )
}

function ProcessLane({
  process,
  processes,
  live,
  allSeats,
  seats,
  focusSeat,
  editable,
  runLines,
  onSeat,
  onDelete,
}: {
  process: ProcessFile
  processes: ProcessFile[]
  /** The routine this flow runs in Grok Bot, when a bot reports it. */
  live: ReturnType<typeof laneRoutine>
  /** Every seat with its status, so a step whose seat is retired or gone shows as needing attention. */
  allSeats: SeatDocument[]
  seats: { slug: string; title: string; kind?: string; mustAskBefore?: string[] }[]
  focusSeat: string
  editable: boolean
  runLines: RunLine[]
  onSeat: (slug: string) => void
  onDelete: () => void
}) {
  const derived = deriveSteps(process.steps, seats)
  const paused = lanePaused(process, live)
  const noRoutine = laneNoRoutine(process, live)
  const problems = laneProblems(process, allSeats, runLines)
  const statuses = latestStepStatus(runLines, process.name, process.steps)
  return (
    <li className={paused ? 'process-lane is-paused' : 'process-lane'} id={`process-${process.slug}`}>
      <div className="process-lane-main">
        <div className="process-trigger">
          <h2>{process.name}</h2>
          <span className="process-kicker">Trigger</span>
          <span className="process-chip">
            <TriggerIcon type={process.trigger.type} />
            {process.trigger.type === 'schedule' ? scheduleWords(process.trigger.schedule, live?.routine.timeZone) : triggerLabel(process.trigger)}
          </span>
          <div className="process-badges">
            {paused === null ? null : <span className={paused ? 'routine-state is-paused' : 'routine-state is-active'}>{paused ? 'Paused' : 'Active'}</span>}
            {problems.length ? <span className="routine-state is-problem">Needs attention</span> : null}
          </div>
          {live ? <p>{laneWhen(live)}</p> : null}
          {noRoutine ? <p>{noRoutine}</p> : null}
          {process.trigger.description ? <p>{process.trigger.description}</p> : null}
          {problems.length ? <ul className="process-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
        </div>
        <ol className="process-steps">
          {derived.map((step, index) => {
            const previous = derived[index - 1]
            const handoff = previous && previous.seat !== step.seat
            const seat = seats.find((item) => item.slug === step.seat)
            const dim = Boolean(focusSeat) && step.seat !== focusSeat
            const hit = Boolean(focusSeat) && step.seat === focusSeat
            const status = statuses.get(step.action.trim().toLowerCase())
            const previousStatus = previous ? statuses.get(previous.action.trim().toLowerCase()) : undefined
            const flowing = Boolean(handoff && previousStatus?.status === 'done' && status?.status === 'running')
            const liveClass = status ? ` is-${status.status}` : ''
            return (
              <li key={`${step.seat}-${index}`} className="process-step-wrap">
                {index > 0 ? (
                  <span className={flowing ? 'process-arrow is-handoff is-flowing' : handoff ? 'process-arrow is-handoff' : 'process-arrow'} aria-hidden="true">
                    {flowing ? <i className="process-flow" /> : null}
                    →
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`${hit ? 'process-step is-hit' : dim ? 'process-step is-dim' : 'process-step'}${liveClass}`}
                  onClick={() => step.seat && onSeat(step.seat)}
                >
                  <strong>{seat?.title || step.seat || 'Unassigned'}</strong>
                  <span>{stepText(step.action)}</span>
                  {status?.status === 'done' ? <em className="process-check is-done"><CheckMark /> Done</em> : null}
                  {status?.status === 'failed' ? <em className="process-check is-failed">Failed</em> : null}
                  {status?.status === 'running' ? <em className="process-live-label">Running</em> : null}
                  {status?.status === 'skipped' ? <em className="process-live-label">Skipped</em> : null}
                  {status?.status === 'waiting' || (!status && waitsForYou(step)) ? <em className="process-check">Needs your approval</em> : null}
                </button>
              </li>
            )
          })}
          <li className="process-step-wrap">
            <span className="process-arrow" aria-hidden="true">→</span>
            <div className="process-done">
              <span className="process-kicker">Done when</span>
              <p>{process.doneWhen || 'Not set'}</p>
            </div>
          </li>
          {process.next ? (
            <li className="process-step-wrap">
              <span className="process-arrow is-handoff" aria-hidden="true">→</span>
              <button
                type="button"
                className="process-next"
                onClick={() => {
                  const target = processes.find((item) => item.name === process.next || item.slug === processSlug(process.next))
                  document.getElementById(`process-${target?.slug || processSlug(process.next)}`)?.scrollIntoView({ block: 'nearest', inline: 'start' })
                }}
              >
                {process.next}
              </button>
            </li>
          ) : null}
        </ol>
      </div>
      {editable ? (
        <div className="process-lane-tools">
          <Button variant="secondary" type="button" onClick={onDelete}>Delete</Button>
        </div>
      ) : null}
    </li>
  )
}

function CheckMark() {
  return (
    <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** What a Work Chart box holds, after an (i). */
function SegmentHint({ children }: { children: string }) {
  return <p className="process-segment-hint"><InfoIcon /><span>{children}</span></p>
}

function InfoIcon() {
  return (
    <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.25V11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
    </svg>
  )
}

function TriggerIcon({ type }: { type: TriggerType }) {
  if (type === 'schedule') {
    return (
      <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5.5V8l2 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (type === 'event') {
    return (
      <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M9 1.5 4 9h4l-1 5.5L12 7H8l1-5.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    )
  }
  // Manual: a raised hand, someone hands the work on.
  return (
    <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.75 4.5v6c0 2.1 1.55 3.75 3.5 3.75s3.25-1.65 3.25-3.75v-5M7 7.5V3M9.25 7.5V3.5M4.75 10 3 8.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
