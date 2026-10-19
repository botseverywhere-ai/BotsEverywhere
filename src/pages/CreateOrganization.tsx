import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api'
import { CopyField } from '../components/ShareLinks'
import { Button } from '../components/Button'

export function CreateOrganization() {
  const [name, setName] = useState('')
  const [ownerUrl, setOwnerUrl] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api<{ ownerUrl: string }>('/api/organizations', { method: 'POST', body: { name } })
      setOwnerUrl(data.ownerUrl)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the organization.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="app-main view-fade">
      <div className="screen-bar">
        <div className="screen-title">
          <h1>Create an organization</h1>
          <p>One personal link for every team you own. No account.</p>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <section className="card team-card org-create">
        {ownerUrl ? (
          <>
            <p className="share-warning">Save this link. It's the only way in.</p>
            <p className="auth-note">
              This page will not show the link again. Anyone with it can open every team in the organization and create new ones.
            </p>
            <CopyField label="Organization link" url={ownerUrl} />
            <Button variant="primary"  href={ownerUrl.slice(ownerUrl.indexOf('#'))}>
              Open the organization
            </Button>
          </>
        ) : (
          <form onSubmit={create}>
            <label className="field-label" htmlFor="org-name">
              Organization name
            </label>
            <input
              id="org-name"
              className="text-input"
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <Button variant="primary"  type="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create organization'}
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}
