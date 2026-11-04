import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { OrgTab } from '../routing'
import { APP_MODE } from '../mode'
import { companiesChanged, loadCompanies, subscribeCompanies, withCurrent, writerApiOrigin, orgsEndpoint } from '../org/company-list'
import { NEW_COMPANY, newCompanyHref, orgSwitchHref } from '../org/switch-org'

type Listed = { slug: string; name: string }

export function OrgSwitcher({ slug, name, tab }: { slug: string; name: string; tab: OrgTab }) {
  const [orgs, setOrgs] = useState<Listed[]>([{ slug, name }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const opening = useRef(false)
  const pull = useCallback(async (): Promise<Listed[] | null> => {
    try {
      return withCurrent(await loadCompanies(writerApiOrigin()), { slug, name })
    } catch {
      return null
    }
  }, [name, slug])

  useEffect(() => {
    if (APP_MODE !== 'template') return
    let cancel = false
    const run = async () => {
      for (let attempt = 0; attempt < 4 && !cancel; attempt += 1) {
        const listed = await pull()
        if (cancel) return
        if (listed) {
          setOrgs(listed)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
    void run()
    const unsubscribe = subscribeCompanies(() => {
      void run()
    })
    return () => {
      cancel = true
      unsubscribe()
    }
  }, [pull])

  async function openMenu(event: { preventDefault: () => void; currentTarget: HTMLSelectElement }) {
    if (opening.current || busy) return
    event.preventDefault()
    opening.current = true
    const select = event.currentTarget
    try {
      const listed = await pull()
      if (listed) flushSync(() => setOrgs(listed))
      select.focus()
      select.showPicker()
    } catch {
      // The last list stays. The next open tries the writer again.
    } finally {
      opening.current = false
    }
  }

  async function choose(value: string) {
    if (busy || value === slug) return
    setError('')
    if (value !== NEW_COMPANY) {
      window.location.hash = orgSwitchHref(value, tab)
      return
    }
    setBusy(true)
    try {
      const response = await fetch(orgsEndpoint(writerApiOrigin()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New organization', owner: 'You' }),
        cache: 'no-store',
      })
      const text = await response.text()
      const body = text.trimStart().startsWith('{') ? (JSON.parse(text) as { slug?: string; errors?: string[] }) : {}
      if (!response.ok || !body.slug) {
        setError(body.errors?.join(' ') || 'Could not create that organization.')
        setBusy(false)
        return
      }
      companiesChanged()
      window.location.hash = newCompanyHref(body.slug)
    } catch {
      setError('Saving is off. Restart npm run dev, then create the organization.')
      setBusy(false)
    }
  }

  if (APP_MODE !== 'template') return null

  return (
    <label className="org-switch">
      <span className="sr-only">Organization</span>
      <select
        aria-label="Organization"
        value={slug}
        disabled={busy}
        onMouseDown={(event) => void openMenu(event)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return
          void openMenu(event)
        }}
        onChange={(event) => void choose(event.target.value)}
      >
        {orgs.map((item) => (
          <option key={item.slug} value={item.slug}>{item.name}</option>
        ))}
        <option value={NEW_COMPANY}>+ New organization</option>
      </select>
      {error ? <span className="form-error">{error}</span> : null}
    </label>
  )
}
