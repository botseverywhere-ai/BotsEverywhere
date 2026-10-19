import { useMemo, useState, type ReactNode } from 'react'
import { OrgChart } from '../components/OrgChart'
import { SeatDrawer } from '../components/SeatDrawer'
import { WorkChart } from '../components/WorkChart'
import type { CompanySeed } from '../data/mock-companies'
import { SEED_COMPANY } from '../data/seed-company'

export function SeedCharts({ mode, seatId }: { mode: 'org' | 'work'; seatId?: string }) {
  return (
    <ChartBoard
      key={seatId ?? mode}
      company={SEED_COMPANY}
      mode={mode}
      seatId={seatId}
      onMode={(next) => {
        window.location.hash = next
      }}
    />
  )
}

export function ChartBoard({
  company,
  mode,
  seatId = '',
  onMode,
  embedded = false,
}: {
  company: CompanySeed
  mode: 'org' | 'work'
  seatId?: string
  onMode?: (mode: 'org' | 'work') => void
  embedded?: boolean
}) {
  const [selected, setSelected] = useState(seatId)
  const [tab, setTab] = useState<'card' | 'performance' | 'profile'>('card')
  const [openLane, setOpenLane] = useState(company.workstreams.find((stream) => stream.kind === 'main')?.id ?? '')
  const [showException, setShowException] = useState(false)
  const byId = useMemo(() => new Map(company.seats.map((seat) => [seat.id, seat])), [company])
  const active = selected ? byId.get(selected) ?? null : null

  const body = (
    <>
      <div className="bar preview-bar">
        <div>
          <div className="sample-title-row">
            <span className="org-mark" aria-hidden="true">
              {company.org.mark}
            </span>
            <h1>{company.org.name}</h1>
          </div>
          <p>
            {company.org.industry}
            {company.org.tagline ? ` · ${company.org.tagline}` : ''}
          </p>
          <p className="canvas-note">Org chart = who owns capability. Work chart = how work moves.</p>
        </div>
        <div className="r preview-actions">
          <div className="toggle" role="tablist" aria-label="Org or work">
            {(['org', 'work'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                className={mode === view ? 'active' : undefined}
                aria-selected={mode === view}
                onClick={() => onMode?.(view)}
              >
                {view === 'org' ? 'Org' : 'Work'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={mode === 'org' ? 'card canvas canvas-org' : 'card canvas'} role="tabpanel">
        {mode === 'org' ? (
          <>
            <p className="work-summary">
              <b>Authority.</b> Who is accountable. Bots are marked. This is not the path the work takes.
            </p>
            <OrgChart seats={company.seats} selectedId={selected} onSelect={setSelected} />
          </>
        ) : (
          <WorkChart
            company={company}
            steps={company.steps}
            byId={byId}
            openLane={openLane}
            showException={showException}
            pulse=""
            fading=""
            allowHire={false}
            onOpenLane={setOpenLane}
            onException={() => setShowException(true)}
            onSeat={setSelected}
          />
        )}
      </div>
    </>
  )

  return (
    <div className="layout preview-shell">
      <ChartMain embedded={embedded}>{body}</ChartMain>
      {active ? (
        <SeatDrawer
          seat={active}
          reportsTo={active.reportsTo ? byId.get(active.reportsTo)?.name : undefined}
          tab={tab}
          least={false}
          fading={false}
          sample={false}
          allowRetire={false}
          onTab={setTab}
          onClose={() => setSelected('')}
        />
      ) : null}
    </div>
  )
}

function ChartMain({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  if (embedded) return <div className="team-main">{children}</div>
  return (
    <main id="main" className="team-main">
      {children}
    </main>
  )
}
