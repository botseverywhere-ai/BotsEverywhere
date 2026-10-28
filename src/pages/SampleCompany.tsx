import { useEffect, useMemo, useState } from 'react'
import { OrgChart } from '../components/OrgChart'
import { SeatDrawer } from '../components/SeatDrawer'
import { WorkChart } from '../components/WorkChart'
import { findCompany } from '../data/mock-company-index'
import type { CompanySeed, LogEvent, SampleChart, Seat, Step } from '../data/mock-companies'
import { formatLogTime } from '../preview/format-time'
import { missingCardFields } from '../preview/hire'
import { commitHire, commitRestore, commitRetire, EMPTY_SESSION, stepsNow, type SessionState } from '../preview/staffing'
import { Button } from '../components/Button'

const VIEWS: { id: SampleChart; label: string }[] = [
  { id: 'org', label: 'Org' },
  { id: 'work', label: 'Work' },
  { id: 'performance', label: 'Performance' },
  { id: 'history', label: 'History' },
]

const EMPTY = EMPTY_SESSION
const EMPTY_EVENTS: LogEvent[] = []

function setHash(next: string) {
  const hash = next.startsWith('#') ? next : `#${next}`
  if (window.location.hash !== hash) window.location.hash = hash
}

function seatFromLocation(): string {
  const raw = window.location.hash
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : ''
  return new URLSearchParams(query).get('seat') ?? ''
}

export function SampleCompany({ slug, chart }: { slug: string; chart: SampleChart }) {
  const company = findCompany(slug)
  if (!company) {
    return (
      <main id="main" className="app-main">
        <div className="card auth-card">
          <h1>Organization not found</h1>
          <p className="auth-lead">That organization is not in this preview.</p>
          <Button variant="secondary"  href="#home">
            All organizations
          </Button>
        </div>
      </main>
    )
  }
  const view = chart === 'activity' ? 'history' : chart
  return <Workspace key={company.org.id} company={company} chart={view} />
}

