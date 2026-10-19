import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError, api, type IssuedLinks, type Role, type SeatRecord, type WorkChart as ApiWorkChart } from '../api'
import { OrgChart } from '../components/OrgChart'
import { SeatDrawer } from '../components/SeatDrawer'
import { ShareLinks } from '../components/ShareLinks'
import { WorkChart } from '../components/WorkChart'
import { catalogBots } from '../generated/bots'
import { companyFromTeam } from '../data/live-company'
import { ChartToggle } from '../components/ChartToggle'
import { useSession } from '../sessionContext'
import { Button } from '../components/Button'

const emptySeat = { name: '', role: '', humanOwner: '', botSlug: '' }

export function LiveTeam({
  mode,
  teamId,
  linkAccess = null,
  onChart,
  freshLinks = null,
  onDismissLinks,
  onRegenerated,
}: {
  mode: 'org' | 'work'
  teamId?: string
  linkAccess?: 'edit' | 'view' | null
  onChart?: (mode: 'org' | 'work') => void
  freshLinks?: IssuedLinks | null
  onDismissLinks?: () => void
  onRegenerated?: (links: IssuedLinks) => void
}) {
  const { activeTeamId, chooseTeam } = useSession()
  const id = teamId || activeTeamId
  const [teamName, setTeamName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [seats, setSeats] = useState<SeatRecord[]>([])
  const [work, setWork] = useState<ApiWorkChart | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [tab, setTab] = useState<'card' | 'performance' | 'profile'>('card')
  const [openLane, setOpenLane] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const canEdit = linkAccess === 'edit' || (linkAccess !== 'view' && (role === 'owner' || role === 'editor'))

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<{ team: { name: string; role: Role | null } }>(`/api/teams/${id}`),
      api<{ seats: SeatRecord[] }>(`/api/teams/${id}/seats`),
      api<ApiWorkChart>(`/api/teams/${id}/work`),
    ])
      .then(([team, seatData, chart]) => {
        if (cancelled) return
        setTeamName(team.team.name)
        setDraftName(team.team.name)
        setRole(team.team.role)
        setSeats(seatData.seats)
        setWork(chart)
        setOpenLane(chart.workstreams[0]?.id ?? '')
        setSelected((current) => current || seatData.seats[0]?.id || '')
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load this team.')
        if (!teamId && err instanceof ApiError && err.status === 404) chooseTeam('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, teamId, chooseTeam])

  async function reload() {
    const [seatData, chart] = await Promise.all([
      api<{ seats: SeatRecord[] }>(`/api/teams/${id}/seats`),
      api<ApiWorkChart>(`/api/teams/${id}/work`),
    ])
    setSeats(seatData.seats)
    setWork(chart)
  }

  async function rename(event: FormEvent) {
    event.preventDefault()
    try {
      await api(`/api/teams/${id}`, { method: 'PATCH', body: { name: draftName } })
      setTeamName(draftName)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename the team.')
    }
  }

  async function regenerate() {
    try {
      const data = await api<{ links: IssuedLinks }>(`/api/teams/${id}/links`, { method: 'POST', body: {} })
      setConfirmRegen(false)
      onRegenerated?.(data.links)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate the links.')
    }
  }

  const company = useMemo(() => companyFromTeam(id, teamName, seats, work), [id, teamName, seats, work])
  const byId = useMemo(() => new Map(company.seats.map((seat) => [seat.id, seat])), [company])
  const current = byId.get(selected) ?? null
  const record = seats.find((seat) => seat.id === selected) ?? null

  return (
    <div className="layout">
      <main id="main" className="team-main">
        <div className="bar">
          <div>
            <h1>{teamName || 'Your team'}</h1>
            <p>
              {linkAccess === 'edit' ? 'Edit link. ' : linkAccess === 'view' ? 'View-only link. ' : role ? `You are ${role}. ` : ''}
              This team is not listed publicly.
            </p>
          </div>
          <div className="r">
            <ChartToggle mode={mode} onSelect={onChart} />
            {canEdit ? (
              <Button variant="secondary" type="button"  onClick={() => setAdding(true)}>
                + Add seat
              </Button>
            ) : null}
            {linkAccess === 'edit' ? (
              <Button variant="secondary" type="button"  onClick={() => setConfirmRegen(true)}>
                Regenerate links
              </Button>
            ) : null}
          </div>
        </div>
        {freshLinks ? <ShareLinks links={freshLinks} onDismiss={onDismissLinks} /> : null}
        {linkAccess === 'edit' ? (
          <form onSubmit={rename} className="inline-form rename-row">
            <label className="field-label" htmlFor="share-team-name">
              Team name
            </label>
            <span className="link-row">
              <input
                id="share-team-name"
                className="text-input"
                value={draftName}
                maxLength={80}
                onChange={(event) => setDraftName(event.target.value)}
              />
              <Button variant="secondary"  type="submit">
                Rename
              </Button>
            </span>
          </form>
        ) : null}
        {confirmRegen ? (
          <div className="card share-confirm">
            <p>Regenerate links revokes the current edit and view links. Anyone using the old ones loses access.</p>
            <Button variant="primary" type="button"  onClick={() => void regenerate()}>
              Regenerate links
            </Button>
            <Button variant="secondary" type="button"  onClick={() => setConfirmRegen(false)}>
              Cancel
            </Button>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {loading ? <p className="auth-note">Loading seats…</p> : null}
        {!loading && seats.length === 0 ? <p className="auth-note">No seats yet. Add the first one.</p> : null}
        {mode === 'org' ? (
          <div className="card canvas canvas-org">
            {company.seats.length ? (
              <OrgChart seats={company.seats} selectedId={selected} onSelect={setSelected} />
            ) : null}
          </div>
        ) : (
          <div className="card canvas">
            {company.steps.length ? (
              <WorkChart
                company={company}
                steps={company.steps}
                byId={byId}
                openLane={openLane || company.workstreams[0]?.id || ''}
                showException={false}
                pulse=""
                fading=""
                allowHire={false}
                onOpenLane={setOpenLane}
                onException={() => undefined}
                onSeat={setSelected}
              />
            ) : null}
          </div>
        )}
        <p className="auth-note">
          <a href="#teams">{linkAccess ? 'Create another team' : 'Members and invites'}</a>
          {' · '}
          <a
            href="#org"
            onClick={() => chooseTeam('')}
          >
            Sample demo
          </a>
        </p>
      </main>
      {current && record ? (
        <SeatDrawer
          seat={current}
          reportsTo={current.reportsTo ? byId.get(current.reportsTo)?.name : undefined}
          tab={tab}
          least={false}
          fading={false}
          sample={false}
          allowRetire={false}
          onTab={setTab}
          onClose={() => setSelected('')}
        >
          <SeatEditor
            key={`${record.id}:${record.name}:${record.role}:${record.botSlug ?? ''}:${record.humanOwner}`}
            teamId={id}
            seat={record}
            canEdit={canEdit}
            onSaved={reload}
            onRemoved={async () => {
              await reload()
              setSelected('')
            }}
            onError={setError}
          />
        </SeatDrawer>
      ) : null}
      {adding ? (
        <AddSeat
          teamId={id}
          onClose={() => setAdding(false)}
          onCreated={async (id) => {
            await reload()
            setSelected(id)
            setAdding(false)
          }}
        />
      ) : null}
    </div>
  )
}

function SeatEditor({
  teamId,
  seat,
  canEdit,
  onSaved,
  onRemoved,
  onError,
}: {
  teamId: string
  seat: SeatRecord
  canEdit: boolean
  onSaved: () => Promise<void>
  onRemoved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState(seat)

  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await api(`/api/teams/${teamId}/seats/${seat.id}`, {
        method: 'PATCH',
        body: {
          name: draft.name,
          role: draft.role,
          humanOwner: draft.humanOwner,
          botSlug: draft.botSlug || null,
        },
      })
      await onSaved()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the seat.')
    }
  }

  async function remove() {
    try {
      await api(`/api/teams/${teamId}/seats/${seat.id}`, { method: 'DELETE' })
      await onRemoved()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not remove the seat.')
    }
  }

  return (
    <>
      {canEdit ? (
        <form onSubmit={save}>
          <label className="field-label" htmlFor="seat-name">Name</label>
          <input id="seat-name" className="text-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <label className="field-label" htmlFor="seat-role">Role</label>
          <input id="seat-role" className="text-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
          <label className="field-label" htmlFor="seat-bot">Curated bot</label>
          <select
            id="seat-bot"
            className="text-input"
            value={draft.botSlug ?? ''}
            onChange={(event) => setDraft({ ...draft, botSlug: event.target.value || null })}
          >
            <option value="">No bot yet</option>
            {catalogBots.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="seat-owner">Human owner</label>
          <input
            id="seat-owner"
            className="text-input"
            value={draft.humanOwner}
            onChange={(event) => setDraft({ ...draft, humanOwner: event.target.value })}
          />
          <Button variant="primary"  type="submit">Save seat</Button>
          <Button variant="secondary"  type="button" onClick={() => void remove()}>
            Remove seat
          </Button>
        </form>
      ) : (
        <>
          <p>{seat.humanOwner ? `Human owner: ${seat.humanOwner}` : 'No human owner yet.'}</p>
          <p>{catalogBots.find((item) => item.slug === seat.botSlug)?.summary ?? 'No curated bot assigned.'}</p>
        </>
      )}
    </>
  )
}

function AddSeat({
  teamId,
  onClose,
  onCreated,
}: {
  teamId: string
  onClose: () => void
  onCreated: (id: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(emptySeat)
  const [error, setError] = useState('')

  async function create(event: FormEvent) {
    event.preventDefault()
    try {
      const data = await api<{ seat: SeatRecord }>(`/api/teams/${teamId}/seats`, {
        method: 'POST',
        body: { ...draft, botSlug: draft.botSlug || null },
      })
      await onCreated(data.seat.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the seat.')
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-seat-title">
        <h2 id="add-seat-title">Add a seat</h2>
        <p className="modal-sub">Name, role, a catalog bot, and the human who owns the approve.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <form onSubmit={create}>
          <label className="field-label" htmlFor="new-seat-name">Name</label>
          <input id="new-seat-name" className="text-input" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <label className="field-label" htmlFor="new-seat-role">Role</label>
          <input id="new-seat-role" className="text-input" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} />
          <label className="field-label" htmlFor="new-seat-bot">Curated bot</label>
          <select id="new-seat-bot" className="text-input" value={draft.botSlug} onChange={(event) => setDraft({ ...draft, botSlug: event.target.value })}>
            <option value="">No bot yet</option>
            {catalogBots.map((item) => (
              <option key={item.slug} value={item.slug}>{item.name}</option>
            ))}
          </select>
          <label className="field-label" htmlFor="new-seat-owner">Human owner</label>
          <input id="new-seat-owner" className="text-input" value={draft.humanOwner} onChange={(event) => setDraft({ ...draft, humanOwner: event.target.value })} />
          <div className="modal-actions">
            <Button variant="secondary"  type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary"  type="submit">Add seat</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

