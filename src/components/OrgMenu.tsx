import { useRef, useState } from 'react'
import { Button } from './Button'

/** Options at the end of the org tabs. Delete asks for the organization's name before it moves the folder to orgs/.deleted/. */
export function OrgMenu({ slug, name }: { slug: string; name: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const matches = typed.trim() === name.trim()

  function start() {
    if (menuRef.current) menuRef.current.open = false
    setTyped('')
    setError('')
    setOpen(true)
  }

  async function confirm() {
    if (!matches || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/orgs/${slug}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      })
      const body = (await response.json().catch(() => ({}))) as { next?: string; error?: string }
      if (!response.ok) {
        setError(body.error || 'Could not delete the organization.')
        setBusy(false)
        return
      }
      window.location.hash = body.next ? `#/org/${body.next}/overview` : '#/orgs'
      window.location.reload()
    } catch {
      setError('Saving is off. Restart npm run dev, then try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <details ref={menuRef} className="org-menu">
        <summary aria-label="Organization options">Options</summary>
        <div className="org-menu-list" role="menu">
          <Button variant="ghost" type="button" role="menuitem" className="org-menu-item" onClick={start}>Delete organization…</Button>
        </div>
      </details>
      {open ? (
        <div className="be-modal" role="dialog" aria-labelledby="delete-org-title">
          <h2 id="delete-org-title">Delete {name}</h2>
          <p>This removes the organization from BotsEverywhere. Its files move to orgs/.deleted/, so you can restore them by moving the folder back. Bots in Grok Bot are not touched.</p>
          <label>
            <span>Type <strong>{name}</strong> to confirm</span>
            <input value={typed} autoFocus onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" type="button" disabled={!matches || busy} onClick={() => void confirm()}>{busy ? 'Deleting…' : 'Delete organization'}</Button>
        </div>
      ) : null}
    </>
  )
}