function Workspace({ company, chart }: { company: CompanySeed; chart: SampleChart }) {
  const [session, setSession] = useState<SessionState>(EMPTY)
  const [selected, setSelected] = useState(seatFromLocation)
  const [drawerTab, setDrawerTab] = useState<'card' | 'performance' | 'profile'>('card')
  const [hireStep, setHireStep] = useState<string | null>(null)
  const [retireId, setRetireId] = useState<string | null>(null)
  const [fading, setFading] = useState('')
  const [pulse, setPulse] = useState('')
  const [present, setPresent] = useState(false)
  const [openLane, setOpenLane] = useState(company.workstreams.find((stream) => stream.kind === 'main')?.id ?? '')
  const [showException, setShowException] = useState(false)
  const [sort, setSort] = useState<{ key: 'usage' | 'tasks' | 'last' | 'name'; dir: 'asc' | 'desc' }>({ key: 'usage', dir: 'asc' })
  const [filters, setFilters] = useState({ seat: 'all', type: 'all', status: 'all' })
  const [demoOn, setDemoOn] = useState(false)

  const seats = useMemo(() => seatsNow(company, session), [company, session])
  const demoEvents = company.demoActivity?.events ?? EMPTY_EVENTS
  const showDemo = demoOn && Boolean(company.demoActivity)
  const displaySeats = useMemo(
    () => (showDemo ? overlayStats(seats, demoEvents) : seats),
    [showDemo, seats, demoEvents],
  )
  const byId = useMemo(() => new Map(displaySeats.map((seat) => [seat.id, seat])), [displaySeats])
  const steps = useMemo(() => stepsNow(company, session), [company, session])
  const log = useMemo(() => {
    const source = showDemo ? demoEvents : (company.log ?? [])
    const rows = [...session.extraLog, ...source]
    return rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  }, [company, session.extraLog, showDemo, demoEvents])
  const least = leastUsed(displaySeats)
  const active = selected ? byId.get(selected) ?? null : null
  useEffect(() => {
    document.body.classList.toggle('be-present', present)
    return () => document.body.classList.remove('be-present')
  }, [present])
  const visibleTree = displaySeats.filter((seat) => !isRetired(seat, session))
  const retired = displaySeats.filter((seat) => isRetired(seat, session))

  function go(next: SampleChart) {
    setHash(`sample/${company.org.id}?view=${next}`)
  }

  function openSeat(id: string, tab: 'card' | 'performance' | 'profile' = 'card') {
    setSelected(id)
    setDrawerTab(tab)
    const view = chart === 'activity' ? 'history' : chart
    setHash(`sample/${company.org.id}?view=${view}&seat=${id}`)
  }

  function pulseStep(stepId: string) {
    setPulse(stepId)
    setOpenLane(steps.find((step) => step.id === stepId)?.workstreamId ?? openLane)
    if (chart !== 'work') go('work')
    window.setTimeout(() => {
      document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }, 40)
    window.setTimeout(() => setPulse((current) => (current === stepId ? '' : current)), 2000)
  }

  function hire(input: HireInput) {
    const id = `${company.org.id}-hired-${session.hired.length + 1}`
    const now = new Date().toISOString()
    const seat: Seat = {
      id,
      orgId: company.org.id,
      name: input.name.trim(),
      role: input.role.trim(),
      type: 'bot',
      reportsTo: input.reportsTo || undefined,
      prompt: input.owns.trim(),
      grokShareUrl: null,
      curated: true,
      status: 'active',
      hiredAt: now,
      retiredAt: null,
      card: {
        owns: [input.owns.trim()],
        may: [input.may.trim()],
        mustAskBefore: [input.mustAskBefore.trim()],
        doneWhen: [input.doneWhen.trim()],
      },
      profile: {
        department: input.role.trim(),
        location: company.org.address ?? '',
        email: '',
        phone: '',
        startedOn: now.slice(0, 10),
        bio: `${input.name.trim()} was hired in this session. A reload restores the original chart.`,
      },
      stats: { usageCount30d: 0, tasksDone30d: 0, lastActiveAt: '' },
    }
    setSession((current) => commitHire(company, current, seat, input.steps, sessionActorId(company), now))
    setHireStep(null)
    openSeat(id, 'card')
  }

  function retire(seat: Seat, reason: string) {
    const now = new Date().toISOString()
    setFading(seat.id)
    window.setTimeout(() => {
      setSession((current) => commitRetire(company, current, seat, reason, sessionActorId(company), now))
      setFading('')
      setRetireId(null)
      if (selected === seat.id) setSelected('')
    }, 300)
  }

  function restore(seat: Seat) {
    setSession((current) => commitRestore(company, current, seat))
  }

  return (
    <div className={present ? 'layout preview-shell present-on' : 'layout preview-shell'}>
      <main id="main" className="team-main">
        <div className="bar preview-bar">
          <div>
            <div className="sample-title-row">
              <span className="org-mark" aria-hidden="true">
                {company.org.mark}
              </span>
              <h1>{company.org.name}</h1>
              {company.org.ownerOrg ? <span className="sample-chip">Owner&apos;s org</span> : <span className="sample-chip">Sample team · {company.org.name}</span>}
            </div>
            <p>
              {company.org.industry}
              {company.org.tagline ? ` · ${company.org.tagline}` : ''}
            </p>
            <p className="canvas-note">Org chart = who owns capability. Work chart = how work moves.</p>
            {company.org.ownerOrg ? (
              <p className="auth-note">
                Goals stay on the owner link from <code>npm run seed:org</code>.{' '}
                <a href="#organization">Create an organization</a> if this machine does not have one yet.
              </p>
            ) : null}
          </div>
          <div className="r preview-actions">
            <div className="toggle" role="tablist" aria-label="Org or work">
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  className={chart === view.id ? 'active' : undefined}
                  aria-selected={chart === view.id}
                  onClick={() => go(view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
            {company.demoActivity ? (
              <label className="demo-activity-toggle">
                <input
                  type="checkbox"
                  checked={demoOn}
                  onChange={(event) => setDemoOn(event.target.checked)}
                />
                Demo activity (sample)
              </label>
            ) : null}
            <Button variant="secondary" type="button"  onClick={() => setPresent((value) => !value)}>
              {present ? 'Exit present' : 'Present'}
            </Button>
            <Button variant="secondary" type="button"  onClick={() => setSession(EMPTY)}>
              Reset demo
            </Button>
            <Button variant="secondary"  href="#home">
              All orgs
            </Button>
          </div>
        </div>

        {company.org.goals ? <GoalsStrip goals={company.org.goals} /> : null}

        <div className={chart === 'org' ? 'card canvas canvas-org' : 'card canvas'} role="tabpanel">
          {chart === 'org' ? (
            <>
              <p className="work-summary">
                <b>Authority.</b> Who is accountable. Bots are marked. This is not the path the work takes.
              </p>
              <OrgChart seats={visibleTree} selectedId={selected} leastUsedId={least?.id} sampleUsage={showDemo} onSelect={(id) => openSeat(id)} />
              <RetiredGroup seats={retired} onOpen={openSeat} onRestore={restore} />
            </>
          ) : null}
          {chart === 'work' ? (
            <WorkChart
              company={company}
              steps={steps}
              byId={byId}
              openLane={openLane}
              showException={showException}
              pulse={pulse}
              fading={fading}
              leastId={least?.id}
              onOpenLane={setOpenLane}
              onException={() => {
                setShowException(true)
                const extra = company.workstreams.find((stream) => stream.kind === 'contingency')
                if (extra) setOpenLane(extra.id)
              }}
              onSeat={(id) => openSeat(id)}
              onHire={setHireStep}
            />
          ) : null}
          {chart === 'performance' ? (
            <PerformanceTable
              seats={displaySeats}
              session={session}
              sort={sort}
              leastId={least?.id}
              demo={showDemo}
              ownerOrg={Boolean(company.org.ownerOrg)}
              onSort={setSort}
              onOpen={(id) => openSeat(id, 'performance')}
              onRetire={setRetireId}
            />
          ) : null}
          {chart === 'history' ? (
            <HistoryLog
              company={company}
              log={log}
              byId={byId}
              filters={filters}
              demo={showDemo}
              ownerOrg={Boolean(company.org.ownerOrg)}
              onFilters={setFilters}
              onStep={pulseStep}
              onSeat={openSeat}
            />
          ) : null}
        </div>
      </main>

      {active ? (
        <SeatDrawer
          seat={active}
          reportsTo={active.reportsTo ? byId.get(active.reportsTo)?.name : undefined}
          tab={drawerTab}
          least={least?.id === active.id}
          fading={fading === active.id}
          sample={showDemo}
          onTab={setDrawerTab}
          onClose={() => setSelected('')}
          onRetire={() => setRetireId(active.id)}
        />
      ) : null}

      {hireStep !== null ? (
        <HireDrawer
          company={company}
          seats={seats.filter((seat) => !isRetired(seat, session))}
          steps={steps}
          initialStep={hireStep}
          onClose={() => setHireStep(null)}
          onHire={hire}
        />
      ) : null}

      {retireId && byId.get(retireId)?.type === 'bot' ? (
        <RetireDialog seat={byId.get(retireId) as Seat} onCancel={() => setRetireId(null)} onConfirm={(reason) => retire(byId.get(retireId) as Seat, reason)} />
      ) : null}
    </div>
  )
}

function GoalsStrip({ goals }: { goals: NonNullable<CompanySeed['org']['goals']> }) {
  const done = goals.milestones.filter((item) => item.done).length
  return (
    <section className="card goals-strip" aria-label="Organization goals">
      <p>
        <b>{goals.title}</b> · due {goals.dueOn} · {done} of {goals.milestones.length} milestones
      </p>
      <ul>
        {goals.milestones.map((item) => (
          <li key={item.title}>{item.done ? 'Done' : 'Open'} · {item.title}</li>
        ))}
      </ul>
    </section>
  )
}

function PerformanceTable({
  seats,
  session,
  sort,
  leastId,
  demo,
  ownerOrg,
  onSort,
  onOpen,
  onRetire,
}: {
  seats: Seat[]
  session: SessionState
  sort: { key: 'usage' | 'tasks' | 'last' | 'name'; dir: 'asc' | 'desc' }
  leastId?: string
  demo: boolean
  ownerOrg: boolean
  onSort: (next: { key: 'usage' | 'tasks' | 'last' | 'name'; dir: 'asc' | 'desc' }) => void
  onOpen: (id: string) => void
  onRetire: (id: string) => void
}) {
  const active = seats
    .filter((seat) => seat.type === 'bot' && !isRetired(seat, session))
    .slice()
    .sort((a, b) => compareSeats(a, b, sort))
  const retired = seats
    .filter((seat) => seat.type === 'bot' && isRetired(seat, session))
    .slice()
    .sort((a, b) => compareSeats(a, b, sort))
  function header(key: 'usage' | 'tasks' | 'last' | 'name', label: string) {
    const dir = sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc'
    return (
      <Button variant="secondary" type="button" onClick={() => onSort({ key, dir: sort.key === key ? dir : key === 'name' ? 'asc' : 'asc' })}>
        {label}
      </Button>
    )
  }
  const caption = demo
    ? 'Demo activity (sample). Not the project log.'
    : ownerOrg
      ? 'Usage, tasks, and last active come from recorded project activity.'
      : 'Active bots, least-used first. Numbers are the seed, plus anyone hired in this session.'
  return (
    <div data-testid="performance-table">
      <p className="work-summary">{caption}</p>
      <table className="tracker">
        <thead>
          <tr>
            <th>{header('name', 'Bot')}</th>
            <th>{header('usage', 'Usage (30d)')}</th>
            <th>{header('tasks', 'Tasks done (30d)')}</th>
            <th>{header('last', 'Last active')}</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {active.map((seat) => (
            <tr key={seat.id} className={seat.id === leastId ? 'least-row' : undefined}>
              <td>
                <button type="button" className="text-button" onClick={() => onOpen(seat.id)}>
                  {seat.name}
                </button>
                <span className="reports"> {seat.role}</span>
                {seat.id === leastId ? <span className="least-tag">Least used</span> : null}
              </td>
              <td>{seat.stats?.usageCount30d ?? 0}</td>
              <td>{seat.stats?.tasksDone30d ?? 0}</td>
              <td>{seat.stats?.lastActiveAt ? formatLogTime(seat.stats.lastActiveAt) : '—'}</td>
              <td>Active</td>
              <td>
                <Button variant="secondary" type="button"  onClick={() => onRetire(seat.id)}>
                  Retire
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="retired-performance" data-testid="retired-performance">
        <h2>Retired ({retired.length})</h2>
        {retired.length ? (
          <table className="tracker">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Usage (30d)</th>
                <th>Tasks done (30d)</th>
                <th>Last active</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {retired.map((seat) => (
                <tr key={seat.id}>
                  <td>
                    <button type="button" className="text-button" onClick={() => onOpen(seat.id)}>
                      {seat.name}
                    </button>
                    <span className="reports"> {seat.role}</span>
                  </td>
                  <td>{seat.stats?.usageCount30d ?? 0}</td>
                  <td>{seat.stats?.tasksDone30d ?? 0}</td>
                  <td>{seat.stats?.lastActiveAt ? formatLogTime(seat.stats.lastActiveAt) : '—'}</td>
                  <td>Retired</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="auth-note">No retired bots.</p>
        )}
      </section>
    </div>
  )
}

function HistoryLog({
  company,
  log,
  byId,
  filters,
  demo,
  ownerOrg,
  onFilters,
  onStep,
  onSeat,
}: {
  company: CompanySeed
  log: LogEvent[]
  byId: Map<string, Seat>
  filters: { seat: string; type: string; status: string }
  demo: boolean
  ownerOrg: boolean
  onFilters: (next: { seat: string; type: string; status: string }) => void
  onStep: (stepId: string) => void
  onSeat: (id: string) => void
}) {
  const rows = log.filter((event) => {
    if (filters.seat !== 'all' && event.actorSeatId !== filters.seat) return false
    if (filters.type !== 'all' && event.type !== filters.type) return false
    if (filters.status !== 'all' && (event.status ?? '') !== filters.status) return false
    return true
  })
  const actors = [...new Set(log.map((event) => event.actorSeatId))]
  return (
    <div data-testid="history-log">
      {demo ? <p className="work-summary">Demo activity (sample). Not the project log.</p> : null}
      {ownerOrg && !demo ? <p className="work-summary">Recorded project activity. Hire and fire have not happened.</p> : null}
      <div className="log-filters">
        <label>
          Seat
          <select value={filters.seat} onChange={(event) => onFilters({ ...filters, seat: event.target.value })}>
            <option value="all">All seats</option>
            {actors.map((id) => (
              <option key={id} value={id}>{byId.get(id)?.name ?? id}</option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={filters.type} onChange={(event) => onFilters({ ...filters, type: event.target.value })}>
            <option value="all">All types</option>
            {['work', 'approval', 'exception', 'hire', 'fire'].map((type) => (
              <option key={type} value={type}>{type === 'fire' ? 'retire' : type}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(event) => onFilters({ ...filters, status: event.target.value })}>
            <option value="all">All statuses</option>
            {[...new Set(log.map((event) => event.status).filter(Boolean))].map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      <ol className="history-list">
        {rows.map((event) => {
          const actor = byId.get(event.actorSeatId)
          const step = company.steps.find((item) => item.id === event.stepId)
          return (
            <li
              key={event.id}
              className={step ? 'history-row history-row-link' : 'history-row'}
              onClick={step ? () => onStep(step.id) : undefined}
            >
              <time dateTime={event.timestamp}>{formatLogTime(event.timestamp)}</time>
              <button
                type="button"
                className="text-button"
                onClick={(click) => {
                  click.stopPropagation()
                  if (actor) onSeat(actor.id)
                }}
              >
                {actor?.name ?? 'Unknown'}
              </button>
              <span className={`type-mark type-${event.actorType}`}>{event.actorType}</span>
              <span className="history-verb">{event.type === 'fire' ? 'retire' : event.type}</span>
              <span className="history-summary">{event.summary}</span>
              {step ? (
                <button type="button" className="step-chip" onClick={() => onStep(step.id)}>
                  {step.name}
                </button>
              ) : null}
              <span className={`status-dot status-${event.status ?? 'done'}`} title={event.status ?? 'done'} />
            </li>
          )
        })}
      </ol>
      {rows.length === 0 ? <p className="auth-note">No rows for that filter.</p> : null}
    </div>
  )
}

interface HireInput {
  name: string
  role: string
  reportsTo: string
  steps: string[]
  owns: string
  may: string
  mustAskBefore: string
  doneWhen: string
}

function HireDrawer({
  company,
  seats,
  steps,
  initialStep,
  onClose,
  onHire,
}: {
  company: CompanySeed
  seats: Seat[]
  steps: Step[]
  initialStep: string
  onClose: () => void
  onHire: (input: HireInput) => void
}) {
  const [form, setForm] = useState<HireInput>({
    name: '',
    role: '',
    reportsTo: seats.find((seat) => seat.type === 'human' && !seat.reportsTo)?.id ?? '',
    steps: initialStep ? [initialStep] : [],
    owns: '',
    may: '',
    mustAskBefore: '',
    doneWhen: '',
  })
  const [blocked, setBlocked] = useState('')
  const missing = [
    ...(!form.name.trim() ? ['Name'] : []),
    ...(!form.role.trim() ? ['Role'] : []),
    ...missingCardFields(form),
  ]
  const cardMissing = missingCardFields(form)
  const filled = 4 - cardMissing.length
  const taken = steps.filter((step) => form.steps.includes(step.id) && step.staffing !== 'unstaffed')
  function set<K extends keyof HireInput>(key: K, value: HireInput[K]) {
    setBlocked('')
    setForm((current) => ({ ...current, [key]: value }))
  }
  function submit() {
    if (taken.length) {
      const names = taken.map((step) => {
        const who = seats.find((seat) => seat.id === step.executorSeatId)?.name ?? 'someone'
        return `${step.name} (${who})`
      })
      setBlocked(`${names.join(', ')} already has an executor. Pick a step with no one assigned.`)
      return
    }
    onHire(form)
  }
  return (
    <div className="hire-drawer" role="dialog" aria-labelledby="hire-title" data-testid="hire-drawer">
      <div className="drawer-head">
        <h2 id="hire-title">Hire bot</h2>
        <Button variant="secondary" type="button"  onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="canvas-note">{filled} of 4 filled</p>
      {missing.length ? <p className="hire-missing">Still needed: {missing.join(', ')}.</p> : <p className="hire-ready">Card complete. This hire stays in memory until reload.</p>}
      {blocked ? <p className="hire-missing" role="alert">{blocked}</p> : null}
      <label className="field-label">Name<input className="text-input" value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
      <label className="field-label">Role<input className="text-input" value={form.role} onChange={(event) => set('role', event.target.value)} /></label>
      <label className="field-label">
        Reports to
        <select className="text-input" value={form.reportsTo} onChange={(event) => set('reportsTo', event.target.value)}>
          <option value="">Select a seat</option>
          {seats.map((seat) => (
            <option key={seat.id} value={seat.id}>{seat.name} · {seat.role}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Steps to staff</legend>
        {steps.map((step) => {
          const staffed = step.staffing !== 'unstaffed'
          const who = seats.find((seat) => seat.id === step.executorSeatId)?.name
          return (
            <label key={step.id} className={staffed ? 'check-line is-staffed' : 'check-line'}>
              <input
                type="checkbox"
                checked={!staffed && form.steps.includes(step.id)}
                disabled={staffed}
                onChange={(event) => {
                  if (staffed) return
                  set('steps', event.target.checked ? [...form.steps, step.id] : form.steps.filter((id) => id !== step.id))
                }}
              />
              {step.name}
              {staffed ? <span className="reports"> Already staffed by {who ?? 'someone'}</span> : null}
            </label>
          )
        })}
      </fieldset>
      <CardField label="Owns" value={form.owns} onChange={(value) => set('owns', value)} />
      <CardField label="May" value={form.may} onChange={(value) => set('may', value)} />
      <CardField label="Needs approval" value={form.mustAskBefore} onChange={(value) => set('mustAskBefore', value)} />
      <CardField label="Done when" value={form.doneWhen} onChange={(value) => set('doneWhen', value)} />
      <Button variant="primary"
        type="button"
        
        data-testid="hire-submit"
        disabled={missing.length > 0}
        title={missing[0] ? `Add ${missing[0]}` : taken.length ? 'That step already has an executor' : 'Hire'}
        onClick={submit}
      >
        Hire
      </Button>
      <p className="auth-note">Nothing is written to the server. Reload restores {company.org.name}.</p>
    </div>
  )
}

function CardField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const empty = !value.trim()
  return (
    <label className={empty ? 'field-label needed-field' : 'field-label'}>
      {label} {empty ? <span className="needed-tag">Needed</span> : null}
      <textarea className="text-input" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function RetireDialog({ seat, onCancel, onConfirm }: { seat: Seat; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-back" role="presentation">
      <div className="card retire-dialog" role="dialog" aria-labelledby="retire-title" data-testid="retire-dialog">
        <h2 id="retire-title">Retire {seat.name}?</h2>
        <p>Its open steps move to Unstaffed.</p>
        <p className="reports">
          Usage {seat.stats?.usageCount30d ?? 0} · tasks {seat.stats?.tasksDone30d ?? 0} · last active {seat.stats?.lastActiveAt ? formatLogTime(seat.stats.lastActiveAt) : '—'}
        </p>
        <label className="field-label">
          Reason, optional
          <input className="text-input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="r">
          <Button variant="secondary" type="button"  onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="button"  data-testid="retire-confirm" onClick={() => onConfirm(reason)}>Retire</Button>
        </div>
      </div>
    </div>
  )
}

function RetiredGroup({ seats, onOpen, onRestore }: { seats: Seat[]; onOpen: (id: string) => void; onRestore: (seat: Seat) => void }) {
  const [open, setOpen] = useState(false)
  if (!seats.length) return null
  return (
    <section className="retired-group">
      <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Retired ({seats.length})
      </button>
      {open ? (
        <ul>
          {seats.map((seat) => (
            <li key={seat.id}>
              <button type="button" className="text-button" onClick={() => onOpen(seat.id)}>{seat.name}</button>
              <span className="reports"> {seat.role}</span>
              <Button variant="secondary" type="button"  onClick={() => onRestore(seat)}>Restore</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function seatsNow(company: CompanySeed, session: SessionState): Seat[] {
  return [...company.seats, ...session.hired].map((seat) => {
    if (session.retiredAt[seat.id]) return { ...seat, status: 'retired' as const, retiredAt: session.retiredAt[seat.id] }
    if (session.restored.includes(seat.id)) return { ...seat, status: 'active' as const, retiredAt: null }
    return seat
  })
}

function sessionActorId(company: CompanySeed): string {
  const top = company.seats.find((seat) => seat.type === 'human' && !seat.reportsTo)
  return top?.id ?? company.seats.find((seat) => seat.type === 'human')?.id ?? company.org.id
}

function overlayStats(seats: Seat[], events: LogEvent[]): Seat[] {
  return seats.map((seat) => {
    if (seat.type !== 'bot') return seat
    const mine = events.filter((event) => event.actorSeatId === seat.id)
    const latest = mine.map((event) => event.timestamp).sort().at(-1) ?? ''
    return {
      ...seat,
      stats: {
        usageCount30d: mine.length,
        tasksDone30d: mine.filter((event) => event.type === 'work').length,
        lastActiveAt: latest,
      },
    }
  })
}

function isRetired(seat: Seat, session: SessionState): boolean {
  if (session.retiredAt[seat.id]) return true
  if (session.restored.includes(seat.id)) return false
  return seat.status === 'retired'
}

function leastUsed(seats: Seat[]): Seat | undefined {
  const bots = seats.filter((seat) => seat.type === 'bot' && seat.status !== 'retired')
  if (!bots.length) return undefined
  const min = Math.min(...bots.map((seat) => seat.stats?.usageCount30d ?? 0))
  const tied = bots.filter((seat) => (seat.stats?.usageCount30d ?? 0) === min)
  return tied.length === 1 ? tied[0] : undefined
}

function compareSeats(a: Seat, b: Seat, sort: { key: 'usage' | 'tasks' | 'last' | 'name'; dir: 'asc' | 'desc' }): number {
  const dir = sort.dir === 'asc' ? 1 : -1
  if (sort.key === 'name') return a.name.localeCompare(b.name) * dir
  if (sort.key === 'usage') return ((a.stats?.usageCount30d ?? 0) - (b.stats?.usageCount30d ?? 0)) * dir
  if (sort.key === 'tasks') return ((a.stats?.tasksDone30d ?? 0) - (b.stats?.tasksDone30d ?? 0)) * dir
  return (a.stats?.lastActiveAt ?? '').localeCompare(b.stats?.lastActiveAt ?? '') * dir
}
