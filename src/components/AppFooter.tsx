import { Logo } from './Logo'

import { REPO_URL } from '../repo-url'

const repo = REPO_URL
// Docs sections, so each link lands on what it names instead of the top of Docs.
const docs = '#/docs'
const license = '#/docs?section=license'
const settings = '#/docs?section=ports'
const dataDocs = '#/docs?section=where'

export function AppFooter({ hidden = false, variant = 'public' }: { hidden?: boolean; variant?: 'public' | 'compact' }) {
  if (hidden) return null
  if (variant === 'compact') {
    return (
      <footer className="be-footer be-footer-compact">
        <p className="be-footer-line">
          <Logo />
          <span>BotsEverywhere · open source · <a href={license}>LICENSE</a> · v1.0.0</span>
        </p>
        <p className="be-footer-links">
          {repo ? <a href={repo}>GitHub</a> : null}
          <a href={docs}>Docs</a>
          <a href={settings}>Settings</a>
        </p>
      </footer>
    )
  }
  return (
    <footer className="be-footer">
      <div className="be-footer-inner">
        <div className="be-footer-brand">
          <a className="be-footer-mark" href="/" aria-label="BotsEverywhere">
            <img src="/mark-ink.svg" alt="" />
          </a>
          <p className="be-footer-name">BotsEverywhere</p>
          <p className="be-footer-meta">
            Open source · <a href={license}>License</a> · v1.0.0
          </p>
        </div>
        <div className="be-footer-col">
          <h2>Product</h2>
          <a href="#/templates">Templates</a>
          <a href="#/directory">Bot directory</a>
          <a href={docs}>Docs</a>
          <a href={settings}>Settings</a>
        </div>
        <div className="be-footer-col">
          <h2>Open source</h2>
          {repo ? <a href={repo}>GitHub</a> : null}
          <a href={license}>License</a>
          <a href={dataDocs}>Docs: where your data lives</a>
        </div>
      </div>
    </footer>
  )
}
