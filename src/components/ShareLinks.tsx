import { useState } from 'react'
import type { IssuedLinks } from '../api'
import { Button } from './Button'

export function ShareLinks({
  links,
  heading = 'Save these links',
  onDismiss,
}: {
  links: IssuedLinks
  heading?: string
  onDismiss?: () => void
}) {
  return (
    <section className="share-links" aria-labelledby="share-links-title">
      <h2 id="share-links-title">{heading}</h2>
      <p className="share-warning">Save your edit link. Anyone with it can edit. Lost links can't be recovered.</p>
      <CopyField label="Edit link" url={links.editUrl} />
      <CopyField label="View-only link" url={links.viewUrl} />
      {onDismiss ? (
        <Button variant="secondary" type="button"  onClick={onDismiss}>
          I've saved these links
        </Button>
      ) : null}
    </section>
  )
}

export function CopyField({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const field = document.createElement('textarea')
      field.value = url
      document.body.appendChild(field)
      field.select()
      document.execCommand('copy')
      field.remove()
    }
    setCopied(true)
  }

  return (
    <div className="copy-field">
      <label className="field-label">
        {label}
        <span className="link-row">
          <input className="text-input" readOnly value={url} onFocus={(event) => event.target.select()} />
          <Button variant="secondary" type="button"  onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </span>
      </label>
    </div>
  )
}
