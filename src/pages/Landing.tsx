import { AppFooter } from '../components/AppFooter'
import { DemoBanner } from '../components/DemoBanner'
import { Logo } from '../components/Logo'
import { SiteNav } from '../components/SiteNav'
import { mainCta } from '../nav-target'
import { APP_MODE } from '../mode'
import { sampleCards } from '../org/sample-cards'
import { userOrgs } from '../org/load'
import { Button } from '../components/Button'

const repo = import.meta.env.VITE_REPO_URL || ''
const github = repo || '#docs'
const TEAMS = [
  { name: 'Finance', category: 'Finance', blurb: 'Invoices, expenses, budgets, and the month-end close.' },
  { name: 'Operations', category: 'Ops', blurb: 'Requests, stock, suppliers, and weekly coverage.' },
  { name: 'Sales', category: 'Sales', blurb: 'Follow-ups, quotes, proposals, and open deals.' },
  { name: 'Marketing', category: 'Marketing', blurb: 'Campaign drafts, posts, and launch checklists.' },
  { name: 'Support', category: 'Support', blurb: 'Ticket replies, refunds, and known issues.' },
  { name: 'Security', category: 'Security', blurb: 'Phishing reports, secrets, and dependency advisories.' },
  { name: 'People', category: 'HR', blurb: 'Hiring, onboarding, time off, and policy answers.' },
] as const
const countLabels = sampleCards.map((sample) => sample.label)
const countsVary = new Set(countLabels).size > 1

export function Landing() {
  const showcase = APP_MODE === 'showcase'
  const ownOrg = userOrgs.length === 1 ? userOrgs[0]!.id : ''
  const orgHref = showcase ? '#/template/harbor/work-chart' : ownOrg ? `#/org/${ownOrg}/work-chart` : '#/orgs'
  const primaryHref = mainCta().href
  const primary = showcase ? 'Get it on GitHub' : 'Open your org'
  const secondaryHref = showcase ? '#/template/harbor/org-chart' : '#docs'
  const secondary = showcase ? 'Open the sample org' : 'Get the open source copy'
  const clone = repo ? `git clone ${repo}` : 'git clone github.com/…/botseverywhere'
  return (
    <div className="ld">
      {showcase ? <DemoBanner /> : null}
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="ld-wrap">
        <div className="ld-nav">
          <Logo />
          <SiteNav />
        </div>
        <main id="main">
          <section className="ld-hero">
            <div>
              <h1>The open source team management tool for bots.</h1>
              <p className="ld-subhead">Structured and organized teams powered with Grok Bot</p>
            </div>
            <div>
              <p>
                Organizations copy it to map their team of people and bots in one place: an org chart, a work chart of who
                does what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on
                their own computer.
              </p>
              <div className="ld-clone">
                <span>{clone}</span>
                <Button variant="primary"  href={primaryHref}>{primary}</Button>
              </div>
              <p className="ld-more"><a href={github}>See how it works on GitHub →</a></p>
            </div>
          </section>
          <section id="how" className="ld-sec">
            <p className="ld-label">Bot directory</p>
            <div className="ld-teams">
              {TEAMS.map((team) => (
                <a key={team.category} href={`#/directory?category=${encodeURIComponent(team.category)}`}>
                  {team.name}
                  <small>{team.blurb}</small>
                </a>
              ))}
            </div>
          </section>
          <p className="ld-statement">
            Org chart for bots. Work chart for humans. <span>Every bot holds a seat with a written card: what it owns, what it may do, what needs approval, and when its work is done. Bots staff the seats. You keep the approve.</span>
          </p>
          <section className="ld-sec">
            <div className="ld-sh">
              <h2>See the work move.</h2>
              <p>Three views of one team, from the app itself. No stock photos.</p>
            </div>
            <div className="ld-tiles">
              <a href={orgHref}><img src="/tile-work.webp" alt="" loading="lazy" /><span>Work chart<small>Steps, checkpoints, steps with no one assigned</small></span></a>
              <a href={showcase ? '#/template/harbor/org-chart' : ownOrg ? `#/org/${ownOrg}/org-chart` : '#/orgs'}><img src="/tile-org.webp" alt="" loading="lazy" /><span>Org chart<small>Who owns what</small></span></a>
              <a href="#directory"><img src="/tile-directory.webp" alt="" loading="lazy" /><span>Bot directory<small>Hire with a full seat card</small></span></a>
            </div>
          </section>
          <section id="samples" className="ld-sec" aria-labelledby="sample-companies">
            <div className="ld-sh">
              <h2 id="sample-companies">Sample organizations</h2>
              <p>Ten fictional teams. Open one to read the org, the work, and the seats.</p>
            </div>
            <ul className="ld-samples">
              {sampleCards.map((sample) => (
                  <li key={sample.id}>
                    <a className="ld-sample" href={`#/template/${sample.id}/overview`}>
                      <strong>{sample.name}</strong>
                      <span>{sample.industry}</span>
                      {countsVary ? <small>{sample.label}</small> : null}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        </main>
      </div>
      <section className="ld-black">
        <div className="ld-wrap">
          <p className="ld-label">Work chart</p>
          <h2>Bots do the steps. Humans approve.</h2>
          <p>Every workstream starts from a trigger. Every checkpoint names a human.</p>
          <div className="ld-flow" aria-hidden="true">
            <div className="ld-sys">⚡ Invoice received</div>
            <span>→</span>
            <div><em>BOT</em>Match the invoice<small>Invoice Bot</small></div>
            <span className="ld-dia" />
            <div><em>HUMAN</em>Approve payment<small>Needs approval</small></div>
            <span>→</span>
            <div className="ld-dash"><em>No one assigned</em>File the receipt<small>Add a bot from the directory</small></div>
          </div>
        </div>
      </section>
      <section className="ld-taupe">
        <div className="ld-wrap">
          <h2>One tool. Four parts.</h2>
          <div className="ld-parts">
            <div><h3>Org chart</h3><p>People and bots in one tree. Who owns what, who reports to whom.</p></div>
            <div><h3>Work chart</h3><p>How work moves from a trigger to an outcome, with human checkpoints.</p></div>
            <div><h3>Bot directory</h3><p>Ready-made bots with seat cards. No card, no hire.</p></div>
            <div><h3>Stored on your computer</h3><p>Each org is plain files in <code>orgs/&lt;slug&gt;/</code>. Commit them with git.</p></div>
          </div>
        </div>
      </section>
      <div className="ld-wrap">
        <section className="ld-final">
          <h2>Map your team. Staff the seats.</h2>
          <p>Open source. Runs on your computer.</p>
          <div className="ld-actions">
            <Button variant="primary"  href={primaryHref}>{primary}</Button>
            <Button variant="secondary"  href={secondaryHref}>{secondary}</Button>
          </div>
        </section>
      </div>
      <AppFooter />
    </div>
  )
}
