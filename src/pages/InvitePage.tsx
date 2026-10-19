import { useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { useSession } from '../sessionContext'
import { Button } from '../components/Button'

interface InvitePreview {
  teamName: string
  role: string
  email: string | null
}

export function InvitePage({ token }: { token: string }) {
  const { user, authEnabled, refresh, chooseTeam } = useSession()
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!cancelled) setInvite(data.invite)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Invite not found.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function accept() {
    setBusy(true)
    setError('')
    try {
      const data = await api<{ team: { id: string } }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: {},
      })
      await refresh()
      chooseTeam(data.team.id)
      window.location.hash = 'org'
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the team.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="app-main view-fade">
      <div className="card auth-card">
        <p className="eyebrow">Private team</p>
        <h1>{invite ? `Join ${invite.teamName}` : 'Team invite'}</h1>
        {invite ? (
          <p className="auth-lead">
            You are invited as <strong>{invite.role}</strong>
            {invite.email ? ` for ${invite.email}` : ''}.
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!authEnabled ? (
          <p className="auth-lead">Sign-in is turned off. Ask the team for its edit or view link instead of this invite.</p>
        ) : user ? (
          <Button variant="primary" type="button"  disabled={busy || !invite} onClick={() => void accept()}>
            {busy ? 'Joining…' : 'Join team'}
          </Button>
        ) : (
          <Button variant="primary"
            
            href="#signin"
            onClick={() => {
              try {
                sessionStorage.setItem('be-return', `invite-${token}`)
              } catch {
                /* private mode */
              }
            }}
          >
            Sign in to join
          </Button>
        )}
      </div>
    </main>
  )
}
