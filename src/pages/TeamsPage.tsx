import { lazy, Suspense, useState, type FormEvent } from 'react'
import { ApiError, api, type IssuedLinks, type Role, type TeamSummary } from '../api'
const SampleCompanyPicker = lazy(() => import('../components/SampleCompanyPicker').then((mod) => ({ default: mod.SampleCompanyPicker })))
import { ShareLinks } from '../components/ShareLinks'
import { useSession } from '../sessionContext'
import { Button } from '../components/Button'

interface Member {
  userId: string
  email: string
  name: string | null
  role: Role
}

export function TeamsPage() {
  const { user, teams, loading, authEnabled, refresh, chooseTeam } = useSession()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string>('')
  const [created, setCreated] = useState<IssuedLinks | null>(null)

  if (loading) {
    return (
      <main id="main" className="app-main">
        <p className="auth-note">Loading your teams…</p>
      </main>
    )
  }

  const current = user ? (teams.find((team) => team.id === selected) ?? teams[0]) : undefined

  async function createTeam(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api<{ team: TeamSummary; links: IssuedLinks }>('/api/teams', { method: 'POST', body: { name } })
      setCreated(data.links)
      setName('')
      if (user) {
        await refresh()
        chooseTeam(data.team.id)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the team.')
    } finally {
      setBusy(false)
    }
  }

  function openEdit() {
    if (!created) return
    const editToken = created.editUrl.split('#edit-')[1] ?? ''
    try {
      sessionStorage.setItem('be-fresh-links', JSON.stringify({ editToken, ...created }))
    } catch {
      /* private mode */
    }
    window.location.hash = `edit-${editToken}`
  }

  return (
    <main id="main" className="app-main view-fade">
      <div className="screen-bar">
        <div className="screen-title">
          <h1>Create a team</h1>
          <p>No account. You get an edit link and a view-only link. Teams are not listed publicly.</p>
          <p>
            <a href="#organization">Create an organization</a> if one link should open every team.
          </p>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="team-grid">
        <section className="card team-card">
          <h2>New team</h2>
          {created ? (
            <>
              <ShareLinks links={created} />
              <Button variant="primary" type="button"  onClick={openEdit}>
                Open the edit chart
              </Button>
              <Button variant="secondary" type="button"  onClick={() => setCreated(null)}>
                Create another
              </Button>
            </>
          ) : (
          <form onSubmit={createTeam}>
            <label className="field-label" htmlFor="team-name">
              Name
            </label>
            <input
              id="team-name"
              className="text-input"
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Button variant="primary"  type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create team'}
            </Button>
          </form>
          )}
        </section>
        {user ? (
        <section className="card team-card">
          <h2>Teams you belong to</h2>
          {teams.length === 0 ? <p className="auth-note">No membership yet. A team you create here also gives you an edit link.</p> : null}
          <ul className="team-list">
            {teams.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  className={current?.id === team.id ? 'team-pick active' : 'team-pick'}
                  onClick={() => setSelected(team.id)}
                >
                  <b>{team.name}</b>
                  <span>{team.role}</span>
                </button>
              </li>
            ))}
          </ul>
          {current ? (
            <Button variant="secondary"
              
              href="#org"
              onClick={() => chooseTeam(current.id)}
            >
              Open {current.name}
            </Button>
          ) : null}
        </section>
        ) : null}
      </div>
      {!authEnabled ? <p className="auth-note">Email and Slack sign-in are turned off. The edit link is how you change this team.</p> : null}
      {authEnabled && !user ? (
        <p className="auth-note">
          Email and Slack sign-in are optional. <a href="#signin">Sign in</a> if you want a membership. You can still create a team with no account.
        </p>
      ) : null}
      {current ? <TeamAdmin key={current.id} team={current} onChanged={refresh} onError={setError} /> : null}
      <Suspense fallback={<p className="auth-note">Loading…</p>}>
        <SampleCompanyPicker />
      </Suspense>
      <p className="auth-note">
        <a href="#org" onClick={() => chooseTeam('')}>
          Back to the sample team
        </a>
      </p>
    </main>
  )
}

function TeamAdmin({
  team,
  onChanged,
  onError,
}: {
  team: TeamSummary
  onChanged: () => Promise<void>
  onError: (message: string) => void
}) {
  const { user } = useSession()
  const [teamName, setTeamName] = useState(team.name)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [link, setLink] = useState('')
  const [members, setMembers] = useState<Member[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function loadMembers() {
    const data = await api<{ members: Member[] }>(`/api/teams/${team.id}/members`)
    setMembers(data.members)
  }

  async function rename(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api(`/api/teams/${team.id}`, { method: 'PATCH', body: { name: teamName } })
      await onChanged()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not rename the team.')
    } finally {
      setBusy(false)
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setLink('')
    try {
      const data = await api<{ invite: { url: string } }>(`/api/teams/${team.id}/invites`, {
        method: 'POST',
        body: { role, email: email.trim() || null },
      })
      setLink(data.invite.url)
      setEmail('')
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not create the invite.')
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: Member, next: Role) {
    try {
      await api(`/api/teams/${team.id}/members/${member.userId}`, { method: 'PATCH', body: { role: next } })
      await loadMembers()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not change that role.')
    }
  }

  async function remove(member: Member) {
    try {
      await api(`/api/teams/${team.id}/members/${member.userId}`, { method: 'DELETE' })
      await loadMembers()
      await onChanged()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not remove that member.')
    }
  }

  if (team.role !== 'owner') {
    return <p className="auth-note">You are a {team.role} on {team.name}. Owners send invites and rename the team.</p>
  }

  return (
    <section className="card team-card team-admin">
      <h2>Manage {team.name}</h2>
      <form onSubmit={rename} className="inline-form">
        <label className="field-label" htmlFor="rename-team">
          Rename
        </label>
        <input id="rename-team" className="text-input" value={teamName} maxLength={80} onChange={(event) => setTeamName(event.target.value)} />
        <Button variant="secondary"  type="submit" disabled={busy}>
          Save name
        </Button>
      </form>
      <form onSubmit={invite}>
        <label className="field-label" htmlFor="invite-email">
          Invite by email <span className="label-hint">leave blank for a share link</span>
        </label>
        <input
          id="invite-email"
          className="text-input"
          type="email"
          value={email}
          placeholder="optional"
          onChange={(event) => setEmail(event.target.value)}
        />
        <label className="field-label" htmlFor="invite-role">
          Role
        </label>
        <select id="invite-role" className="text-input" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="owner">Owner</option>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <Button variant="primary"  type="submit" disabled={busy}>
          Create invite
        </Button>
      </form>
      {link ? (
        <p className="invite-link">
          Share link: <a href={link}>{link}</a>
        </p>
      ) : null}
      <Button variant="secondary" type="button"  onClick={() => void loadMembers().catch(() => onError('Could not load members.'))}>
        Show members
      </Button>
      {members ? (
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.userId}>
              <span>
                <b>{member.email}</b>
                {member.userId === user?.id ? ' · you' : ''}
              </span>
              <select
                className="text-input slim"
                value={member.role}
                aria-label={`Role for ${member.email}`}
                onChange={(event) => void changeRole(member, event.target.value as Role)}
              >
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button variant="secondary" type="button"  onClick={() => void remove(member)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
