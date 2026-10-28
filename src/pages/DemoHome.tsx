import { lazy, Suspense } from 'react'
import { mainCta } from '../nav-target'
const SampleCompanyPicker = lazy(() => import('../components/SampleCompanyPicker').then((mod) => ({ default: mod.SampleCompanyPicker })))
import { sampleCards } from '../org/sample-cards'
import { APP_MODE } from '../mode'
import { useSession } from '../sessionContext'

export function DemoHome() {
  const { authEnabled } = useSession()
  const showcase = APP_MODE === 'showcase'
  const countsVary = new Set(sampleCards.map((sample) => sample.label)).size > 1
  return (
    <main id="main" className="app-main view-fade">
      <div className="card home-hero">
        <div className="eyebrow">{showcase ? 'Read-only showcase' : 'Open source'}</div>
        <h1>BotsEverywhere is an open source team management tool for bots.</h1>
        <p className="sub">
          Organizations copy it to map their bots in one place: an org chart, a work chart of who does
          what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on their own
          computer.
        </p>
        {showcase ? (
          <p className="home-note">
            <a href="#docs">Get the open source copy</a>. This site only shows templates and the bot directory.
          </p>
        ) : APP_MODE === 'sqlite' ? (
          <p className="home-note">
            <a href="#organization">Create an organization</a> or <a href="#teams">create a private team</a>.
            {authEnabled ? <> <a href="#signin">Sign in</a> is optional.</> : null}
          </p>
        ) : (
          <p className="home-note">
            <a href={mainCta().href}>Open your org</a>, browse <a href="#/directory">the directory</a>, or read the{' '}
            <a href="#docs">docs</a>.
          </p>
        )}
      </div>
      <section className="sample-picker" aria-labelledby="sample-companies-title">
        <div className="screen-title">
          <h2 id="sample-companies-title">Templates</h2>
          <p>Sample organizations you can open and copy. The charts are read-only until you use the template.</p>
        </div>
        <ul className="sample-grid">
          {sampleCards.map((sample) => (
              <li key={sample.id}>
                <a className="card sample-card" href={`#/template/${sample.id}/overview`}>
                  <span className="sample-card-top">
                    <span className="org-mark" aria-hidden="true">
                      {sample.mark}
                    </span>
                    <span className="pc-label">{sample.industry}</span>
                  </span>
                  <h3>{sample.name}</h3>
                  <p>{sample.tagline}</p>
                  {countsVary ? <p className="org-counts">{sample.label}</p> : null}
                </a>
              </li>
            ))}
        </ul>
      </section>
      {APP_MODE === 'sqlite' ? <Suspense fallback={<p className="auth-note">Loading…</p>}><SampleCompanyPicker /></Suspense> : null}
    </main>
  )
}
