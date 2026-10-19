import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api, setOwnerToken, setShareToken, type ActivityRecord, type GoalRecord, type IssuedLinks, type WorkChart } from '../api'
import { CopyField } from '../components/ShareLinks'
import { OrgGoals } from '../components/OrgGoals'
import { SeatRoster, WorkChain } from '../components/OrgRoster'
import { Button } from '../components/Button'

interface OwnedTeam {
  id: string
  name: string
  editUrl: string | null
  viewUrl: string | null
}

interface OwnerSession {
  organization: { name: string }
  teams: OwnedTeam[]
  goals: GoalRecord[]
  activity: ActivityRecord[]
  charts: ({ teamId: string; teamName: string } & WorkChart)[]
}

export function OwnerDashboard({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [teams, setTeams] = useState<OwnedTeam[]>([])
  const [goals, setGoals] = useState<GoalRecord[]>([])
  const [activity, setActivity] = useState<ActivityRecord[]>([])
  const [charts, setCharts] = useState<OwnerSession['charts']>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [teamName, setTeamName] = useState('')
  const [claimLink, setClaimLink] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [nextOwnerUrl, setNextOwnerUrl] = useState('')

  function applySession(data: OwnerSession) {
    setName(data.organization.name)
    setTeams(data.teams)
    setGoals(data.goals)
    setActivity(data.activity)
    setCharts(data.charts)
  }

  useEffect(() => {
    setShareToken('')
    setOwnerToken(token)
    let cancelled = false
    // oxlint-disable-next-line react/set-state-in-effect -- the dashboard reloads when the owner token in the hash changes
    setLoading(true)
    api<OwnerSession>('/api/owner/session')
      .then((data) => {
        if (cancelled) return
        applySession(data)
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setName('')
        setError(err instanceof ApiError ? err.message : 'This link does not open an organization.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      setOwnerToken('')
    }
  }, [token])

  async function reload() {
    applySession(await api<OwnerSession>('/api/owner/session'))
  }

  async function createTeam(event: FormEvent) {
    event.preventDefault()
    setBusy('create')
    setNotice('')
    setError('')
    try {
      await api<{ links: IssuedLinks }>('/api/teams', { method: 'POST', body: { name: teamName } })
      setTeamName('')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the team.')
    } finally {
      setBusy('')
    }
  }

  async function claim(event: FormEvent) {
    event.preventDefault()
    setBusy('claim')
    setNotice('')
    setError('')
    try {
      const data = await api<{ replacedLinks?: boolean }>('/api/owner/claim', {
        method: 'POST',
        body: { editLink: claimLink },
      })
      setClaimLink('')
      if (data.replacedLinks) setNotice('The team is in this organization. Its previous edit and view links no longer work. Copy the new ones below.')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not claim that team.')
    } finally {
      setBusy('')
    }
  }

  async function regenerate() {
    setBusy('regenerate')
    setError('')
    try {
      const data = await api<{ ownerUrl: string }>('/api/owner/regenerate', { method: 'POST', body: {} })
      setNextOwnerUrl(data.ownerUrl)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate the link.')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <main id="main" className="app-main">
        <p className="auth-note">Loading the organization…</p>
      </main>
    )
  }

  if (!name) {
    return (
      <main id="main" className="app-main">
        <div className="card auth-card">
          <h1>Organization link not found</h1>
          <p className="auth-lead">{error || 'This link does not open an organization.'}</p>
          <Button variant="secondary"  href="#organization">
            Create an organization
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main id="main" className="app-main view-fade">
      <div className="screen-bar">
        <div className="screen-title">
          <h1>{name}</h1>
          <p>Every team in this organization. The link in the address bar is the only way in.</p>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="share-warning">{notice}</p> : null}
      {nextOwnerUrl ? (
        <section className="card team-card">
          <p className="share-warning">Save this link. It's the only way in.</p>
          <p className="auth-note">The previous organization link has stopped working.</p>
          <CopyField label="New organization link" url={nextOwnerUrl} />
          <Button variant="primary"  href={nextOwnerUrl.slice(nextOwnerUrl.indexOf('#'))}>
            Open the new link
          </Button>
        </section>
      ) : null}

      <OrgGoals goals={goals} onReload={reload} onError={setError} />

      {charts.map((chart) => (
        <section key={chart.teamId} className="owner-chart" aria-labelledby={`chart-${chart.teamId}`}>
          <h2 id={`chart-${chart.teamId}`}>{chart.teamName}</h2>
          <h3>Work chart</h3>
          <WorkChain chart={chart} />
          <h3>Seats</h3>
          <SeatRoster seats={chart.seats} />
        </section>
      ))}

      <section className="owner-activity" aria-labelledby="owner-activity-title">
        <h2 id="owner-activity-title">Activity</h2>
        {activity.length === 0 ? <p className="auth-note">No activity yet.</p> : null}
        <ol className="activity-list">
          {activity.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at}>{event.at.slice(0, 10)}</time>
              <span>{event.summary}</span>
              <code>{event.commitSha.slice(0, 7)}</code>
            </li>
          ))}
        </ol>
      </section>

      <div className="team-grid">
        <section className="card team-card">
          <h2>New team</h2>
          <form onSubmit={createTeam}>
            <label className="field-label" htmlFor="owner-team-name">
              Name
            </label>
            <input
              id="owner-team-name"
              className="text-input"
              value={teamName}
              maxLength={80}
              required
              onChange={(event) => setTeamName(event.target.value)}
            />
            <Button variant="primary"  type="submit" disabled={busy === 'create'}>
              {busy === 'create' ? 'Creating…' : 'Create team in this organization'}
            </Button>
          </form>
        </section>
        <section className="card team-card">
          <h2>Add an existing team</h2>
          <p className="auth-note">Paste that team's edit link. A view link cannot be used. Claiming replaces both links.</p>
          <form onSubmit={claim}>
            <label className="field-label" htmlFor="claim-link">
              Edit link
            </label>
            <input
              id="claim-link"
              className="text-input"
              value={claimLink}
              required
              onChange={(event) => setClaimLink(event.target.value)}
            />
            <Button variant="secondary"  type="submit" disabled={busy === 'claim'}>
              {busy === 'claim' ? 'Claiming…' : 'Claim team'}
            </Button>
          </form>
        </section>
      </div>

      <section className="owner-teams" aria-labelledby="owner-teams-title">
        <h2 id="owner-teams-title">Teams</h2>
        {teams.length === 0 ? <p className="auth-note">No teams yet.</p> : null}
        <ul className="owner-team-list">
          {teams.map((team) => (
            <li key={team.id} className="card owner-team">
              <h3>{team.name}</h3>
              {team.editUrl && team.viewUrl ? (
                <>
                  <CopyField label="Edit link" url={team.editUrl} />
                  <CopyField label="View-only link" url={team.viewUrl} />
                  <Button variant="primary"  href={team.editUrl.slice(team.editUrl.indexOf('#'))}>
                    Open and edit
                  </Button>
                </>
              ) : (
                <p className="auth-note">These links were replaced outside the organization. Regenerate them from the team chart.</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card team-card owner-regenerate">
        <h2>Organization link</h2>
        <p className="auth-note">Regenerating stops the current link. Teams stay. Save the new link when it appears.</p>
        <Button variant="secondary" type="button"  disabled={busy === 'regenerate' || Boolean(nextOwnerUrl)} onClick={() => void regenerate()}>
          {busy === 'regenerate' ? 'Replacing…' : 'Regenerate organization link'}
        </Button>
      </section>
    </main>
  )
}
