import { useEffect, useState, type FormEvent } from 'react'
import { userOrgs } from '../org/load'
import { Button } from '../components/Button'

type Listed = { slug: string; name: string }

export function OrgPicker() {
  const [orgs, setOrgs] = useState<Listed[]>(() => userOrgs.map((item) => ({ slug: item.id, name: item.bundle.org.company.name })))
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('You')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancel = false
    fetch('/api/orgs')
      .then(async (response) => {
        if (cancel || !response.ok) return
        const body = await response.json() as { orgs?: { slug: string; name: string }[] }
        if (!body.orgs) return
        const bySlug = new Map(userOrgs.map((item) => [item.id, { slug: item.id, name: item.bundle.org.company.name }]))
        for (const item of body.orgs) bySlug.set(item.slug, { slug: item.slug, name: item.name || item.slug })
        if (!cancel) setOrgs([...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), owner: owner.trim() || 'You' }),
      })
      const text = await response.text()
      const body = text.trimStart().startsWith('{') ? JSON.parse(text) as { slug?: string; errors?: string[] } : {}
      if (!response.ok || !body.slug) {
        setError(body.errors?.join(' ') || 'Could not create that org.')
        setSaving(false)
        return
      }
      window.location.hash = `#/org/${body.slug}/overview`
    } catch {
      setError('Saving is off. Restart npm run dev, then create the org.')
      setSaving(false)
    }
  }

  return (
    <main id="main" className="app-main org-picker">
      <h1>Your orgs</h1>
      <p className="lede">Each org is a folder on this computer, under orgs/&lt;slug&gt;/.</p>
      {orgs.length === 0 ? <p>No orgs on this computer yet.</p> : (
        <ul className="org-picker-list">
          {orgs.map((item) => (
            <li key={item.slug}>
              <a href={`#/org/${item.slug}/overview`}>
                <strong>{item.name}</strong>
                <span>orgs/{item.slug}/</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <form className="overview" onSubmit={(event) => void create(event)}>
        <h2>Create new org</h2>
        <label>
          Organization name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Your name
          <input value={owner} onChange={(event) => setOwner(event.target.value)} required />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit"  disabled={saving}>{saving ? 'Creating…' : 'Create new org'}</Button>
      </form>
    </main>
  )
}
