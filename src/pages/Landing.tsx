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
/** The perspective behind the work chart. Quoted word for word; the app is not affiliated with its authors. */
const ARTICLE = 'https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/articles/role-fusion-organizational-delayering.html'
/** Steps from the article's blueprint, and where each one lives in the app. */
const BLUEPRINT = [
  { step: 'Map the work', app: 'Work chart', text: 'Every process starts from a trigger and moves step by step to an outcome. Handoffs, waits, and steps with no one assigned are in plain view.' },
  { step: 'Make decision rights explicit', app: 'Seat cards', text: 'Every seat, person or bot, has a written card: what it owns, what it may do, what needs approval, and when its work is done.' },
  { step: 'Add guardrails', app: 'Checkpoints', text: 'A step that sends, pays, posts, books, merges, publishes, or deletes waits for a named human. Bots draft. People approve.' },
  { step: 'Instrument governance', app: 'Run log', text: 'Every step leaves one line in a plain text log, so status comes from the work itself instead of a weekly meeting.' },
] as const
/** Each one is true of the app as it ships, and stated the same way in Docs. */
const LOCAL = [
  { title: 'Local only', text: 'The app and its file writer listen on 127.0.0.1, the address only your own computer can reach.' },
  { title: 'Plain files you own', text: 'Your org chart, seats, processes, and logs are markdown files in one folder. Read them, back them up, keep them in git.' },
  { title: 'No accounts', text: 'No sign-up and no login. There is no password to forget or to leak.' },
  { title: 'No keys', text: 'It stores no passwords, tokens, or API keys, and never asks for one.' },
  { title: 'No tracking', text: 'No analytics, no telemetry, no third-party scripts. Its fonts ship with it, so opening a page loads nothing from the internet.' },
  { title: 'You decide what connects', text: 'Nothing leaves your computer unless you connect a bot to the folder yourself, and that folder is the same one you can open and read.' },
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
          <section id="why-work-chart" className="ld-sec" aria-labelledby="why-work-chart-title">
            <p className="ld-label">Why a work chart</p>
            <div className="ld-idea">
              <div>
                <h2 id="why-work-chart-title">Map the work, not just the people.</h2>
                <p>
                  An org chart shows who reports to whom. It does not show how an invoice becomes a payment, who checks it, or where it waits.
                  Once bots take over the routing, the summaries, and the first drafts, that second map is the one you manage.
                </p>
              </div>
              <figure className="ld-quote">
                <blockquote>
                  <p>Every layer of management in your organization exists because, at some point, a human being was the most reliable way to gather information, interpret it, and move it to the next decision point.</p>
                </blockquote>
                <figcaption>
                  Kulkarni, Bodan, and Kilgour, Deloitte, <a href={ARTICLE} target="_blank" rel="noreferrer"><cite>The work chart vs. org chart</cite></a>, June 2026
                </figcaption>
              </figure>
            </div>
            <ol className="ld-steps">
              {BLUEPRINT.map((item) => (
                <li key={item.step}>
                  <span className="ld-step-from">{item.step}</span>
                  <h3>{item.app}</h3>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
            <p className="ld-caution">
              <q>If you automate a broken process, you scale the breakdown</q>. That is why the work chart comes first: you see the broken step before a bot repeats it.
              {' '}<a href={ARTICLE} target="_blank" rel="noreferrer">Read the article</a>
            </p>
          </section>
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
        <section id="local" className="ld-sec" aria-labelledby="local-title">
          <div className="ld-sh">
            <h2 id="local-title">Private by design. It runs on your computer.</h2>
            <p>Your org chart says who does what, who approves what, and where the money moves. That map stays with you.</p>
          </div>
          <ul className="ld-trust">
            {LOCAL.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </section>
        <section id="open-source" className="ld-sec" aria-labelledby="open-source-title">
          <div className="ld-oss">
            <div>
              <p className="ld-label">Open source</p>
              <h2 id="open-source-title">Read it. Change it. Make it yours.</h2>
              <p>
                BotsEverywhere is dual licensed under the MIT License or the Apache License 2.0, at your option. Every screen, rule, and seat card is code or text you can read and change.
              </p>
              <ul className="ld-oss-points">
                <li><strong>Fit it to your organization.</strong> Add fields, rename steps, change the look. Colors, type, and spacing live in one tokens file.</li>
                <li><strong>Add your own bots.</strong> A directory bot is one markdown file. Copy one, edit its card, and it is in the directory.</li>
                <li><strong>Keep history.</strong> Commit the folder with git, and every change to your org chart is a diff you can review and roll back.</li>
                <li><strong>No lock-in.</strong> If you stop using it, your organization is still a folder of markdown files.</li>
              </ul>
              <p className="ld-fine">The BotsEverywhere name and logo are not licensed under either license.</p>
            </div>
            <figure className="ld-tree">
              <figcaption>One organization, as it sits on your disk</figcaption>
              <pre>{`orgs/your-organization/
├── org.md        the organization and its chart
├── seats/        one card per person or bot
├── processes/    one file per workflow
└── log/          one line per step, one file per day`}</pre>
              <span className="ld-tree-clone">{clone}</span>
            </figure>
          </div>
        </section>
      </div>
      <section className="ld-closing">
        <div className="ld-wrap ld-final">
          <h2>Map your team. Staff the seats.</h2>
          <p>Open source. Runs on your computer.</p>
          <div className="ld-actions">
            <Button variant="primary"  href={primaryHref}>{primary}</Button>
            <Button variant="secondary"  href={secondaryHref}>{secondary}</Button>
          </div>
        </div>
      </section>
      <AppFooter />
    </div>
  )
}
