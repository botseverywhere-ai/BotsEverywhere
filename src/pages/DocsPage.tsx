import { useEffect, useState, type ReactNode } from 'react'
import { CodeBlock } from '../components/CodeBlock.tsx'
import { CONNECTOR_BOT_NAME, CONNECTOR_LOG_BOT, connectorBootstrapPrompt } from '../../server/src/connector-prompt.ts'
import { DEFAULT_SYNC_MINUTES, MAX_SYNC_MINUTES, MIN_SYNC_MINUTES, everyLabel, staleMinutes } from '../../server/src/connector-timing.ts'
import { HiringGuide } from '../content/HiringGuide.tsx'
import { GROK_BOT_LIMIT } from '../components/sync-copy.ts'
import { DESKTOP_MIN_WIDTH } from '../content/screen-notice.ts'
// The same file that ships with the project, so the page and the license never disagree.
import MIT_TEXT from '../../LICENSE?raw'

const repoUrl = import.meta.env.VITE_REPO_URL || '<this-repository-url>'

/** The Connector's interval is set on Connect bots. These come from the same rules, so the page never names a fixed rate. */
const DEFAULT_EVERY = everyLabel(DEFAULT_SYNC_MINUTES)
const MIN_EVERY = everyLabel(MIN_SYNC_MINUTES)
const MAX_EVERY = everyLabel(MAX_SYNC_MINUTES)
const STALE_AT_DEFAULT = everyLabel(staleMinutes(DEFAULT_SYNC_MINUTES))
const STALE_AT_HOUR = everyLabel(staleMinutes(60))

/** The left menu. Each id is an h2 on this page. */
const SECTIONS: { group: string; items: [id: string, label: string][] }[] = [
  {
    group: 'Getting started',
    items: [
      ['overview', 'How it works'],
      ['security', 'Security and privacy'],
      ['install', 'Install'],
      ['ports', 'Ports and addresses'],
      ['connect-grok', 'Step 1: Connect Grok Bot'],
      ['set-up-org', 'Step 2: Set up your organization'],
    ],
  },
  {
    group: 'Using the app',
    items: [
      ['org-chart', 'Org chart'],
      ['one-org', 'One bot, one organization'],
      ['seat-cards', 'Seat cards and Profile'],
      ['work-chart', 'Work Chart'],
      ['sync', 'Sync with Grok Bot'],
      ['directory', 'Bot directory'],
      ['hiring', 'Hiring'],
      ['performance-logs', 'Performance and Logs'],
    ],
  },
  {
    group: 'Reference',
    items: [
      ['where', 'Files and folders'],
      ['files', 'Import and export'],
      ['add-your-own-bot', 'Add your own bot'],
      ['other-platforms', 'Other bot platforms'],
      ['example', 'Worked example'],
      ['troubleshooting', 'Troubleshooting'],
      ['faq', 'FAQ'],
      ['license', 'License'],
    ],
  },
]

const IDS = SECTIONS.flatMap((section) => section.items.map(([id]) => id))

/** Hash routes own the address bar, so a section is `#/docs?section=<id>`, never a bare `#<id>`. */
function sectionFromHash(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  const id = at === -1 ? '' : new URLSearchParams(hash.slice(at + 1)).get('section') ?? ''
  return IDS.includes(id) ? id : ''
}

/** While a jump scrolls past other sections, the menu keeps showing the one that was picked. */
let pinnedUntil = 0
const PICKED = 'docs-section-picked'

function jumpTo(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  pinnedUntil = Date.now() + 1500
  window.dispatchEvent(new CustomEvent(PICKED, { detail: id }))
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  // replaceState does not fire hashchange, so the page stays mounted and the link can be shared.
  window.history.replaceState(null, '', `#/docs?section=${id}`)
}

/** A link to another section of this page. */
function To({ id, children }: { id: string; children: ReactNode }) {
  return (
    <a
      href={`#/docs?section=${id}`}
      onClick={(event) => {
        event.preventDefault()
        jumpTo(id)
      }}
    >
      {children}
    </a>
  )
}

function useActiveSection(): string {
  const [active, setActive] = useState(IDS[0]!)
  useEffect(() => {
    const onPicked = (event: Event) => setActive((event as CustomEvent<string>).detail)
    window.addEventListener(PICKED, onPicked)
    const headings = IDS.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node))
    if (!('IntersectionObserver' in window) || !headings.length) return () => window.removeEventListener(PICKED, onPicked)
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        if (Date.now() < pinnedUntil) return
        const first = IDS.find((id) => visible.has(id))
        if (first) setActive(first)
      },
      { rootMargin: '-80px 0px -65% 0px' },
    )
    for (const heading of headings) observer.observe(heading)
    return () => {
      observer.disconnect()
      window.removeEventListener(PICKED, onPicked)
    }
  }, [])
  return active
}

