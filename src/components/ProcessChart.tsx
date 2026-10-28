import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import {
  EVENT_SOURCES,
  grokProcessesPrompt,
  deriveSteps,
  processSlug,
  routinePrompt,
  stepText,
  triggerLabel,
  waitsForYou,
  type EventSource,
  type ProcessFile,
  type ProcessStep,
  type TriggerType,
} from '../../server/src/processes.ts'
import { activitySentence, latestStepStatus, newestFirst, waitingLines, type RunLine } from '../../server/src/run-log.ts'
import { CopyPromptButton } from '../directory/prompt-actions'
import { FOLDER_EVENT, orgFolder } from '../org/folder-path'
import { Button } from './Button'
import { ChartPngButton } from './ChartPngButton'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import type { RoutineBoard } from '../../server/src/routine-board-types.ts'
import { laneProblems, lanePaused, laneRoutine, laneWhen, routinesOffChart, scheduleWords } from './routine-board-copy'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

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
  const lanesRef = useRef<HTMLUListElement>(null)
  const [drawer, setDrawer] = useState<ProcessFile | 'new' | null>(null)
  const [removing, setRemoving] = useState<ProcessFile | null>(null)
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [folder, setFolder] = useState(() => orgFolder(orgId))
  useEffect(() => {
    const onFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string; value?: string }>).detail
      if (detail?.slug === orgId && typeof detail.value === 'string') setFolder(detail.value)
    }
    window.addEventListener(FOLDER_EVENT, onFolder)
    return () => window.removeEventListener(FOLDER_EVENT, onFolder)
  }, [orgId])
  const approvals = useMemo(() => waitingLines(runLines, processes), [processes, runLines])
  const feed = useMemo(() => newestFirst(runLines), [runLines])
  const offChart = useMemo(() => routinesOffChart(board, processes), [board, processes])
  const seatRefs = useMemo(() => seats.map((seat) => ({ slug: seat.slug, title: seat.title, kind: seat.kind, mustAskBefore: seat.mustAskBefore })), [seats])
  const processesPrompt = useMemo(() => grokProcessesPrompt(seats.filter((seat) => seat.kind === 'bot' && seat.status !== 'retired').map((seat) => seat.title)), [seats])
  const used = useMemo(() => new Set(processes.flatMap((process) => process.steps.map((step) => step.seat))), [processes])
  const idle = seats.filter((seat) => seat.status !== 'retired' && !used.has(seat.slug))
  const focusName = seats.find((seat) => seat.slug === focusSeat)?.title || focusSeat

  async function save(draft: Draft) {
    const name = draft.name.trim()
    if (!name) {
      setNotice(saveNotice(false, 'Process name is required.', 'Not saved'))
      return
    }
    const base = processSlug(name)
    if (!base) {
      setNotice(saveNotice(false, 'That name is not a safe file name.', 'Not saved'))
      return
    }
    const taken = new Set(processes.map((process) => process.slug).filter((slug) => slug !== draft.previousSlug))
    let slug = base
    if (taken.has(slug)) {
      for (let n = 2; n < 100 && taken.has(slug); n += 1) slug = `${base}-${n}`
    }
    setBusy(true)
    try {
      const response = await fetch(`/api/orgs/${orgId}/processes/${slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: draft.previousSlug,
          name,
          trigger: {
            type: draft.type,
            schedule: draft.type === 'schedule' ? draft.schedule.trim() : '',
            source: draft.type === 'event' ? draft.source : '',
            description: draft.description.trim(),
          },
          steps: draft.steps.filter((step) => step.seat || step.action.trim()),
          doneWhen: draft.doneWhen.trim(),
          next: draft.next.trim(),
          notes: draft.notes,
        }),
      })
      const body = (await response.json()) as { errors?: string[]; error?: string }
      if (!response.ok) {
        setNotice(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not save the process.', 'Not saved'))
        return
      }
      setDrawer(null)
      setNotice(saveNotice(true, 'Process saved'))
      await onReload()
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not saved'))
    } finally {
      setBusy(false)
    }
  }

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
      const body = (await response.json()) as { errors?: { name: string; error: string }[] | string[]; notes?: string[]; imported?: { name: string }[]; error?: string }
      if (!response.ok) {
        const errors = Array.isArray(body.errors) ? body.errors.map((item) => (typeof item === 'string' ? item : item.error)).join(' ') : body.error
        setNotice(saveNotice(false, errors || 'Could not import processes.', 'Not imported'))
        return
      }
      const count = body.imported?.length ?? 0
      const notes = body.notes?.filter(Boolean) ?? []
      const skipped = (body.errors ?? []).map((item) => (typeof item === 'string' ? item : `Skipped ${item.name}: ${item.error}`)).join(' ')
      const summary = notes.length ? `${count} processes imported, ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : `Imported ${count} processes`
      setNotice(saveNotice(true, [summary, notes.join(' '), skipped].filter(Boolean).join(' ')))
      await onReload()
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    } finally {
      setBusy(false)
    }
  }

  async function simulate(slug: string) {
    setNotice(null)
    try {
      const response = await fetch(`/api/orgs/${orgId}/processes/${slug}/simulate`, { method: 'POST' })
      if (!response.ok) {
        const body = (await response.json()) as { errors?: string[]; error?: string }
        setNotice(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not start the run.', 'Not started'))
        return
      }
      setNotice(saveNotice(true, 'Run started'))
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not started'))
    }
  }

  // With no flows yet, the page is only the import from Grok Bot: the rest has nothing to show.
  const empty = processes.length === 0
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
        </div>
        {editable && !empty ? <Button variant="primary" type="button" onClick={() => setDrawer('new')}>+ New process</Button> : null}
      </div>
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      {empty && !editable ? <p className="be-empty">No processes yet. A process is one trigger, the steps, and when the work is done.</p> : null}
      {offChart.length && !empty ? <p className="process-off-chart">{offChart.length} {offChart.length === 1 ? "routine in Grok Bot isn't" : "routines in Grok Bot aren't"} on the Work Chart yet: {offChart.join('; ')}. Import processes from Grok Bot below to add them as flows.</p> : null}
      {focusSeat ? <p className="process-focus">Showing steps owned by {focusName}.</p> : null}
      <ul className="process-lanes" ref={lanesRef}>
        {processes.map((process) => (
          <ProcessLane
            key={process.slug}
            process={process}
            processes={processes}
            live={laneRoutine(process, board)}
            allSeats={seats}
            seats={seatRefs}
            focusSeat={focusSeat}
            editable={editable}
            folder={folder}
            runLines={runLines}
            onSeat={onSeat}
            onEdit={() => setDrawer(process)}
            onDelete={() => setRemoving(process)}
            onSimulate={() => void simulate(process.slug)}
            onCopied={(message) => setNotice(saveNotice(true, message))}
          />
        ))}
      </ul>
      {empty ? null : (
        <section className="process-idle" aria-labelledby="no-work-yet">
          <h2 id="no-work-yet">No work yet</h2>
          {idle.length ? (
            <ul>
              {idle.map((seat) => <li key={seat.slug}>{seat.title}</li>)}
            </ul>
          ) : <p>Every seat owns a step.</p>}
        </section>
      )}
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
      {drawer ? (
        <ProcessDrawer
          key={drawer === 'new' ? 'new' : drawer.slug}
          process={drawer === 'new' ? null : drawer}
          processes={processes}
          seats={seats}
          busy={busy}
          onClose={() => setDrawer(null)}
          onSave={(draft) => void save(draft)}
        />
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
  folder,
  runLines,
  onSeat,
  onEdit,
  onDelete,
  onSimulate,
  onCopied,
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
  folder: string
  runLines: RunLine[]
  onSeat: (slug: string) => void
  onEdit: () => void
  onDelete: () => void
  onSimulate: () => void
  onCopied: (message: string) => void
}) {
  const [owner, setOwner] = useState(process.steps[0]?.seat || '')
  const derived = deriveSteps(process.steps, seats)
  const paused = lanePaused(process, live)
  const problems = laneProblems(process, allSeats, runLines)
  const prompt = routinePrompt(process, seats, owner, folder)
  const statuses = latestStepStatus(runLines, process.name, process.steps)
  return (
    <li className={paused ? 'process-lane is-paused' : 'process-lane'} id={`process-${process.slug}`}>
      <div className="process-lane-main">
        <div className="process-trigger">
          <h2>{process.name}</h2>
          <span className="process-chip">
            <TriggerIcon type={process.trigger.type} />
            {process.trigger.type === 'schedule' ? scheduleWords(process.trigger.schedule, live?.routine.timeZone) : triggerLabel(process.trigger)}
          </span>
          <div className="process-badges">
            {paused === null ? null : <span className={paused ? 'routine-state is-paused' : 'routine-state is-active'}>{paused ? 'Paused' : 'Active'}</span>}
            {problems.length ? <span className="routine-state is-problem">Needs attention</span> : null}
          </div>
          {live ? <p>{laneWhen(live)}</p> : null}
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
      <div className="process-lane-tools">
        <label className="field-label">
          Copy for
          <select className="text-input" value={owner} onChange={(event) => setOwner(event.target.value)}>
            {seats.map((seat) => (
              <option key={seat.slug} value={seat.slug}>{seat.title}</option>
            ))}
          </select>
        </label>
        <CopyPromptButton text={prompt} label="Copy for Grok Bot" onCopied={onCopied} />
        {editable ? (
          <div className="process-edit">
            <Button variant="secondary" type="button" onClick={onSimulate}>Simulate a run</Button>
            <Button variant="secondary" type="button" onClick={onEdit}>Edit</Button>
            <Button variant="secondary" type="button" onClick={onDelete}>Delete</Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}

interface Draft {
  previousSlug: string
  name: string
  type: TriggerType
  schedule: string
  source: EventSource | ''
  description: string
  steps: ProcessStep[]
  doneWhen: string
  next: string
  notes: string
}

function ProcessDrawer({
  process,
  processes,
  seats,
  busy,
  onClose,
  onSave,
}: {
  process: ProcessFile | null
  processes: ProcessFile[]
  seats: SeatDocument[]
  busy: boolean
  onClose: () => void
  onSave: (draft: Draft) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => process ? {
    previousSlug: process.slug,
    name: process.name,
    type: process.trigger.type,
    schedule: process.trigger.schedule,
    source: process.trigger.source,
    description: process.trigger.description,
    steps: process.steps.length ? process.steps : [{ seat: seats[0]?.slug || '', action: '' }],
    doneWhen: process.doneWhen,
    next: process.next,
    notes: process.notes,
  } : {
    previousSlug: '',
    name: '',
    type: 'manual',
    schedule: '',
    source: '',
    description: '',
    steps: [{ seat: seats.find((seat) => seat.kind === 'bot')?.slug || seats[0]?.slug || '', action: '' }],
    doneWhen: '',
    next: '',
    notes: '',
  })

  function move(index: number, delta: number) {
    const next = index + delta
    if (next < 0 || next >= draft.steps.length) return
    const steps = [...draft.steps]
    const [item] = steps.splice(index, 1)
    steps.splice(next, 0, item!)
    setDraft({ ...draft, steps })
  }

  return (
    <div className="be-drawer" role="dialog" aria-labelledby="process-drawer-title">
      <header>
        <h2 id="process-drawer-title">{process ? 'Edit process' : 'New process'}</h2>
        <Button variant="secondary" type="button" onClick={onClose} aria-label="Close">Close</Button>
      </header>
      <label className="field-label">Name
        <input className="text-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label className="field-label">Trigger
        <select className="text-input" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as TriggerType })}>
          <option value="schedule">Schedule</option>
          <option value="event">Event</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      {draft.type === 'schedule' ? (
        <label className="field-label">When
          <input className="text-input" value={draft.schedule} placeholder="Mon 09:00" onChange={(event) => setDraft({ ...draft, schedule: event.target.value })} />
        </label>
      ) : null}
      {draft.type === 'event' ? (
        <label className="field-label">Source
          <select className="text-input" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value as EventSource | '' })}>
            <option value="">Choose a source</option>
            {EVENT_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
      ) : null}
      <label className="field-label">Description
        <input className="text-input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <div className="process-step-editor">
        <p className="field-label">Steps</p>
        {draft.steps.map((step, index) => (
          <div key={index} className="process-step-row">
            <select className="text-input" value={step.seat} aria-label={`Seat for step ${index + 1}`} onChange={(event) => {
              const steps = draft.steps.map((item, itemIndex) => itemIndex === index ? { ...item, seat: event.target.value } : item)
              setDraft({ ...draft, steps })
            }}>
              <option value="">Choose a seat</option>
              {seats.filter((seat) => seat.status !== 'retired').map((seat) => <option key={seat.slug} value={seat.slug}>{seat.title}</option>)}
            </select>
            <input className="text-input" value={step.action} aria-label={`Action for step ${index + 1}`} placeholder="What this seat does" onChange={(event) => {
              const steps = draft.steps.map((item, itemIndex) => itemIndex === index ? { ...item, action: event.target.value } : item)
              setDraft({ ...draft, steps })
            }} />
            <div className="process-order">
              <Button variant="secondary" type="button" aria-label={`Move step ${index + 1} up`} onClick={() => move(index, -1)}>Up</Button>
              <Button variant="secondary" type="button" aria-label={`Move step ${index + 1} down`} onClick={() => move(index, 1)}>Down</Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" type="button" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { seat: '', action: '' }] })}>Add step</Button>
      </div>
      <label className="field-label">Done when
        <textarea className="text-input" rows={3} value={draft.doneWhen} onChange={(event) => setDraft({ ...draft, doneWhen: event.target.value })} />
      </label>
      <label className="field-label">Next process
        <select className="text-input" value={draft.next} onChange={(event) => setDraft({ ...draft, next: event.target.value })}>
          <option value="">None</option>
          {processes.filter((item) => item.slug !== process?.slug).map((item) => <option key={item.slug} value={item.name}>{item.name}</option>)}
        </select>
      </label>
      <label className="field-label">Notes
        <textarea className="text-input" rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
      </label>
      <Button variant="primary" type="button" onClick={() => onSave(draft)} disabled={busy}>Save</Button>
    </div>
  )
}

function CheckMark() {
  return (
    <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  return (
    <svg className="process-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 7.5V4.2a1.2 1.2 0 0 1 2.4 0V8l1.7-1a1.1 1.1 0 0 1 1.5.4 1.1 1.1 0 0 1-.3 1.5L8.8 11.2a3 3 0 0 1-1.6.4H6.2A2.2 2.2 0 0 1 4 9.4V8.2a1.2 1.2 0 0 1 2.4 0v.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
