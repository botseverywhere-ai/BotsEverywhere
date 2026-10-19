import { useEffect, useState } from 'react'
import { ApiError, api, setShareToken, type IssuedLinks } from '../api'
import { LiveTeam } from './LiveTeam'
import { Button } from '../components/Button'

const FRESH_KEY = 'be-fresh-links'

export function ShareTeam({ token, chart }: { token: string; chart: 'org' | 'work' }) {
  const [teamId, setTeamId] = useState('')
  const [access, setAccess] = useState<'edit' | 'view' | null>(null)
  const [error, setError] = useState('')
  const [links, setLinks] = useState<IssuedLinks | null>(null)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the new links are stashed in sessionStorage for this token
    setLinks(readFreshLinks(token))
    setShareToken(token)
    let cancelled = false
    api<{ team: { id: string; access: 'edit' | 'view' } }>('/api/share/session')
      .then((data) => {
        if (cancelled) return
        setTeamId(data.team.id)
        setAccess(data.team.access)
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'This link does not open a team.')
      })
    return () => {
      cancelled = true
      setShareToken('')
    }
  }, [token])

  function onChart(next: 'org' | 'work') {
    const prefix = access === 'view' ? 'view' : 'edit'
    window.location.hash = `${prefix}-${token}?chart=${next}`
  }

  function onRegenerated(next: IssuedLinks) {
    const editToken = tokenFrom(next.editUrl, 'edit-')
    if (!editToken) return
    try {
      sessionStorage.setItem(FRESH_KEY, JSON.stringify({ editToken, ...next }))
    } catch {
      /* private mode */
    }
    setShareToken(editToken)
    window.location.hash = `edit-${editToken}?chart=${chart}`
  }

  if (error) {
    return (
      <main id="main" className="app-main">
        <div className="card auth-card">
          <h1>Link not found</h1>
          <p className="auth-lead">{error} Ask for a new edit or view link.</p>
          <Button variant="secondary"  href="#teams">
            Create a team
          </Button>
        </div>
      </main>
    )
  }

  if (!teamId || !access) {
    return (
      <main id="main" className="app-main">
        <p className="auth-note">Loading this team…</p>
      </main>
    )
  }

  return (
    <LiveTeam
      key={teamId}
      mode={chart}
      teamId={teamId}
      linkAccess={access}
      onChart={onChart}
      freshLinks={links}
      onDismissLinks={() => {
        try {
          sessionStorage.removeItem(FRESH_KEY)
        } catch {
          /* private mode */
        }
        setLinks(null)
      }}
      onRegenerated={access === 'edit' ? onRegenerated : undefined}
    />
  )
}

function readFreshLinks(token: string): IssuedLinks | null {
  try {
    const raw = sessionStorage.getItem(FRESH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { editToken?: string; editUrl?: string; viewUrl?: string }
    if (parsed.editToken !== token || !parsed.editUrl || !parsed.viewUrl) return null
    return { editUrl: parsed.editUrl, viewUrl: parsed.viewUrl }
  } catch {
    return null
  }
}

function tokenFrom(url: string, prefix: string): string {
  const hash = new URL(url).hash.replace(/^#/, '')
  return hash.startsWith(prefix) ? hash.slice(prefix.length).split('?')[0] ?? '' : ''
}