export function DocsPage() {
  const active = useActiveSection()

  useEffect(() => {
    let timer = 0
    const open = () => {
      const id = sectionFromHash()
      if (!id) return
      pinnedUntil = Date.now() + 600
      window.dispatchEvent(new CustomEvent(PICKED, { detail: id }))
      // The app scrolls to the top on every route change; jump after it.
      window.clearTimeout(timer)
      // instant, because html has smooth scrolling and the app's scroll to the top would still be animating.
      timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' }), 80)
    }
    open()
    // A section link followed while Docs is already open is a hash change, not a new page.
    window.addEventListener('hashchange', open)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', open)
    }
  }, [])

  return (
    <main id="main" className="app-main docs-layout">
      <nav className="docs-nav" aria-label="Docs sections">
        <label className="docs-nav-select">
          <span className="sr-only">Go to section</span>
          <select value={active} onChange={(event) => jumpTo(event.target.value)}>
            {SECTIONS.map((section) => (
              <optgroup key={section.group} label={section.group}>
                {section.items.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="docs-nav-list">
          {SECTIONS.map((section) => (
            <div key={section.group} className="docs-nav-group">
              <p className="docs-nav-title">{section.group}</p>
              <ul>
                {section.items.map(([id, label]) => (
                  <li key={id}>
                    <a
                      href={`#/docs?section=${id}`}
                      aria-current={active === id ? 'true' : undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        jumpTo(id)
                      }}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <article className="docs">
        <header className="docs-head">
          <h1>BotsEverywhere documentation</h1>
          <p className="lede">
            BotsEverywhere is an open source team management tool for bots. It maps your bots in one place: an org chart of who each bot reports to,
            a work chart of what each bot does and when, and a directory of ready-made bots you can add to Grok Bot.
            It runs on your own computer, and your data stays there. Documentation updated 3 November 2026.
          </p>
          <p className="docs-head-actions">
            <To id="install">Install it</To>
            <To id="connect-grok">Connect Grok Bot</To>
            <To id="security">How your data stays private</To>
          </p>
        </header>

        <h2 id="overview">How it works</h2>
        <figure className="docs-flow" aria-label="How the parts connect">
          <div className="docs-flow-side">
            <p className="docs-flow-name">Your computer</p>
            <ul>
              <li>The app, at <code>127.0.0.1</code></li>
              <li>The <code>orgs</code> folder: org charts, bots, processes, logs</li>
            </ul>
          </div>
          <div className="docs-flow-link" aria-hidden="true">
            <span>Connector</span>
            <span className="docs-flow-arrow" />
            <span>on the schedule you set, e.g. {DEFAULT_EVERY}</span>
          </div>
          <div className="docs-flow-side is-grok">
            <p className="docs-flow-name">Grok Bot</p>
            <ul>
              <li>Your bots and their routines</li>
              <li>Run on your own Grok Bot account</li>
            </ul>
          </div>
          <figcaption>
            The Connector is the only link between the two, and you create it yourself. It runs every {DEFAULT_EVERY} unless you set another interval on <strong>Connect bots</strong>.
          </figcaption>
        </figure>
        <p>BotsEverywhere has three parts. Each does one job.</p>
        <ul>
          <li>
            <strong>The app</strong> runs on your computer. <code>npm run dev</code> starts the site at <code>http://127.0.0.1:5199</code> and a small
            file writer that only this computer can reach. Every change you make is saved as a plain markdown file.
          </li>
          <li>
            <strong>The <code>orgs</code> folder</strong> holds your organizations, one folder each: the org chart, one file per bot, the processes, and the logs.
            Nothing is uploaded. You can open, edit, back up, or commit these files yourself.
          </li>
          <li>
            <strong>Grok Bot</strong> runs the bots. One bot there, the Connector, reports what it sees in Grok Bot to the <code>orgs</code> folder on the schedule you choose:
            every {DEFAULT_EVERY} by default, and anything from {MIN_EVERY} to {MAX_EVERY}. It then carries out what the app asks: it creates bots, tells each bot who it
            reports to and how to log its work, and sends skills and routines.
          </li>
        </ul>
        <p>
          The app decides; the Connector carries it out. You plan the work in the app, the bots do it in Grok Bot, and each bot writes what it did to the run log.
          You can build an org chart before the Connector is set up, but nothing reaches Grok Bot until it runs. The bar at the top of every organization page says whether it is connected.
        </p>
        <p>There are no accounts, no sign-up, no paid services, and no API keys.</p>

        <h2 id="security">Security and privacy</h2>
        <p>
          BotsEverywhere is built to keep your organization on your own computer. There is no BotsEverywhere server, account, or cloud copy of your data,
          so there is nothing of yours for us to lose or expose.
        </p>
        <ul>
          <li><strong>Local only.</strong> The site and the file writer listen on <code>127.0.0.1</code>, the address only your own computer can reach. The writer refuses to start on any other address, and only lets pages served from this computer read its answers.</li>
          <li><strong>Plain files you own.</strong> Your org chart, bots, processes, and logs are markdown files in <code>orgs/</code>. You can read every one of them, back them up, or delete them.</li>
          <li><strong>No tracking.</strong> The app has no analytics, no telemetry, and no third-party scripts. Its fonts ship with it, so opening a page loads nothing from the internet.</li>
          <li><strong>No keys.</strong> The app stores no passwords, tokens, or API keys, and never asks for one.</li>
          <li><strong>One connection, and you set it up.</strong> The only link to the outside is the Connector you create in your own Grok Bot account. It reads and writes the <code>orgs</code> folder named in its prompt and nothing outside it.</li>
          <li><strong>Your bots&apos; own text stays yours.</strong> The app adds one BotsEverywhere block at the end of a bot&apos;s instructions and never changes the text outside it. Before the Connector changes a bot&apos;s instructions, the app keeps the old text in <code>orgs/connector-backups/</code>.</li>
        </ul>
        <h3>What leaves your computer</h3>
        <p>
          Only what your Connector and your bots read in <code>orgs/</code>: the Connector&apos;s rules and to-do list, and each bot&apos;s seat file and process files.
          That data is then handled by Grok Bot under its own terms, the same as anything else you give it. If you never set up a Connector, nothing leaves your computer.
        </p>
        <h3>What you stay responsible for</h3>
        <ul>
          <li>Keep secrets out of seat cards, processes, and prompts. Bots read them.</li>
          <li>Keep <code>orgs/</code> out of public repositories. Commit it only to a private one.</li>
          <li>Keep your Grok Bot account secure; anyone with access to it can reach the Connector.</li>
        </ul>

        <h2 id="install">Install on Mac, Windows or Linux</h2>
        <p>
          You need Node.js LTS and Git. The project is tested on Node.js 22. Install Node.js from nodejs.org, or with a version manager such as nvm.
          Then clone the project, install it, and start it. The project folder is wherever you clone it.
        </p>
        <p>
          BotsEverywhere is built for desktop browsers on screens {DESKTOP_MIN_WIDTH}px wide and up, such as a laptop or desktop monitor.
          On a narrower window it still works, and a notice at the top says some pages may not fit.
        </p>
        <h3>Windows</h3>
        <p>Install Git for Windows, then in PowerShell:</p>
        <CodeBlock>{`git clone ${repoUrl} botseverywhere
Set-Location botseverywhere
npm install
npm run dev`}</CodeBlock>
        <p>Project folder, for example: <code>C:\Users\you\botseverywhere</code></p>
        <h3>macOS</h3>
        <p>Git comes with the Xcode Command Line Tools (<code>xcode-select --install</code>). Then in Terminal:</p>
        <CodeBlock>{`git clone ${repoUrl} botseverywhere
cd botseverywhere
npm install
npm run dev`}</CodeBlock>
        <p>Project folder, for example: <code>/Users/you/botseverywhere</code></p>
        <h3>Linux</h3>
        <p>Install Git with your package manager, for example <code>sudo apt install git</code> on Debian and Ubuntu or <code>sudo dnf install git</code> on Fedora. Then:</p>
        <CodeBlock>{`git clone ${repoUrl} botseverywhere
cd botseverywhere
npm install
npm run dev`}</CodeBlock>
        <p>Project folder, for example: <code>/home/you/botseverywhere</code></p>
        <h3>After it starts</h3>
        <p>
          Leave the window open: <code>npm run dev</code> runs the site and the file writer together, and prints the two addresses it uses. Open the site address,
          normally <a href="http://127.0.0.1:5199">http://127.0.0.1:5199</a>. To stop it, press <code>Ctrl+C</code> in that window.
        </p>
        <p>
          Your organizations are saved in <code>orgs/</code> inside the project folder. A fresh clone has none: choose <strong>Open your org</strong> and create your first one.
          It starts with one seat, <strong>You</strong>, at the top of the chart, and every bot reports up to you.
          Each new organization gets a folder named by its ID, such as <code>orgs/org-k3f9x2ma/</code>. The ID never changes, so renaming an organization never moves its files
          and your bots always find them. The name lives in <code>org.md</code>, and <strong>Your files</strong> on Organization Overview shows which folder is which.
        </p>
        <h3>Update to a newer version</h3>
        <p>
          Stop <code>npm run dev</code> with <code>Ctrl+C</code>, then in the same project folder run <code>git pull</code>, <code>npm install</code>, and <code>npm run dev</code> again.
        </p>
        <p>
          Do not clone a fresh copy into a new folder to update. Your organizations and this copy&apos;s ID live in <code>orgs/</code>, which git does not track. A new folder
          starts with no organizations and a new ID, so you would set up a second Connector, and your bots would keep the old copy&apos;s instructions until you remove them
          in <To id="sync">Sync with Grok Bot</To>. If you must move to another folder, move <code>orgs/</code> with it, then paste the Connector prompt from Connect bots
          into Grok Bot once more: the prompt names the folder, and the Connector replaces its own instructions.
        </p>

        <h2 id="ports">Ports and addresses</h2>
        <p><code>npm run dev</code> starts two things on your computer, and prints both addresses when it starts:</p>
        <ul>
          <li><strong>The site</strong>, at <code>http://127.0.0.1:5199</code>. This is the page you open.</li>
          <li><strong>The file writer</strong>, at <code>http://127.0.0.1:8787</code>. The site talks to it; you never open it.</li>
        </ul>
        <p>
          If a port is already taken, for example by another copy of BotsEverywhere, it moves to the next free one (5200, 8788, and so on) and prints the address it used.
          Always open the address printed in the window.
        </p>
        <p>To start on other ports, set them before <code>npm run dev</code>: <code>PORT</code> for the file writer and <code>WEB_PORT</code> for the site.</p>
        <ul>
          <li>Windows PowerShell: <code>$env:PORT = &quot;9000&quot;; $env:WEB_PORT = &quot;5300&quot;; npm run dev</code></li>
          <li>macOS and Linux: <code>PORT=9000 WEB_PORT=5300 npm run dev</code></li>
        </ul>
        <p>
          Both always listen on <code>127.0.0.1</code>, so other computers on your network cannot reach them. That is on purpose, and there is no setting to change it.
        </p>

        <h2 id="connect-grok">Step 1: Connect Grok Bot</h2>
        <p>
          Do this once for each copy of BotsEverywhere. One Connector serves every organization in the copy, so one Grok Bot account needs one Connector.
        </p>
        <ol>
          <li>
            Open any organization and choose the <strong>Connect bots</strong> tab. Step 1 shows the Connector name, the folder it uses, its <strong>Status file</strong>, and its status.
          </li>
          <li>Choose <strong>Copy Connector prompt</strong>.</li>
          <li>
            Paste it into Grok Bot. Grok Bot creates the Connector and runs it once right away, so you see it connect without waiting. After that it runs on the interval
            in <strong>Runs every</strong>.
          </li>
          <li>Come back to the app. After the first run the status turns green, and <strong>Sync with Grok Bot</strong> starts showing changes.</li>
        </ol>
        <h3>How often it runs</h3>
        <p>
          The Connector runs every {DEFAULT_EVERY} by default. That is only a starting point: set the interval that suits you. On <strong>Connect bots</strong>, choose
          {' '}<strong>Change</strong> next to <strong>Runs every</strong>, type a number, pick minutes, hours, or days (from {MIN_EVERY} to {MAX_EVERY}), and choose <strong>Save</strong>.
          A busy organization may want the shortest interval; one whose bots run a few routines a day can use every hour or less often.
        </p>
        <p>
          There is nothing to paste again. The prompt you pasted points the Connector at <code>orgs/CONNECTOR.md</code>, which holds its rules and its schedule, and the app
          rewrites that file when you save. The Connector reads it on every run and changes its own schedule on its next run. Until it reports the new interval,
          {' '}<strong>Connect bots</strong> and the status in the header say that Grok Bot still runs the old one.
        </p>
        <h3>The Connector&apos;s name and folder</h3>
        <p>
          The first time the app starts, it gives the copy a short id, such as <code>k3f9</code>, and saves it in <code>orgs/project.json</code>.
          The Connector is named after it: <strong>{CONNECTOR_BOT_NAME} (k3f9)</strong>.
        </p>
        <p>
          The prompt names the full path of this copy&apos;s <code>orgs</code> folder, for example <code>C:\Users\you\botseverywhere\orgs</code>. That folder is the
          only place the Connector reads and writes. The app builds the prompt at the moment you copy it, so every copy hands out its own id and its own folder.
          <strong> Files the Connector uses</strong>, under the prompt, lists each file it reads or writes, who writes it, and what it holds.
        </p>
        <p>
          Several copies or versions of BotsEverywhere on one computer? Their Connectors have different names in Grok Bot. Copy the prompt from the copy you want Grok Bot
          to use. If you set up an older Connector named only <strong>{CONNECTOR_BOT_NAME}</strong>, delete it in Grok Bot once the new one has run.
        </p>
        <h3>What the Connector does on each run</h3>
        <p>The Connector moves data and carries out the app&apos;s to-do list. It never decides what to change in a bot.</p>
        <ol>
          <li>
            <strong>It reads Grok Bot.</strong> It writes <code>orgs/grok-data.json</code> with what it can see now: every bot with its id, name, link, and instructions; each bot&apos;s
            messages in the last 30 days and when it was last active; routines where Grok Bot shows them; the skills in Grok Bot&apos;s shared library; and who each bot&apos;s own
            instructions say it reports to.
          </li>
          <li>
            <strong>It reports in.</strong> Last, it writes <code>orgs/connector.json</code> with the time of the run, the interval it runs at, and the apps connected to your
            Grok Bot account, by name and status only. The time this file was written is the Connector&apos;s last run.
          </li>
          <li>
            <strong>The app works out the changes.</strong> From that report and your files, the app writes each organization&apos;s <code>grok/snapshot.json</code>, the list of bots in
            no organization, and <code>orgs/connector-todo.json</code>: exactly what to send to each bot.
          </li>
          <li>
            <strong>It carries out the to-do list.</strong> It creates the bots you asked for, updates each bot&apos;s BotsEverywhere block, saves skills to Grok Bot&apos;s library, and
            asks bots to create or change routines. It records every result in <code>orgs/connector-results.json</code>. An item that fails twice shows as stuck in the Sync drawer.
          </li>
        </ol>
        <p>
          Each bot gets one BotsEverywhere block per organization at the end of its instructions. The block names its managers, its team, the skills to use, its seat and
          process files, and how to log. A bot then reads its seat file and process files before each routine, appends one line to <code>log/YYYY-MM-DD.md</code> after every
          step and every chat, and keeps its own profile file in <code>profiles/</code> with its routines, skills, and the apps it uses. Its own text outside the block is never changed.
          The Connector&apos;s own log lines use the bot field {CONNECTOR_LOG_BOT}.
        </p>
        <p>
          Messages to bots, such as a routine request or a profile ask, go out on the Connector&apos;s next run; the Sync drawer counts what is queued. If your Connector
          does not send them from its runs, say <strong>Send the waiting items</strong> in its chat in Grok Bot.
        </p>
        <p>
          A bot belongs to an organization when the Connector created it from that organization&apos;s requests, when its link matches a seat there, or when its name matches a seat title there.
          The Connector never edits <code>org.md</code>, <code>seats/</code>, <code>processes/</code>, <code>work-chart.md</code>,{' '}
          <code>grok/requests.json</code>, or <code>project.json</code>; the app owns those files.
        </p>
        <h3>Connection status</h3>
        <ul>
          <li>
            <strong>Connected</strong>: the Connector ran within three of its intervals: {STALE_AT_DEFAULT} at the default, {STALE_AT_HOUR} if it runs every hour.
            Grok Bot does not run it on an exact clock, so a run a few minutes late is normal. The header shows the time of the last run under the state.
          </li>
          <li><strong>Not connected</strong>: no Connector has written to this folder yet.</li>
          <li><strong>Stopped</strong>, or <strong>Disconnected</strong> in the header: three of its intervals passed without a run.</li>
          <li><strong>Error</strong>: <code>orgs/connector.json</code> is there but cannot be read.</li>
          <li>Click the status in the header for <strong>Runs every</strong>, the last sync, and when the next one is due.</li>
        </ul>
        <p>
          A <code>grok-data.json</code> the app cannot read changes nothing; the Sync drawer says why. The prompt below shows its shape with placeholders and the default interval.
          Copy the real one from <strong>Connect bots</strong>, which has your id, your folder, and your interval filled in.
        </p>
        <CodeBlock label="Connector prompt">{connectorBootstrapPrompt({ id: '<id>', orgsFolder: '<project folder>/orgs' })}</CodeBlock>

        <h2 id="set-up-org">Step 2: Set up your organization</h2>
        <p>
          Choose <strong>Open your org</strong> in the header. With one organization on this computer it opens that one; with several you pick one or create a new one.
          On the <strong>Connect bots</strong> tab, Step 2 offers two ways to fill an organization. You can do this before or after Step 1.
        </p>
        <ul>
          <li>
            <strong>Option 1: Import from your Grok Bot.</strong> After the Connector&apos;s first run, <strong>Import from the Connector</strong> brings in every bot it read in Grok Bot.
            There is nothing to paste or download. Each bot comes in under the managers you gave it in BotsEverywhere, which the Connector keeps in a BotsEverywhere block in its
            instructions, also from an earlier copy of BotsEverywhere for an organization with the same name. A bot without one goes under the manager its own instructions name,
            or under You. Bots already working in another organization come in greyed; see <To id="one-org">One bot, one organization</To>.
          </li>
          <li><strong>Option 2: Import from a template .json (build an organization from an interview with an LLM).</strong> Copy the prompt and give it to any AI together with the downloaded template. The AI asks about your organization, shows the bots it proposes, and writes the file once you confirm; then import it. The template carries the same instructions, so an AI given only the file does the same, and it explains every field, so you can also fill it in yourself.</li>
        </ul>
        <p>When you import a file, the preview shows who each bot will report to, exactly as it will be saved. Nothing is written until you confirm, and a bot that already has a file is saved beside it, never over it.</p>
        <p>
          These options are for an organization with no bots yet. Once it has bots, importing again is off, because it would add a second copy of each bot. Your main bot and
          the Connector do not count. Step 2 then offers <strong>Add a seat</strong>, <strong>Bot directory</strong>, and <strong>Export bots file</strong>.
          New bots from Grok Bot arrive through <strong>Sync with Grok Bot</strong>.
        </p>
        <p>
          To start from a sample, open <a href="#/templates">Templates</a>, pick one, and choose <strong>Use this template</strong>. It is copied into a new folder under <code>orgs/</code>;
          the sample itself stays read-only.
        </p>

        <h2 id="org-chart">Org chart</h2>
        <p>The org chart shows your bots and who each one reports to: you, or another bot.</p>
        <ol>
          <li>Open the <strong>Org Chart</strong> tab of your organization.</li>
          <li>
            Choose <strong>Add a seat</strong>. It sits above the chart, next to <strong>Hire from the directory</strong>, on every organization of your own.
          </li>
          <li>Fill in <strong>Short name</strong> (like <strong>Invoice Bot</strong>; the seat file becomes <code>invoice-bot.md</code>) and <strong>Title</strong>, set <strong>Kind</strong> to <strong>Bot</strong>, and pick <strong>Reports to</strong>.</li>
          <li>Choose <strong>Add seat</strong>. The seat file is written, and the chart re-reads it from disk.</li>
        </ol>
        <p>
          Drag the background to move around, use the mouse wheel or the − and + buttons to zoom, and <strong>Fit</strong> to see the whole chart. <strong>Find seat</strong> jumps to a bot by name,
          and <strong>Download PNG</strong> saves the chart as an image.
        </p>
        <p>
          The legend counts your bots. <strong>In Grok Bot</strong> counts every bot in your Grok Bot account, and its list says where each one sits.
        </p>
        <p>
          <strong>Retired</strong> in the legend lists every bot you retired, with the date. Retire takes a bot out of this organization only; it keeps
          running in Grok Bot. Grok Bot does not let the Connector delete bots, so you delete one there: <strong>Delete in Grok Bot</strong> on its row opens the bot,
          then right-click it in the Grok Bot sidebar, choose Delete, and confirm. The row warns you when another organization still has the bot active, and says <strong>Deleted from Grok Bot</strong>
          {' '}after the Connector&apos;s next run no longer lists it. Retire a bot before you delete it in Grok Bot, or its card shows Not in Grok Bot.
        </p>
        <p>On your own organizations, each bot card shows what the app knows about it in Grok Bot:</p>
        <ul>
          <li><strong>In Grok Bot</strong>, green: the last sync saw it, or the seat has a Grok Bot link.</li>
          <li><strong>New in Grok Bot</strong>: a sync created this seat from a bot in Grok Bot.</li>
          <li><strong>Not in Grok Bot</strong>, dashed: the last snapshot did not include it.</li>
          <li><strong>Not synced yet</strong>, muted: nothing is known yet.</li>
          <li><strong>Greyed</strong>: the bot works for another organization. See <To id="one-org">One bot, one organization</To>.</li>
        </ul>
        <p>
          To move a bot under another manager, open it and change <strong>Reports to</strong>. <strong>Also reports to</strong> adds extra managers, drawn as dotted lines.
          The app refuses a change that would make a bot report to itself or loop. When the bot is already in Grok Bot, the new manager is sent to it on the Connector&apos;s next run.
        </p>

        <h2 id="one-org">One bot, one organization</h2>
        <p>
          A bot works for one organization. Two bots are the exception and belong in every organization: the Connector, and your main bot.
          The app tells bots apart by the id in their Grok Bot link, never by name.
        </p>
        <p>
          When an import finds a bot that already works in another organization, the bot comes in <strong>greyed</strong>. It is on the chart, under the managers it has where it
          works when they are here, but nothing about it is sent to Grok Bot: it gets no block, no Sync row, and no <strong>Create in Grok Bot</strong>. A bot that works here never
          reports to a greyed one. It waits under You and moves under that bot once it starts working here, unless you moved it since.
        </p>
        <p>Open a greyed bot to choose what to do with it:</p>
        <ul>
          <li><strong>Move it here</strong>: takes it out of the other organization, where it is retired, and makes it work here. The bots that reported to it there move under its manager there.</li>
          <li><strong>Rename and publish in Grok Bot</strong>: a new bot with a new name works here, and the Connector creates it. The original stays where it is.</li>
          <li><strong>Remove</strong>: takes the seat off this chart. The bot keeps working where it is.</li>
          <li><strong>It&apos;s my main bot</strong>: shown while no main bot is saved. Your main bot works in every organization, so it is never greyed.</li>
        </ul>
        <p>
          While no main bot is saved and the organization has a greyed bot, the Org Chart asks <strong>Which bot is your main bot?</strong> above the chart. Pick one and choose
          {' '}<strong>It&apos;s my main bot</strong>, or choose <strong>Not now</strong> to hide the question for that organization in this browser. The choice is saved in <code>orgs/project.json</code>.
        </p>

        <h2 id="seat-cards">Seat cards and Profile</h2>
        <p>Every bot has a seat card with four sections. They are what the bot is told about its place in the organization.</p>
        <ul>
          <li><strong>Owns</strong>: what this bot is responsible for.</li>
          <li><strong>May</strong>: what it can do without asking.</li>
          <li><strong>Needs approval</strong>: what it must ask before doing.</li>
          <li><strong>Done when</strong>: what finished looks like.</li>
        </ul>
        <p>
          Each seat is one file, <code>orgs/&lt;slug&gt;/seats/&lt;short-name&gt;.md</code>: frontmatter, then those four sections. Saving never deletes a seat file;
          to remove a bot, retire it from its drawer. Its history stays in the logs.
        </p>
        <CodeBlock label="seats/research.md">{`---
title: Research
department: delivery
reportsTo: you
addToGrokBotUrl: ""
status: active
kind: bot
role: Briefs
personId: ""
hiredAt: ""
retiredAt: ""
directoryId: ""
---

## Owns
Source briefs for each new request.

## May
Read public sources and the request.

## Needs approval
Anything sent outside the organization.

## Done when
The brief is filed and linked on the request.`}</CodeBlock>
        <h3>Profile</h3>
        <p>
          The seat drawer has three tabs: <strong>Seat card</strong> is the bot&apos;s place in the organization, <strong>Profile</strong> is how it works, and
          {' '}<strong>Performance</strong> is its numbers. What Profile shows depends on where the bot came from:
        </p>
        <ul>
          <li>A bot hired from the directory shows its category, summary, and prompt. You can edit the prompt after hiring.</li>
          <li>A bot imported from Grok Bot says it is not in the directory and was imported from Grok Bot. Its prompt stays in Grok Bot.</li>
          <li>A bot added with <strong>Add a seat</strong> gets <strong>Instructions for Grok Bot</strong>: the prompt Grok Bot gets when the bot is added there.</li>
        </ul>
        <p>
          Every bot of your own takes <strong>Skills</strong> and <strong>Routines</strong>. A skill is a name and what it does. A routine is a card: <strong>Name</strong>,
          {' '}<strong>Description</strong>, <strong>Starts</strong> on a <strong>Schedule</strong> (a cron line, with <strong>Presets</strong> and the schedule in plain words) or on an
          {' '}<strong>Event</strong> (a short rule, like Mentions in #support), its <strong>Time zone</strong>, and whether it is <strong>Active</strong> or <strong>Paused</strong>.
          Choose <strong>Done</strong> to close it. A routine&apos;s description is only an outline: keep its full instructions in Grok Bot, and leave tokens and private links out of every rule. <strong>Apps used</strong> lists the connected apps the bot reports it uses.
        </p>
        <p>
          <strong>Update bot</strong>, on a bot already in Grok Bot, sends its skills and routines on the Connector&apos;s next run. Skills go to the library every bot shares.
          Each waiting change shows on its own line until Grok Bot confirms it. Skills and routines merge by name: Grok Bot updates its own, the ones you added stay, and nothing is dropped.
        </p>
        <p>
          A bot with a public link in Grok Bot shows <strong>Get this bot</strong>. You make public links in Grok Bot; the app and the Connector never make or change one.
        </p>
        <h3>Create in Grok Bot</h3>
        <p>
          A bot that is not in Grok Bot yet shows <strong>Create in Grok Bot</strong> in its drawer: the app asks the Connector to create it on its next run, with its Profile
          prompt, skills, and routines. Until then its Performance row and the Sync drawer say it is connecting; when the Connector reports it, its link lands on its own and the request is done.
          To link a bot by hand instead, create it in Grok Bot from the card, copy its share link (<code>https://x.ai/bot/…</code>), and paste it into the seat.
          Leave the link empty until you have a real one.
        </p>

        <h2 id="work-chart">Work Chart</h2>
        <p>
          The Work Chart shows how work moves between your bots. Each process is one lane: a trigger, the steps in order, and when the work is done.
          The folder of process files is the chart; there is no index file.
        </p>
        <p>A trigger is one of three kinds:</p>
        <ul>
          <li><strong>Schedule</strong>: a time, such as <code>Mon 09:00</code>, or a cron line. A schedule that fires more than once an hour shows a warning.</li>
          <li><strong>Event</strong>: email, Slack, GitHub, a webhook, or a form, with a short description.</li>
          <li><strong>Manual</strong>: started by hand.</li>
        </ul>
        <p>
          Each step names a bot and a short action. An arrow between steps owned by different bots is a handoff. <code>next</code> names the process this one hands off to.
        </p>
        <p>
          A step whose action starts with <code>Needs approval:</code> waits for you. The lane marks it <strong>Needs your approval</strong>, and the bot writes status <code>waiting</code> and asks before it continues.
          Work that matches no process goes to the fallback process, <code>triage</code> unless <code>org.md</code> sets <code>fallbackProcess</code>, owned by You.
        </p>
        <p>Each process is one file, <code>orgs/&lt;slug&gt;/processes/&lt;name&gt;.md</code>:</p>
        <CodeBlock label="processes/invoice-arrives.md">{`---
name: Invoice arrives
trigger: event
source: email
description: A supplier invoice lands in the inbox.
doneWhen: The invoice is matched and payment is approved or sent back.
---

## Steps

- finance-bot | Match the invoice to the open bill
- you | Approve payment

## Notes

Plain notes for whoever reads the file.`}</CodeBlock>
        <ul>
          <li><strong>Import processes from Grok Bot</strong> reads the routines and handoffs Grok Bot runs from a JSON file and writes one file per flow. Importing again replaces each flow with Grok Bot&apos;s latest version. An unknown seat name is reported and kept as written.</li>
          <li><strong>Delete</strong> removes a flow from this Work Chart only and never changes Grok Bot. It asks first.</li>
          <li><strong>Routines without a flow</strong> lists the routines your bots run in Grok Bot that no process on this chart describes.</li>
        </ul>
        <p>
          While bots run, each step shows its latest status, with an activity feed and a <strong>Needs your approval</strong> list. Click a step to open its seat card.
          On the org chart, <strong>See its work</strong> opens the Work Chart with that bot&apos;s steps highlighted.
        </p>

        <h2 id="sync">Sync with Grok Bot</h2>
        <p>
          <strong>Sync with Grok Bot</strong>, on the organization&apos;s tab row, shows what changed since the last sync and applies it when you choose <strong>Sync</strong>.
          A number on the button means there is something to review. The drawer has two sides.
        </p>
        <h3>Coming from Grok Bot</h3>
        <ul>
          <li>New bots become seats marked New.</li>
          <li>
            Matched bots take their link from Grok Bot; their numbers (last active, runs, tasks, routines) apply on their own on every Connector run, so Performance never waits for Sync.
            Your managers, step assignments, and filled card sections are kept. Skills, routines, apps, and public links come from Grok Bot too.
          </li>
          <li>New routines become processes.</li>
          <li>A bot that left Grok Bot is tagged Not in Grok Bot. <strong>A sync never deletes a seat.</strong></li>
          <li>
            <strong>In Grok Bot, no organization</strong> lists bots that run in Grok Bot but belong to no organization in this folder. Tick one to add it to the organization you have open.
          </li>
          <li>Greyed bots stay out of Sync; they belong to the organization they work for.</li>
        </ul>
        <h3>Going to Grok Bot</h3>
        <ul>
          <li>Every active bot Grok Bot does not have yet is listed, including bots on a template copy or a hand-built chart. Tick the ones to create; the Connector creates them on its next run.</li>
          <li>Changes waiting for the Connector, such as <strong>Update bot</strong> or a new manager, show one line each.</li>
          <li>
            What the Connector could not do shows here too: items stuck after two tries, with the reason; items on their second try; items it has not acted on for more than
            two runs; a <code>grok-data.json</code> it could not read; and instructions another copy of BotsEverywhere added to your bots, with <strong>Remove old instructions</strong>.
            Remove those instructions only if that copy is gone. It changes only those instructions, bot by bot: your bots, and your own text in them, stay as they are.
            A copy whose Connector is no longer in Grok Bot says so, and <strong>Remove all old instructions</strong> cleans every such copy at once.
          </li>
          <li>
            Grok Bot keeps one bot per name. If another organization in the folder already has a bot with the same name, the drawer says it will be created as, for example,
            {' '}<strong>Invoice Bot · Meridian Ledger Partners</strong>. The next sync matches that name back to the right seat.
          </li>
          <li>
            Grok Bot limits how many bots one account can have. It is not an official number; we recommend up to {GROK_BOT_LIMIT}. Every organization in the folder shares one
            Grok Bot account, so the drawer counts all of their bots and warns past {GROK_BOT_LIMIT}. It never stops you.
          </li>
        </ul>
        <p>
          Do not want to wait for the next run? <strong>Run the Connector now</strong> copies a message: paste it into Grok Bot and the Connector runs right away. The drawer updates when it finishes.
        </p>

        <h2 id="directory">Bot directory</h2>
        <p>
          The <a href="#/directory">Bot directory</a> is a shared catalog of ready-made bots. Filter by category, then open a bot: each page has its prompt, its seat card, and a suggested trigger.
        </p>
        <ul>
          <li><strong>Hire into team</strong> adds the bot as a seat in the organization you choose, with <code>directoryId</code> and <code>hiredAt</code> set.</li>
          <li><strong>Add to Grok Bot</strong> appears only when the bot has a published Grok Bot link, and opens it in a new tab. Otherwise the page shows <strong>Copy prompt</strong>.</li>
        </ul>
        <p>A few shipped bots already have a link. None of them are endorsed.</p>

        <h2 id="hiring">Hiring</h2>
        <HiringGuide />

        <h2 id="performance-logs">Performance and Logs</h2>
        <p>
          <strong>Performance</strong> lists each bot with when it was created, the times it was used and the automated tasks it finished in the last 30 days, when it was last active,
          its skills, and the apps it uses. The Connector briefs these numbers: on every report, a bot whose last-active time moved since the previous report counts one use, and a
          routine whose last run moved counts one automated task. The app writes each one to the run log, noted <em>seen by the Connector</em>. A bot that logs its own chats
          (process <code>chat</code>) or routine steps keeps its own, more detailed lines, and the same moment is never counted twice. Several uses between two Connector runs count as one.
          The numbers come from the run log and from Grok Bot; the app never estimates them.
        </p>
        <p>
          Grok Bot shows a bot&apos;s routines only to that bot, so <strong>Automated tasks done</strong> and the apps and skills a bot reports come from a profile file each bot writes
          into the organization&apos;s folder on its own runs. The status block at the top of Performance says whether the Connector runs and how many bots have reported.
          A bot that has not reported yet is asked for its report on the Connector&apos;s next run, by itself; <strong>Sync bots</strong> asks every bot again at any time.
          The columns fill in as the files land. Until a bot has written one, <strong>Apps used</strong> and <strong>Skills</strong> show what the Connector read in Grok Bot.
        </p>
        <p>
          <strong>Logs</strong> lists every event of the organization, newest first: hires, retirements, edits, work, approvals, and exceptions, and everything that passes
          between the app and Grok Bot. Each line has a label, and its figures show as small tiles under it. The <strong>Show</strong> menu narrows it to Grok Bot and the
          Connector, or to team and work. A <strong>From Grok Bot</strong> or <strong>To Grok Bot</strong> badge shows which way a change went; a step chip jumps to that step on the Work Chart.
        </p>
        <p>
          A <strong>To Grok Bot</strong> line that is still waiting says where its request stands, and the newest line for that bot lists each part: create the bot, its instructions,
          each skill, and each routine. A part is waiting for the Connector&apos;s next run, waiting for the bot to confirm, done in Grok Bot and confirming
          on the next reading, confirmed in Grok Bot, failed once and trying again, or stuck and needing you.
        </p>
        <p>What the Connector does is logged in every organization, while <code>npm run dev</code> is running:</p>
        <ul>
          <li><strong>Connected</strong>: the first run in this folder, or the first run after a stop, with how long it was down.</li>
          <li><strong>Bot connected</strong>: each bot the Connector reports for the organization for the first time, with its routines and 30-day numbers.</li>
          <li><strong>Bot left</strong>: a bot that was in Grok Bot on the last run and is gone now.</li>
          <li><strong>Connector</strong>: one line per day, updated on every run: runs today, first and last run, bots in Grok Bot, requests waiting, and bots with no organization. <strong>Each run</strong> under it lists every run that day, newest first, with its time and figures.</li>
          <li><strong>Stopped</strong>: three of the Connector&apos;s intervals passed without a run, with the time of its last run.</li>
          <li><strong>Error</strong>: the Connector wrote a file the app cannot read, and why.</li>
          <li><strong>Apps</strong>: an app connected to your Grok Bot account, one that needs signing in again, or one that left; and a bot that starts or stops using an app.</li>
          <li><strong>Request</strong>, <strong>Created</strong>, <strong>Deleted</strong>, <strong>Sync</strong>, and <strong>Added</strong>: bots you sent to Grok Bot, bots it created, retired bots gone from Grok Bot after you deleted them there, confirmed syncs with the bots they changed, and bots added from the no-organization list.</li>
        </ul>
        <p>The run log is one file per day, <code>log/YYYY-MM-DD.md</code>, starting with <code># Run log YYYY-MM-DD</code>, then one line per routine step:</p>
        <p><code>- HH:MM | bot | process | step | done|failed|skipped|waiting|running | note or -</code></p>
        <p>and one line each time someone uses the bot in a chat:</p>
        <p><code>- HH:MM | bot | chat | what it was asked, in a few words | done|failed|waiting | note or -</code></p>
        <p>A line that does not fit is skipped. Every other event is its own file in <code>log/</code>.</p>

        <h2 id="where">Files and folders</h2>
        <p>Everything lives in plain files in the project folder. Nothing is uploaded.</p>
        <h3>In each organization, <code>orgs/&lt;slug&gt;/</code></h3>
        <ul>
          <li><code>org.md</code>: the organization fields and the org chart (who reports to whom).</li>
          <li><code>seats/&lt;short-name&gt;.md</code>: one file per bot.</li>
          <li><code>processes/&lt;name&gt;.md</code>: one file per process. <code>work-chart.md</code> is still read when it is present.</li>
          <li><code>log/</code>: the daily run logs, which your bots write, and one file per event.</li>
          <li><code>profiles/</code>: each bot&apos;s own profile file, which the bot writes: its routines, skills, and apps.</li>
          <li><code>grok/</code>: <code>snapshot.json</code>, the bots Grok Bot has for this organization, and <code>requests.json</code>, what the app asked the Connector to do.</li>
        </ul>
        <h3>Beside the organizations, in <code>orgs/</code></h3>
        <ul>
          <li><code>project.json</code>: this copy&apos;s id, how often the Connector runs, and your main bot. The app writes it.</li>
          <li><code>CONNECTOR.md</code>: the Connector&apos;s rules and schedule. The app writes it; the Connector reads it on every run.</li>
          <li><code>grok-data.json</code> and <code>connector.json</code>: what the Connector saw in Grok Bot, and its last run. The Connector writes them.</li>
          <li><code>connector-todo.json</code>: what the Connector still has to do, written by the app. <code>connector-results.json</code>: what it did, written by the Connector.</li>
          <li><code>grok-unassigned.json</code>: bots in Grok Bot that belong to no organization.</li>
          <li><code>connector-backups/</code>: each bot&apos;s instructions from before the Connector changed them.</li>
          <li><code>connector-log.json</code>: what the app already logged about the Connector, so no run is logged twice.</li>
        </ul>
        <h3>In the project</h3>
        <ul>
          <li><code>directory/</code>: the shared bot catalog, one file per bot. It is not inside an organization.</li>
          <li><code>samples/</code>: the read-only templates.</li>
        </ul>
        <p>
          Every reader accepts files saved with a byte-order mark or Windows line endings. A file that cannot be read is skipped, and the terminal names it once; the rest of the organization keeps working.
          The writer&apos;s root is the <code>ORGS_DIR</code> environment variable, or <code>./orgs</code>.
        </p>

        <h2 id="files">Import and export</h2>
        <p>
          <strong>Backup</strong>, a tab on every organization, has <strong>Export</strong>, <strong>Import zip</strong>, and <strong>Import folder</strong>.
          Export downloads the whole organization as a zip: <code>org.md</code>, <code>work-chart.md</code>, the seats, the processes, the log events, and the daily run logs.
          It leaves out <code>grok/</code>, which the Connector rewrites on every run. Import replaces those files in the same folder, and the pages re-read them.
          A zip exported by an older version has no processes or run logs; importing it keeps the ones you have.
        </p>
        <p>
          <strong>Export bots file</strong>, on the <strong>Connect bots</strong> tab once an organization has bots, and <strong>Import bots file</strong>, in Option 2, use one
          JSON file, <code>botseverywhere-bots.json</code>. Export builds it from the seat files; import reads it back into an organization with no bots yet. Each bot can name
          who it reports to, main and extra. The format is in <code>docs/bots-file.md</code>.
        </p>
        <p>
          To keep history, commit <code>orgs/</code> with Git in a private repository of your own. The project ignores <code>orgs/</code> because it is your own data,
          so add it with <code>-f</code>:
        </p>
        <CodeBlock>{`git add -f orgs
git commit -m "Update the org chart"`}</CodeBlock>

        <h2 id="add-your-own-bot">Add your own bot</h2>
        <ol>
          <li>Copy a file in <code>directory/</code> to <code>directory/&lt;slug&gt;.md</code>. Use a lowercase slug with hyphens, and put the same slug on its <code>slug</code> line.</li>
          <li>
            Edit the prompt, which is the body of the file, and the seat card: <code>owns</code>, <code>may</code>, <code>mustAskBefore</code>, and <code>doneWhen</code>, with items
            separated by a pipe. Set the category, the one-line summary, and the trigger. Leave <code>addToGrokBotUrl</code> as <code>null</code>.
          </li>
          <li>In Grok Bot, create a bot with that prompt and publish it. Copy its link (<code>https://x.ai/bot/…</code>).</li>
          <li>Replace <code>null</code> in <code>addToGrokBotUrl</code> with that link.</li>
        </ol>
        <p><code>directory/PUBLISH-QUEUE.md</code> lists the bots that still have no link. It is not a bot.</p>

        <h2 id="other-platforms">Other bot platforms</h2>
        <p>
          Today BotsEverywhere runs on Grok Bot: the Connector, the directory&apos;s <strong>Add to Grok Bot</strong> links, and the sync all use it underneath.
          Bots from other platforms, such as OpenAI&apos;s GPTs, are not connected yet. Support for more platforms is planned.
        </p>
        <p>
          Because the project is open source, you can adapt it now. Everything the app knows lives in plain files with documented formats: seat files, process files,
          the run log, and the snapshot. A connector for another platform has to do what the Grok Bot Connector does: report what it sees, carry out the app&apos;s to-do list,
          and have each bot append to the run log. The Connector&apos;s prompt, its rules, and the snapshot format are in <code>server/src/connector-prompt.ts</code>.
          Contributions are welcome.
        </p>

        <h2 id="example">Worked example</h2>
        <p>
          Open <a href="#/template/botseverywhere/org-chart">botseverywhere</a> under Templates: the project&apos;s own team, read-only.
          <strong> Grok Bot</strong> is the main bot, and thirteen bots report to it, from Planning Bot to Design Bot.
        </p>
        <p>
          Its <a href="#/template/botseverywhere/work-chart">Work Chart</a> has four processes: Invoice arrives, New request, Weekly campaign brief, and Daily brief.
          Those lanes use Finance Bot, Product Bot, Marketing Bot, and Planning Bot.
        </p>
        <p>
          Your own chart starts smaller, with <strong>You</strong> at the top. Add the bots you need, set who they report to, hire bots that already have a prompt from the{' '}
          <a href="#/directory">Bot directory</a>, then <To id="connect-grok">connect Grok Bot</To> and <To id="sync">sync</To>.
        </p>

        <h2 id="troubleshooting">Troubleshooting</h2>
        <h3>The page says saving is off</h3>
        <p>The file writer is not running. Stop <code>npm run dev</code> and start it again, then repeat the change.</p>
        <h3>The file writer needs a restart</h3>
        <p>The app was updated while it was running. The writer does not reload by itself: stop <code>npm run dev</code> and start it again.</p>
        <h3>The page still shows the old version</h3>
        <p>Reload the page (F5). A change that failed to load can leave the old page in the tab until you do.</p>
        <h3>The bar says Not connected</h3>
        <p>
          Grok Bot has not written to this folder yet. Check that you pasted the prompt from <strong>Connect bots</strong> of this copy. The Connector runs once as soon as it is
          set up; if you just pasted it, give Grok Bot a minute.
        </p>
        <h3>The bar says Connector stopped</h3>
        <p>
          Three of its intervals passed without a run. Check in Grok Bot that the Connector still exists and that its routine runs as often as <strong>Runs every</strong> on
          Connect bots says. <strong>Run the Connector now</strong> in the Sync drawer starts a run by hand.
        </p>
        <h3>Asks to bots stay queued run after run</h3>
        <p>The Connector sends messages to bots on its runs. If the Sync drawer keeps counting the same asks, open the Connector&apos;s chat in Grok Bot and say <strong>Send the waiting items</strong>.</p>
        <h3>A bot shows Not in Grok Bot</h3>
        <p>The last snapshot did not include it. Open the bot and choose <strong>Create in Grok Bot</strong>, or tick it under Going to Grok Bot in the Sync drawer.</p>
        <h3>A bot is greyed</h3>
        <p>It works for another organization. Open it to move it here, publish a renamed copy, remove it, or make it your main bot. See <To id="one-org">One bot, one organization</To>.</p>

        <h2 id="faq">FAQ</h2>
        <h3>Is my data uploaded?</h3>
        <p>No. Everything is written to the <code>orgs</code> folder on the computer running the app. Only the Connector and your bots, in your own Grok Bot, read it.</p>
        <h3>Do I need an account?</h3>
        <p>No. There is no sign-up and no team to create.</p>
        <h3>How often does the Connector run?</h3>
        <p>
          As often as you set. <strong>Runs every</strong> on Connect bots takes anything from {MIN_EVERY} to {MAX_EVERY}; {DEFAULT_EVERY} is the default. The Connector switches on its
          next run, with nothing to paste again.
        </p>
        <h3>Can I have several organizations?</h3>
        <p>Yes. Each is a folder in <code>orgs/</code>, and one Connector serves all of them. Switch with the organization menu on the tab row.</p>
        <h3>Can one bot work in several organizations?</h3>
        <p>No. A bot works for one organization; the Connector and your main bot are the exceptions. See <To id="one-org">One bot, one organization</To>.</p>
        <h3>Can I run several copies of BotsEverywhere?</h3>
        <p>Yes. Each copy has its own id, its own folder, and its own Connector. See <To id="connect-grok">Step 1: Connect Grok Bot</To>.</p>
        <h3>Does it work on phones?</h3>
        <p>
          Not officially. BotsEverywhere is built for desktop browsers, {DESKTOP_MIN_WIDTH}px wide and up, because the org chart, the Work Chart, and the logs need the room.
          It is open source, so you can adapt the layout to your needs.
        </p>
        <h3>Does it work with bots other than Grok Bot?</h3>
        <p>Not yet. It is built on Grok Bot today, and it is open source, so it can be adapted. See <To id="other-platforms">Other bot platforms</To>.</p>

        <h2 id="license">License</h2>
        <p>
          BotsEverywhere is open source under the <strong>MIT License</strong>. The copyright notice is in <code>LICENSE</code>. In package terms the license is <code>MIT</code>.
        </p>
        <h3>What MIT means</h3>
        <ul>
          <li>Use, modify, distribute, and sell it, including commercially</li>
          <li>Keep the copyright notice and the license text with every copy</li>
          <li>No need to mark the files you change</li>
          <li>No warranty, no liability for the authors</li>
        </ul>
        <p>
          Using and changing BotsEverywhere inside your own organization asks nothing extra of you. The conditions above apply when you share copies.
          The BotsEverywhere name and logo are not covered by the license.
        </p>
        <h3>Contributions</h3>
        <p>
          Unless you say otherwise, any contribution you intentionally submit for inclusion in BotsEverywhere is licensed under the MIT License,
          without any additional terms or conditions.
        </p>
        <p>
          This summary is for reading convenience. The license text below is what applies: <code>LICENSE</code> at the root of the project.
        </p>
        <h3>MIT License</h3>
        <div className="docs-license-text" role="region" aria-label="MIT License text" tabIndex={0}>{MIT_TEXT.trim()}</div>
      </article>
    </main>
  )
}
