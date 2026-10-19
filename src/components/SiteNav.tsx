import { useEffect, useState } from 'react'
import { mainCta } from '../nav-target'
import { Button } from './Button'
import { GrokStatusBadge } from './GrokStatusBadge'

const LINKS = [
  ['#/directory', 'Bot Directory', 'directory'],
  ['#/templates', 'Templates', 'templates'],
  ['#/docs', 'Docs', 'docs'],
] as const

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const [hash, setHash] = useState(() => window.location.hash)
  const close = () => setOpen(false)
  const cta = mainCta()

  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const bare = hash.replace(/^#\/?/, '').split('?')[0] ?? ''

  return (
    <nav className="site-nav" aria-label="Main">
      <div className={open ? 'site-links is-open' : 'site-links'} id="site-drawer">
        <div className="site-sheet-head">
          <Button variant="secondary" className="site-drawer-close" type="button" onClick={close}>
            Close
          </Button>
        </div>
        <div className="site-sheet-body">
          {LINKS.map(([href, label, key]) => (
            <a key={href} href={href} aria-current={linkCurrent(bare, key) ? 'page' : undefined} onClick={close}>{label}</a>
          ))}
        </div>
      </div>
      <div className="site-nav-end">
        <GrokStatusBadge />
        <Button variant="primary" className="site-nav-cta"  href={cta.href}>{cta.label}</Button>
        <Button variant="secondary" className="site-menu-btn" type="button" aria-expanded={open} aria-controls="site-drawer" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'Menu'}
        </Button>
      </div>
    </nav>
  )
}

function linkCurrent(bare: string, key: 'directory' | 'templates' | 'docs'): boolean {
  if (key === 'directory') return bare === 'directory' || bare.startsWith('directory/')
  if (key === 'docs') return bare === 'docs'
  return bare === 'templates' || bare === 'demos' || bare === 'home' || bare.startsWith('template/')
}
