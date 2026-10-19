import { useEffect, useMemo, useRef, useState } from 'react'
import { OrgChart } from '../components/OrgChart'
import { SeatDrawer } from '../components/SeatDrawer'
import { WorkChart } from '../components/WorkChart'
import { companyFromBundle } from '../org/company'
import { canEditFiles } from '../mode'
import { Button } from '../components/Button'
import {
  SEAT_SLUG,
  bundleFromState,
  serializeSeat,
  type OrgBundle,
  type OrgPerson,
  type SeatDocument,
  type WorkDocument,
} from '../../server/src/org-files.ts'

export function TemplateOrg({
  bundle,
  mode,
  seatId = '',
  editable = canEditFiles,
  onMode,
}: {
  bundle: OrgBundle
  mode: 'org' | 'work'
  seatId?: string
  editable?: boolean
  onMode?: (mode: 'org' | 'work') => void
}) {
  const [org, setOrg] = useState(bundle.org)
  const [seats, setSeats] = useState(bundle.seats)
  const [work, setWork] = useState(bundle.work)
  const [selected, setSelected] = useState(seatId)
  const [tab, setTab] = useState<'card' | 'performance' | 'profile'>('card')
  const [openLane, setOpenLane] = useState(bundle.work.workstreams.find((stream) => stream.kind === 'main')?.id ?? '')
  const [message, setMessage] = useState('')
  const [savedFiles, setSavedFiles] = useState<string[]>([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [writer, setWriter] = useState<'unknown' | 'up' | 'down'>(editable ? 'unknown' : 'down')
  const [howOpen, setHowOpen] = useState(() => {
    try {
      return localStorage.getItem(HOW_KEY) !== '1'
    } catch {
      return true
    }
  })
  const allowLeave = useRef(false)
  const live = useMemo(() => bundleFromState(bundle.id, org, seats, work), [bundle.id, org, seats, work])
  const [savedFp, setSavedFp] = useState(() => fingerprint(bundleFromState(bundle.id, bundle.org, bundle.seats, bundle.work)))
  const changes = useMemo(() => (fingerprint(live) === savedFp ? 0 : countChanges(savedFp, live)), [live, savedFp])
  const company = useMemo(() => companyFromBundle(live), [live])
  const byId = useMemo(() => new Map(company.seats.map((seat) => [seat.id, seat])), [company])
  const activeSeats = company.seats.filter((seat) => seat.status !== 'retired')
  const selectedSeat = seats.find((seat) => seat.slug === selected) ?? null
  const chartSeat = selected ? byId.get(selected) ?? null : null

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    fetch('/api/template')
      .then((response) => {
        if (!cancelled) setWriter(response.ok ? 'up' : 'down')
      })
      .catch(() => {
        if (!cancelled) setWriter('down')
      })
    return () => {
      cancelled = true
    }
  }, [editable])

  useEffect(() => {
    if (!editable || changes === 0) return
    const stays = (href: string) => {
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : ''
      const path = hash.split('?')[0]
      return path === 'org' || path === 'work' || path === 'seat' || path.startsWith('seat-')
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowLeave.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      if (stays(href)) return
      if (allowLeave.current) return
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      allowLeave.current = true
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [editable, changes])

  async function save(next = live) {
    setError('')
    setMessage('')
    setSavedFiles([])
    if (!editable) return
    const healthy = await writerHealthy()
    if (!healthy) {
      setWriter('down')
      setError(SAVING_OFF)
      return
    }
    setWriter('up')
    const departments = [...next.org.departments]
    for (const seat of next.seats) {
      if (!seat.department || departments.some((item) => item.id === seat.department)) continue
      departments.push({ id: seat.department, name: seat.department })
    }
    const payload = { ...next, org: { ...next.org, departments } }
    setOrg(payload.org)
    let response: Response
    try {
      response = await fetch('/api/template', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      setWriter('down')
      setError(SAVING_OFF)
      return
    }
    let result: { errors?: string[]; error?: string; files?: string[]; savedAt?: string }
    try {
      result = (await response.json()) as { errors?: string[]; error?: string; files?: string[]; savedAt?: string }
    } catch {
      setWriter('down')
      setError(SAVING_OFF)
      return
    }
    if (!response.ok) {
      if (response.status >= 500) {
        setWriter('down')
        setError(SAVING_OFF)
        return
      }
      setError(result.errors?.join(' ') || result.error || 'Could not save the files.')
      return
    }
    const files = result.files?.length ? result.files : expectedFiles(payload)
    const when = result.savedAt ? new Date(result.savedAt).toLocaleString() : new Date().toLocaleString()
    setSavedFiles(files)
    setSavedFp(fingerprint(payload))
    setMessage(`Saved at ${when}.`)
  }

  function patchSeat(slug: string, patch: Partial<SeatDocument>) {
    setSeats((current) =>
      current.map((seat) => {
        if (seat.slug !== slug) return seat
        const next = { ...seat, ...patch }
        next.source = serializeSeat(next)
        return next
      }),
    )
  }

  function patchPerson(id: string, patch: Partial<OrgPerson>) {
    setOrg((current) => ({
      ...current,
      people: current.people.map((person) => (person.id === id ? { ...person, ...patch } : person)),
    }))
  }

  const founderOnly = editable && mode === 'org' && activeSeats.length === 1 && activeSeats[0]?.type === 'human'
  const showHow = editable && bundle.id === 'org' && howOpen
  return (
    <div className="layout preview-shell">
      <main id="main" className="team-main">
        {showHow ? (
          <section className="card how-card" aria-labelledby="how-this-works">
            <div className="how-card-head">
              <h2 id="how-this-works">How this works</h2>
              <Button variant="secondary"
                type="button"
                
                onClick={() => {
                  setHowOpen(false)
                  try {
                    localStorage.setItem(HOW_KEY, '1')
                  } catch {
                    /* private mode */
                  }
                }}
              >
                Dismiss
              </Button>
            </div>
            <p>
              Your organization lives in files in this project folder (org/). Edit the chart, click Save files, done.
              Optional: commit org/ with git to keep history and back it up. Nothing is uploaded anywhere.
            </p>
            <ol>
              <li>Add seats</li>
              <li>Save files</li>
              <li>Commit (optional)</li>
            </ol>
          </section>
        ) : null}
        {editable && writer === 'down' ? (
          <p className="save-off" role="status">
            {SAVING_OFF}
          </p>
        ) : null}
        <div className="bar preview-bar">
          <div>
            <div className="sample-title-row">
              <span className="org-mark" aria-hidden="true">
                {company.org.mark}
              </span>
              <h1>{company.org.name}</h1>
              {editable ? <span className="sample-chip">Saved on your computer</span> : <span className="sample-chip">Read only</span>}
            </div>
            <p>
              {company.org.industry}
              {company.org.tagline ? ` · ${company.org.tagline}` : ''}
            </p>
            <p className="canvas-note">
              {editable
                ? 'Click Save files when you are ready. Nothing is uploaded.'
                : 'This is a sample. Open Your org to edit your own organization.'}
            </p>
          </div>
          <div className="r preview-actions">
            <div className="toggle" role="tablist" aria-label="Org or work">
              {(['org', 'work'] as const).map((view) => (
                <button key={view} type="button" role="tab" className={mode === view ? 'active' : undefined} aria-selected={mode === view} onClick={() => onMode?.(view)}>
                  {view === 'org' ? 'Org' : 'Work'}
                </button>
              ))}
            </div>
            {editable ? (
              <Button variant="secondary" type="button"  onClick={() => setAdding(true)}>
                + Add seat
              </Button>
            ) : null}
            {editable ? (
              <Button variant="primary" type="button"  disabled={writer !== 'up'} onClick={() => void save()}>
                {changes > 0 ? `Save files • ${changes} ${changes === 1 ? 'change' : 'changes'}` : 'Save files'}
              </Button>
            ) : null}
          </div>
        </div>
        {message ? (
          <div className="save-banner" role="status">
            <p>{message}</p>
            <ul>
              {savedFiles.map((file) => (
                <li key={file}>
                  <code>{file}</code>
                </li>
              ))}
            </ul>
            <p>
              <code>git add org && git commit -m "Update org"</code>
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="save-off" role="alert">
            {error}
          </p>
        ) : null}
        <div className={mode === 'org' ? 'card canvas canvas-org' : 'card canvas'} role="tabpanel">
          {mode === 'org' ? (
            <OrgChart seats={activeSeats} selectedId={selected} onSelect={setSelected} />
          ) : (
            <>
              <WorkChart
                company={company}
                steps={company.steps}
                byId={byId}
                openLane={openLane}
                showException={false}
                pulse=""
                fading=""
                allowHire={false}
                onOpenLane={setOpenLane}
                onException={() => undefined}
                onSeat={setSelected}
              />
              {editable ? <WorkEditor work={work} seats={seats} onChange={setWork} /> : null}
            </>
          )}
          {founderOnly ? (
            <div className="first-seat">
              <h2>Add your first seat</h2>
              <p>Add a person or a bot who reports to you.</p>
              <Button variant="primary" type="button"  onClick={() => setAdding(true)}>
                + Add your first seat
              </Button>
            </div>
          ) : null}
          {seats.some((seat) => seat.status === 'retired') ? (
            <p className="auth-note">
              Retired:{' '}
              {seats.filter((seat) => seat.status === 'retired').map((seat) => seat.title).join(', ')}
            </p>
          ) : null}
        </div>
      </main>
      {chartSeat && selectedSeat ? (
        <SeatDrawer
          seat={chartSeat}
          reportsTo={chartSeat.reportsTo ? byId.get(chartSeat.reportsTo)?.name : undefined}
          tab={tab}
          least={false}
          fading={false}
          sample={false}
          allowRetire={false}
          onTab={setTab}
          onClose={() => setSelected('')}
          onGrokUrl={editable ? (url) => patchSeat(selectedSeat.slug, { addToGrokBotUrl: url }) : undefined}
        >
          {editable ? (
            <SeatEditor
              seat={selectedSeat}
              seats={seats}
              people={org.people}
              departments={org.departments}
              onSeat={(patch) => patchSeat(selectedSeat.slug, patch)}
              onPerson={(patch) => selectedSeat.personId && patchPerson(selectedSeat.personId, patch)}
              onRetire={() => patchSeat(selectedSeat.slug, { status: selectedSeat.status === 'retired' ? 'active' : 'retired' })}
              onAttach={() => {
                const id = `person-${selectedSeat.slug}`
                setOrg((current) => ({
                  ...current,
                  people: current.people.some((person) => person.id === id)
                    ? current.people
                    : [...current.people, { id, name: selectedSeat.title, title: selectedSeat.role, department: selectedSeat.department, email: '', phone: '', location: '', bio: '' }],
                }))
                patchSeat(selectedSeat.slug, { personId: id })
              }}
            />
          ) : null}
        </SeatDrawer>
      ) : null}
      {adding ? (
        <AddSeat
          taken={seats.map((seat) => seat.slug)}
          seats={seats.filter((seat) => seat.status !== 'retired')}
          onClose={() => setAdding(false)}
          onAdd={(seat) => {
            setSeats((current) => [...current, seat])
            setOrg((current) => ({
              ...current,
              departments: current.departments.some((item) => item.id === seat.department)
                ? current.departments
                : [...current.departments, { id: seat.department, name: seat.department }],
            }))
            setSelected(seat.slug)
            setAdding(false)
          }}
        />
      ) : null}
    </div>
  )
}

function SeatEditor({
  seat,
  seats,
  people,
  departments,
  onSeat,
  onPerson,
  onRetire,
  onAttach,
}: {
  seat: SeatDocument
  seats: SeatDocument[]
  people: OrgPerson[]
  departments: { id: string; name: string }[]
  onSeat: (patch: Partial<SeatDocument>) => void
  onPerson: (patch: Partial<OrgPerson>) => void
  onRetire: () => void
  onAttach: () => void
}) {
  const person = people.find((item) => item.id === seat.personId)
  const options = seats.filter((item) => item.slug !== seat.slug && !isDescendant(seats, seat.slug, item.slug))
  return (
    <div className="seat-editor">
      <section className="editor-group">
        <h3>The seat</h3>
        <label className="field-label">Name<input className="text-input" value={seat.title} onChange={(event) => onSeat({ title: event.target.value })} /></label>
        <label className="field-label">Job<input className="text-input" value={seat.role} onChange={(event) => onSeat({ role: event.target.value })} /></label>
        <label className="field-label">
          Person or bot
          <select className="text-input" value={seat.kind} onChange={(event) => onSeat({ kind: event.target.value as SeatDocument['kind'] })}>
            <option value="human">Human</option>
            <option value="bot">Bot</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="field-label">
          Department
          <input className="text-input" list="org-departments" value={seat.department} onChange={(event) => onSeat({ department: event.target.value })} />
          <datalist id="org-departments">
            {departments.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </datalist>
        </label>
        <label className="field-label">
          Reports to
          <select className="text-input" value={seat.reportsTo} onChange={(event) => onSeat({ reportsTo: event.target.value })}>
            <option value="">Top of the chart</option>
            {options.map((item) => (
              <option key={item.slug} value={item.slug}>{item.title}</option>
            ))}
          </select>
        </label>
      </section>
      <section className="editor-group">
        <h3>The work</h3>
        <CardArea label="Owns" value={seat.owns.join('\n')} onChange={(owns) => onSeat({ owns })} />
        <CardArea label="May" value={seat.may.join('\n')} onChange={(may) => onSeat({ may })} />
        <CardArea label="Needs approval" value={seat.mustAskBefore.join('\n')} onChange={(mustAskBefore) => onSeat({ mustAskBefore })} />
        <p className="field-help">What this seat has to check with a person before it acts.</p>
        <CardArea label="Done when" value={seat.doneWhen.join('\n')} onChange={(doneWhen) => onSeat({ doneWhen })} />
        <p className="field-help">How you can tell this seat is finished.</p>
      </section>
      {person ? (
        <section className="editor-group">
          <h3>The person</h3>
          <label className="field-label">Name<input className="text-input" value={person.name} onChange={(event) => onPerson({ name: event.target.value })} /></label>
          <label className="field-label">Title<input className="text-input" value={person.title ?? ''} onChange={(event) => onPerson({ title: event.target.value })} /></label>
          <label className="field-label">Email<input className="text-input" value={person.email ?? ''} onChange={(event) => onPerson({ email: event.target.value })} /></label>
          <label className="field-label">Phone<input className="text-input" value={person.phone ?? ''} onChange={(event) => onPerson({ phone: event.target.value })} /></label>
          <label className="field-label">Location<input className="text-input" value={person.location ?? ''} onChange={(event) => onPerson({ location: event.target.value })} /></label>
          <label className="field-label">About<textarea className="text-input" value={person.bio ?? ''} onChange={(event) => onPerson({ bio: event.target.value })} /></label>
        </section>
      ) : (
        <Button variant="secondary" type="button"  onClick={onAttach}>Add person profile</Button>
      )}
      <Button variant="primary" type="button"  onClick={onRetire}>{seat.status === 'retired' ? 'Restore' : 'Retire'}</Button>
    </div>
  )
}

function CardArea({ label, value, onChange }: { label: string; value: string; onChange: (lines: string[]) => void }) {
  return (
    <label className="field-label">
      {label}
      <textarea className="text-input" value={value} onChange={(event) => onChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean))} />
    </label>
  )
}

function AddSeat({ taken, seats, onClose, onAdd }: { taken: string[]; seats: SeatDocument[]; onClose: () => void; onAdd: (seat: SeatDocument) => void }) {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<SeatDocument['kind']>('bot')
  const [reportsTo, setReportsTo] = useState(seats.find((seat) => seat.slug === 'you')?.slug ?? '')
  const [error, setError] = useState('')
  return (
    <div className="modal-backdrop open" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-file-seat">
        <h2 id="add-file-seat">Add a seat</h2>
        {error ? <p className="form-error">{error}</p> : null}
        <label className="field-label">Short name<input className="text-input" value={slug} onChange={(event) => setSlug(event.target.value.trim().toLowerCase())} /></label>
        <p className="field-help">Lowercase, like research. This becomes the file name.</p>
        <label className="field-label">Title<input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field-label">
          Kind
          <select className="text-input" value={kind} onChange={(event) => setKind(event.target.value as SeatDocument['kind'])}>
            <option value="human">Human</option>
            <option value="bot">Bot</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="field-label">
          Reports to
          <select className="text-input" value={reportsTo} onChange={(event) => setReportsTo(event.target.value)}>
            <option value="">Top of the chart</option>
            {seats.map((seat) => (
              <option key={seat.slug} value={seat.slug}>{seat.title}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" type="button"  onClick={onClose}>Cancel</Button>
          <Button variant="primary"
            type="button"
            
            onClick={() => {
              if (!SEAT_SLUG.test(slug)) {
                setError('Use a lowercase slug, like research or site-bot.')
                return
              }
              if (taken.includes(slug)) {
                setError('That slug is already a seat.')
                return
              }
              if (!title.trim()) {
                setError('Title is required.')
                return
              }
              const draft = {
                slug,
                title: title.trim(),
                department: 'general',
                reportsTo,
                addToGrokBotUrl: '',
                hiredAt: '',
                retiredAt: '',
                directoryId: '',
                status: 'active' as const,
                kind,
                role: title.trim(),
                personId: '',
                owns: [`${title.trim()} owns this seat.`],
                may: ['Do the work described on the card.'],
                mustAskBefore: ['Anything that leaves the team.'],
                doneWhen: ['The card is filled in and committed.'],
              }
              onAdd({ ...draft, source: serializeSeat(draft) })
            }}
          >
            Add seat
          </Button>
        </div>
      </div>
    </div>
  )
}

function WorkEditor({ work, seats, onChange }: { work: WorkDocument; seats: SeatDocument[]; onChange: (work: WorkDocument) => void }) {
  const stream = work.workstreams.find((item) => item.kind === 'main') ?? work.workstreams[0]
  if (!stream) return null
  const steps = stream.stepIds.map((id) => work.steps.find((step) => step.id === id)).filter((step) => step != null)
  return (
    <section className="card work-file-editor">
      <h2>Work file</h2>
      <label className="field-label">
        Outcome
        <input className="text-input" value={stream.outcome} onChange={(event) => onChange({ ...work, workstreams: work.workstreams.map((item) => item.id === stream.id ? { ...item, outcome: event.target.value } : item) })} />
      </label>
      {steps.map((step) => (
        <div key={step.id} className="work-file-step">
          <input className="text-input" value={step.name} aria-label={`Step ${step.name}`} onChange={(event) => onChange({ ...work, steps: work.steps.map((item) => item.id === step.id ? { ...item, name: event.target.value } : item) })} />
          <select className="text-input" aria-label={`Executor for ${step.name}`} value={step.executorSeatId} onChange={(event) => onChange({ ...work, steps: work.steps.map((item) => item.id === step.id ? { ...item, executorSeatId: event.target.value } : item) })}>
            {seats.filter((seat) => seat.status !== 'retired').map((seat) => (
              <option key={seat.slug} value={seat.slug}>{seat.title}</option>
            ))}
          </select>
        </div>
      ))}
      <Button variant="secondary"
        type="button"
        
        onClick={() => {
          const id = `step-${Date.now()}`
          onChange({
            ...work,
            steps: [...work.steps, { id, workstreamId: stream.id, name: 'New step', level: 2, executorSeatId: seats[0]?.slug ?? '', inputs: [], outputs: [] }],
            workstreams: work.workstreams.map((item) => item.id === stream.id ? { ...item, stepIds: [...item.stepIds, id] } : item),
          })
        }}
      >
        Add step
      </Button>
    </section>
  )
}

const HOW_KEY = 'be-how-org-dismissed'
const SAVING_OFF = 'Saving is off. Restart npm run dev, then click Save files.'

async function writerHealthy(): Promise<boolean> {
  try {
    const response = await fetch('/api/template')
    if (!response.ok) return false
    const text = await response.text()
    return text.trimStart().startsWith('{')
  } catch {
    return false
  }
}

function fingerprint(bundle: OrgBundle): string {
  return JSON.stringify({
    org: bundle.org,
    seats: bundle.seats.map((seat) => ({ slug: seat.slug, source: seat.source })).sort((a, b) => a.slug.localeCompare(b.slug)),
    work: bundle.work,
  })
}

function countChanges(saved: string, next: OrgBundle): number {
  const base = JSON.parse(saved) as { org: OrgBundle['org']; seats: { slug: string; source: string }[]; work: WorkDocument }
  let count = 0
  if (JSON.stringify(base.org) !== JSON.stringify(next.org)) count += 1
  if (JSON.stringify(base.work) !== JSON.stringify(next.work)) count += 1
  const before = new Map(base.seats.map((seat) => [seat.slug, seat.source]))
  const after = new Map(next.seats.map((seat) => [seat.slug, seat.source]))
  for (const [slug, source] of after) if (before.get(slug) !== source) count += 1
  for (const slug of before.keys()) if (!after.has(slug)) count += 1
  return count
}

function expectedFiles(bundle: OrgBundle): string[] {
  return ['org/org.md', ...bundle.seats.map((seat) => `org/seats/${seat.slug}.md`).sort(), 'org/work-chart.md', 'org/log/']
}

function isDescendant(seats: SeatDocument[], ancestor: string, candidate: string): boolean {
  let cursor = seats.find((seat) => seat.slug === candidate)?.reportsTo ?? ''
  const seen = new Set<string>()
  while (cursor) {
    if (cursor === ancestor) return true
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = seats.find((seat) => seat.slug === cursor)?.reportsTo ?? ''
  }
  return false
}
