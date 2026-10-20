import { useEffect, useState, type ReactNode } from 'react'
import { CodeBlock } from '../components/CodeBlock.tsx'
import { GROK_BOTS_PROMPT } from '../content/grok-bots-prompt.ts'
import { CONNECTOR_BOT_NAME, CONNECTOR_LOG_BOT, connectorPrompt } from '../../server/src/connector-prompt.ts'
import { HiringGuide } from '../content/HiringGuide.tsx'
import { GROK_BOT_LIMIT } from '../components/sync-copy.ts'
import { DESKTOP_MIN_WIDTH } from '../content/screen-notice.ts'
// The same file that ships with the project, so the page and the license never disagree.
import LICENSE_TEXT from '../../LICENSE-APACHE?raw'
import MIT_TEXT from '../../LICENSE-MIT?raw'
import NOTICE_TEXT from '../../NOTICE?raw'

const repoUrl = import.meta.env.VITE_REPO_URL || '<this-repository-url>'

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
      ['seat-cards', 'Seat cards'],
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
            BotsEverywhere is an open source team management tool for bots. Organizations use it to map their people and bots in one place:
            an org chart, a work chart of who does what and when, and a directory of ready-made bots they can add to Grok Bot.
            It runs on your own computer, and your data stays there.
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
              <li>The <code>orgs</code> folder: org charts, seats, processes, logs</li>
            </ul>
          </div>
          <div className="docs-flow-link" aria-hidden="true">
            <span>Connector</span>
            <span className="docs-flow-arrow" />
            <span>every 15 minutes</span>
          </div>
          <div className="docs-flow-side is-grok">
            <p className="docs-flow-name">Grok Bot</p>
            <ul>
              <li>Your bots and their routines</li>
              <li>Run on your own Grok Bot account</li>
            </ul>
          </div>
          <figcaption>The Connector is the only link between the two, and you create it yourself.</figcaption>
        </figure>
        <p>BotsEverywhere has three parts. Each does one job.</p>
        <ul>
          <li>
            <strong>The app</strong> runs on your computer. <code>npm run dev</code> starts the site at <code>http://127.0.0.1:5199</code> and a small
            file writer that only this computer can reach. Every change you make is saved as a plain markdown file.
          </li>
          <li>
            <strong>The <code>orgs</code> folder</strong> holds your organizations, one folder each: the org chart, the seats, the processes, and the logs.
            Nothing is uploaded. You can open, edit, back up, or commit these files yourself.
          </li>
          <li>
            <strong>Grok Bot</strong> runs the bots. One bot there, the Connector, reads and writes the <code>orgs</code> folder every 15 minutes.
            It creates the bots you ask for, keeps their routines in step with your processes, and reports back what each bot did.
          </li>
        </ul>
        <p>
          You plan the work in the app; the bots do it in Grok Bot; the Connector carries everything between the two. You can build an org chart
          before the Connector is set up, but nothing reaches Grok Bot until it runs. The bar at the top of every organization page says whether it is connected.
        </p>
        <p>There are no accounts, no sign-up, no paid services, and no API keys.</p>

        <h2 id="security">Security and privacy</h2>
        <p>
          BotsEverywhere is built to keep your organization on your own computer. There is no BotsEverywhere server, account, or cloud copy of your data,
          so there is nothing of yours for us to lose or expose.
        </p>
        <ul>
          <li><strong>Local only.</strong> The site and the file writer listen on <code>127.0.0.1</code>, the address only your own computer can reach. The writer refuses to start on any other address, and only lets pages served from this computer read its answers.</li>
          <li><strong>Plain files you own.</strong> Your org chart, seats, processes, and logs are markdown files in <code>orgs/</code>. You can read every one of them, back them up, or delete them.</li>
          <li><strong>No tracking.</strong> The app has no analytics, no telemetry, and no third-party scripts. Its fonts ship with it, so opening a page loads nothing from the internet.</li>
          <li><strong>No keys.</strong> The app stores no passwords, tokens, or API keys, and never asks for one.</li>
          <li><strong>One connection, and you set it up.</strong> The only link to the outside is the Connector you create in your own Grok Bot account. It reads and writes the <code>orgs</code> folder named in its prompt and nothing outside it.</li>
        </ul>
        <h3>What leaves your computer</h3>
        <p>
          Only what your Connector reads in Grok Bot: the files in <code>orgs/</code> that it needs to run your bots. That data is then handled by Grok Bot under its own terms,
          the same as anything else you give it. If you never set up a Connector, nothing leaves your computer.
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
          Your organizations are saved in <code>orgs/</code> inside the project folder. The starter organization is <code>orgs/your-company/</code>, with one seat, <strong>You</strong>.
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
          <li>Open any organization and choose the <strong>Connect bots</strong> tab. Step 1 shows the Connector name, the folder it uses, and its status.</li>
          <li>Choose <strong>Copy Connector prompt</strong>.</li>
          <li>Paste it into Grok Bot. Grok Bot creates the Connector and runs it every 15 minutes.</li>
          <li>
            Once your organizations are set up it can run less often. On <strong>Connect bots</strong>, choose <strong>Change</strong> next to <strong>Runs every</strong>,
            type a number and pick minutes, hours, or days (15 minutes to 7 days), and <strong>Save</strong>. The prompt updates; paste it into the Connector again.
          </li>
          <li>Come back to the app. After the first run the bar turns green: <strong>Connected · last run 2 min ago</strong>.</li>
        </ol>
        <h3>The Connector&apos;s name and folder</h3>
        <p>
          The first time the app starts, it gives the copy a short id, such as <code>k3f9</code>, and saves it in <code>orgs/project.json</code>.
          The Connector is named after it: <strong>{CONNECTOR_BOT_NAME} (k3f9)</strong>.
        </p>
        <p>
          The prompt names the full path of this copy&apos;s <code>orgs</code> folder, for example <code>C:\Users\you\botseverywhere\orgs</code>. That folder is the
          only place the Connector reads and writes. The app builds the prompt at the moment you copy it, so every copy hands out its own id and its own folder.
        </p>
        <p>
          Several copies or versions of BotsEverywhere on one computer? Their Connectors have different names in Grok Bot. Copy the prompt from the copy you want Grok Bot
          to use. If you set up an older Connector named only <strong>{CONNECTOR_BOT_NAME}</strong>, delete it in Grok Bot once the new one has run.
        </p>
        <h3>What the Connector does on each run</h3>
        <p>For every folder in <code>orgs</code> that has an <code>org.md</code> file, the Connector:</p>
        <ol>
          <li>Creates the bots the app asked for in <code>grok/requests.json</code>, and deletes the retired bots it asked to delete, found by their Grok Bot link.</li>
          <li>Writes <code>grok/snapshot.json</code> with the bots that belong to that organization and the routines they run.</li>
          <li>Reads <code>org.md</code>, <code>seats/</code>, and <code>processes/</code>, keeps one routine per process for the bot on its first step, and tells each bot who its manager is.</li>
          <li>Tells each bot to read its process file and seat file at the start of every run, and to append one line to <code>log/YYYY-MM-DD.md</code> after every step.</li>
        </ol>
        <p>
          Then it writes <code>orgs/connector.json</code> with the time of the run and any bots that belong to no organization. Its own log lines use the bot field {CONNECTOR_LOG_BOT}.
        </p>
        <p>
          A bot belongs to an organization when the Connector created it from that organization&apos;s requests, when its link matches a seat there, or when its name matches a seat title there.
          Each bot lands in one organization only. The Connector never edits <code>org.md</code>, <code>seats/</code>, <code>processes/</code>, <code>work-chart.md</code>,{' '}
          <code>grok/requests.json</code>, or <code>project.json</code>; the app owns those files.
        </p>
        <h3>Connection status</h3>
        <ul>
          <li><strong>Connected · last run 4 min ago</strong>: the Connector wrote within two of its runs, 30 minutes at the default interval. The header shows the time of that run under <strong>Connected</strong>.</li>
          <li><strong>Not connected</strong>: no Connector has written to this folder yet.</li>
          <li><strong>Connector stopped</strong>: it wrote before but missed two runs.</li>
          <li>Click the status in the header for how often the Connector runs, its last sync, and when the next one is due.</li>
          <li><strong>Connector ran, but its snapshot could not be read</strong>: it wrote a file the app cannot read. The organization keeps working.</li>
        </ul>
        <p>
          The prompt below shows its shape with placeholders. Copy the real one from <strong>Connect bots</strong>, which has your id and folder filled in.
        </p>
        <CodeBlock label="Connector prompt">{connectorPrompt({ id: '<id>', orgsFolder: '<project folder>/orgs' })}</CodeBlock>

        <h2 id="set-up-org">Step 2: Set up your organization</h2>
        <p>
          Choose <strong>Open your org</strong> in the header. With one organization on this computer it opens that one; with several you pick one or create a new one.
          On the <strong>Connect bots</strong> tab, Step 2 offers three ways to fill an organization. You can do this before or after Step 1.
        </p>
        <ul>
          <li><strong>Option 1: Import from your Grok Bot.</strong> Copy a prompt, ask Grok Bot for the bots you already run, and import the file it writes. See <To id="files">Import and export</To>.</li>
          <li><strong>Option 2: Import from a template .json.</strong> Download the template file, fill it in, and import it. The same panel exports the current bots.</li>
          <li><strong>Option 3: Add your organization manually.</strong> Fill in the organization fields on <strong>Organization Overview</strong>, then add seats on the <To id="org-chart">org chart</To>.</li>
        </ul>
        <p>
          To start from a sample, open <a href="#/templates">Templates</a>, pick one, and choose <strong>Use this template</strong>. It is copied into a new folder under <code>orgs/</code>;
          the sample itself stays read-only.
        </p>

        <h2 id="org-chart">Org chart</h2>
        <p>The org chart shows who owns what: people, bots, and systems, and who each one reports to.</p>
        <ol>
          <li>Open the <strong>Org Chart</strong> tab of your organization.</li>
          <li>
            Choose <strong>Add a seat</strong>. It sits above the chart, next to <strong>Hire from the directory</strong> and <strong>Add existing bot</strong>,
            on every organization of your own.
          </li>
          <li>Fill in <strong>Short name</strong> (like <strong>Co Founder</strong>; the seat file becomes <code>co-founder.md</code>), <strong>Title</strong>, <strong>Kind</strong> (Human, Bot, or System), and <strong>Reports to</strong>.</li>
          <li>Choose <strong>Add seat</strong>. The seat file is written, and the chart re-reads it from disk.</li>
        </ol>
        <p>
          Drag the background to move around, use the mouse wheel or the − and + buttons to zoom, and <strong>Fit</strong> to see the whole chart. <strong>Find seat</strong> jumps to a seat by name.
          The legend counts humans, bots, and systems.
        </p>
        <p>
          <strong>Retired</strong> in the legend lists every seat you retired, human or bot, with the date. Retire takes a seat out of this organization only; the bot keeps
          running in Grok Bot, where another organization may still use it. To remove a retired bot from your Grok Bot account, choose <strong>Delete from Grok Bot…</strong> on its row.
          The app warns you when another organization still has the bot active. The Connector deletes it on its next run, and until then you can <strong>Cancel</strong>.
          The Connector learns this from its prompt, so paste the prompt from <strong>Connect bots</strong> into it once.
        </p>
        <p>On your own organizations, each bot card shows what the app knows about it in Grok Bot:</p>
        <ul>
          <li><strong>In Grok Bot</strong>, green: the last sync saw it, or the seat has a Grok Bot link.</li>
          <li><strong>New in Grok Bot</strong>: a sync created this seat from a bot in Grok Bot.</li>
          <li><strong>Not in Grok Bot</strong>, dashed: the last snapshot did not include it.</li>
          <li><strong>Not synced yet</strong>, muted: nothing is known yet.</li>
        </ul>
        <p>To move a seat under someone else, open it and change <strong>Reports to</strong>. The app refuses a change that would make a seat report to itself or loop.</p>

        <h2 id="seat-cards">Seat cards</h2>
        <p>Every seat has a card with four sections. They are what a bot is told, and what a person agrees to.</p>
        <ul>
          <li><strong>Owns</strong>: what this seat is responsible for.</li>
          <li><strong>May</strong>: what it can do without asking.</li>
          <li><strong>Needs approval</strong>: what it must ask before doing.</li>
          <li><strong>Done when</strong>: what finished looks like.</li>
        </ul>
        <p>
          Each seat is one file, <code>orgs/&lt;slug&gt;/seats/&lt;short-name&gt;.md</code>: frontmatter, then those four sections. Saving never deletes a seat file;
          to remove a seat, retire it from its drawer. Its history stays in the logs.
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
        <p>
          A bot that is not in Grok Bot yet shows <strong>Create in Grok Bot</strong> in its drawer: the app asks the Connector to create it on its next run.
          To link a bot by hand instead, create it in Grok Bot from the card, copy its share link (<code>https://x.ai/bot/…</code>), and paste it into the seat.
          Leave the link empty until you have a real one.
        </p>

        <h2 id="work-chart">Work Chart</h2>
        <p>
          The Work Chart shows how work moves. Each process is one lane: a trigger, the steps in order, and when the work is done.
          The folder of process files is the chart; there is no index file.
        </p>
        <p>A trigger is one of three kinds:</p>
        <ul>
          <li><strong>Schedule</strong>: a time, such as <code>Mon 09:00</code>, or a cron line. A schedule that fires more than once an hour shows a warning.</li>
          <li><strong>Event</strong>: email, Slack, GitHub, a webhook, or a form, with a short description.</li>
          <li><strong>Manual</strong>: someone starts it.</li>
        </ul>
        <p>
          Each step names a seat and a short action. An arrow between steps owned by different seats is a handoff. <code>next</code> names the process this one hands off to.
        </p>
        <p>
          A step is a checkpoint when the seat&apos;s Needs approval list covers it, or when the action contains send, pay, post, book, merge, publish, or delete.
          The lane marks it <strong>Needs your approval</strong>, and the bot writes status <code>waiting</code> and asks before it continues.
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

Plain notes for the people reading the file.`}</CodeBlock>
        <ul>
          <li><strong>+ New process</strong> writes that file. Edit and Delete change the same file; Delete asks first.</li>
          <li><strong>Copy for Grok Bot</strong> copies a routine for the owning bot: the trigger, the steps, each checkpoint as “ask me before…”, and done-when.</li>
          <li><strong>Import processes from Grok Bot</strong> reads the routines Grok Bot already runs from a JSON file. An unknown seat name is reported and kept as written.</li>
          <li><strong>Simulate a run</strong> writes example run-log lines about every two seconds, so you can watch the chart move.</li>
        </ul>
        <p>
          While bots run, each step shows its latest status, with an activity feed and a <strong>Needs your approval</strong> list. Click a step to open its seat card.
          On the org chart, <strong>See its work</strong> opens the Work Chart with that seat&apos;s steps highlighted.
        </p>

        <h2 id="sync">Sync with Grok Bot</h2>
        <p>
          <strong>Sync with Grok Bot</strong>, on the organization&apos;s tab row, shows what changed since the last sync and applies it when you choose <strong>Sync</strong>.
          A number on the button means there is something to review. The drawer has two sides.
        </p>
        <h3>Coming from Grok Bot</h3>
        <ul>
          <li>New bots become seats marked New.</li>
          <li>Matched bots take their link, routines, and run numbers from Grok Bot. Your managers, step assignments, and filled card sections are kept.</li>
          <li>New routines become processes.</li>
          <li>A bot that left Grok Bot is tagged Not in Grok Bot. <strong>A sync never deletes a seat.</strong></li>
          <li>
            <strong>In Grok Bot, no organization</strong> lists bots that run in Grok Bot but belong to no organization in this folder. Tick one to add it to the organization you have open.
          </li>
        </ul>
        <h3>Going to Grok Bot</h3>
        <ul>
          <li>Every active bot Grok Bot does not have yet is listed, including bots on a template copy or a hand-built chart. Tick the ones to create; the Connector creates them on its next run.</li>
          <li>Retired bots waiting to be deleted in Grok Bot are listed too, each with <strong>Cancel</strong>.</li>
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
          If Grok Bot cannot write the snapshot, open <strong>One-off snapshot without the Connector</strong> in the drawer: copy the prompt into a Grok Bot chat, then import the file it gives you.
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
          <strong>Performance</strong> lists each bot with when it was created, its usage and tasks done in the last 30 days, and when it was last active.
          The numbers come from the run log and from Grok Bot; the app never estimates them.
        </p>
        <p>
          <strong>Logs</strong> lists every event of the organization, newest first: hires, retirements, edits, work, approvals, and exceptions, and everything that passes
          between the app and Grok Bot. Each line has a label, and its figures show as small tiles under it. The <strong>Show</strong> menu narrows it to Grok Bot and the
          Connector, or to team and work. A <strong>From Grok Bot</strong> or <strong>To Grok Bot</strong> badge shows which way a change went; a step chip jumps to that step on the Work Chart.
        </p>
        <p>What the Connector does is logged in every organization, while <code>npm run dev</code> is running:</p>
        <ul>
          <li><strong>Connected</strong>: the first run in this folder, or the first run after a stop, with how long it was down.</li>
          <li><strong>Bot connected</strong>: each bot the Connector reports for the organization for the first time, with its routines and 30-day numbers.</li>
          <li><strong>Bot left</strong>: a bot that was in Grok Bot on the last run and is gone now.</li>
          <li><strong>Connector</strong>: one line per day, updated on every run: runs today, first and last run, bots in Grok Bot, requests waiting, and bots with no organization.</li>
          <li><strong>Stopped</strong>: the Connector missed two runs, with the time of its last run.</li>
          <li><strong>Error</strong>: the Connector wrote a snapshot the app cannot read, and why.</li>
          <li><strong>Request</strong>, <strong>Created</strong>, <strong>Deleted</strong>, <strong>Sync</strong>, and <strong>Added</strong>: bots you asked Grok Bot to create or delete (and cancelled deletes), bots it created, bots it deleted, confirmed syncs with the bots they changed, and bots added from the no-organization list.</li>
        </ul>
        <p>The run log is one file per day, <code>log/YYYY-MM-DD.md</code>, starting with <code># Run log YYYY-MM-DD</code>, then one line per step:</p>
        <p><code>- HH:MM | bot | process | step | done|failed|skipped|waiting|running | note or -</code></p>
        <p>A line that does not fit is skipped. Every other event is its own file in <code>log/</code>.</p>

        <h2 id="where">Files and folders</h2>
        <p>Everything lives in plain files in the project folder. Nothing is uploaded.</p>
        <ul>
          <li><code>orgs/&lt;slug&gt;/org.md</code>: the organization fields, departments, people, and the org chart (who reports to whom).</li>
          <li><code>orgs/&lt;slug&gt;/seats/&lt;short-name&gt;.md</code>: one file per seat.</li>
          <li><code>orgs/&lt;slug&gt;/processes/&lt;name&gt;.md</code>: one file per process. <code>work-chart.md</code> is still read when it is present.</li>
          <li><code>orgs/&lt;slug&gt;/log/</code>: the daily run logs and one file per event.</li>
          <li><code>orgs/&lt;slug&gt;/grok/</code>: <code>snapshot.json</code>, written by the Connector, and <code>requests.json</code>, written by the app.</li>
          <li>
            <code>orgs/project.json</code>: this copy&apos;s id. <code>orgs/connector.json</code>: the Connector&apos;s last run.{' '}
            <code>orgs/connector-log.json</code>: what the app already logged about the Connector, so no run is logged twice.
          </li>
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
          <strong>Import bots file</strong> and <strong>Export bots file</strong>, on the <strong>Connect bots</strong> tab, use one JSON file, <code>botseverywhere-bots.json</code>.
          Export builds it from the seat files; import reads it back into an organization. A name that already exists is saved as a second seat and never overwrites the first.
          The format is in <code>docs/bots-file.md</code>.
        </p>
        <p>Paste this into Grok Bot when you want it to write that file for you:</p>
        <CodeBlock label="Bots file prompt">{GROK_BOTS_PROMPT}</CodeBlock>
        <p>To keep history, commit <code>orgs/</code> with Git in a private repository of your own:</p>
        <CodeBlock>{`git add orgs
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
          the run log, and the snapshot. A connector for another platform has to do what the Grok Bot Connector does: read those files, run the bots, write a snapshot,
          and append to the run log. The Grok Bot prompt is in <code>server/src/connector-prompt.ts</code>, and the snapshot format is the one shown in
          {' '}<To id="connect-grok">Step 1</To>. Contributions are welcome.
        </p>

        <h2 id="example">Worked example</h2>
        <p>
          Open <a href="#/template/botseverywhere/org-chart">botseverywhere</a> under Templates: the project&apos;s own team, read-only.
          <strong> Miguel Rovira</strong> is at the top, <strong>Grok Bot</strong> reports to Miguel, and thirteen bots report to Grok Bot, from Planning Bot to Design Bot.
        </p>
        <p>
          Its <a href="#/template/botseverywhere/work-chart">Work Chart</a> has four processes: Invoice arrives, New request, Weekly campaign brief, and Daily brief.
          Those lanes use Finance Bot, Product Bot, Marketing Bot, and Planning Bot.
        </p>
        <p>
          Your own chart starts smaller, with <strong>You</strong> at the top. Add the seats you need, set who they report to, hire bots that already have a prompt from the{' '}
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
          Grok Bot has not written to this folder yet. Check that you pasted the prompt from <strong>Connect bots</strong> of this copy, then wait up to 15 minutes for the first run.
        </p>
        <h3>The bar says Connector stopped</h3>
        <p>The Connector missed two runs. Check in Grok Bot that it still exists and runs as often as <strong>Runs every</strong> on Connect bots says.</p>
        <h3>A bot shows Not in Grok Bot</h3>
        <p>The last snapshot did not include it. Open the bot and choose <strong>Create in Grok Bot</strong>, or tick it under Going to Grok Bot in the Sync drawer.</p>

        <h2 id="faq">FAQ</h2>
        <h3>Is my data uploaded?</h3>
        <p>No. Everything is written to the <code>orgs</code> folder on the computer running the app. Only the Connector, in your own Grok Bot, reads it.</p>
        <h3>Do I need an account?</h3>
        <p>No. There is no sign-up and no team to create.</p>
        <h3>Can I have several organizations?</h3>
        <p>Yes. Each is a folder in <code>orgs/</code>, and one Connector serves all of them. Switch with the organization menu on the tab row.</p>
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
          BotsEverywhere is open source, copyright 2026 Miguel Rovira, and dual licensed: you may use it under the <strong>MIT License</strong> or the{' '}
          <strong>Apache License 2.0</strong>, at your option. You follow the license you choose, not both. In package terms the license is <code>MIT OR Apache-2.0</code>.
        </p>
        <div className="docs-license-summary is-two">
          <section>
            <h3>Choose MIT for simplicity</h3>
            <ul>
              <li>Use, modify, distribute, and sell it, including commercially</li>
              <li>Keep the copyright notice and the MIT text</li>
              <li>No need to mark the files you change</li>
              <li>No warranty, no liability for the authors</li>
            </ul>
          </section>
          <section>
            <h3>Choose Apache 2.0 for explicit terms</h3>
            <ul>
              <li>The same freedoms, plus a patent license from every contributor</li>
              <li>Keep the copyright notices, the Apache text, and the <code>NOTICE</code> credit</li>
              <li>Mark files you change when you share a modified copy</li>
              <li>Suing over patents in the code ends your patent license</li>
            </ul>
          </section>
        </div>
        <p>
          Under either license, using and changing BotsEverywhere inside your own organization asks nothing extra of you. The conditions above apply when you share copies.
          Neither license gives rights to the BotsEverywhere name or logo.
        </p>
        <h3>Contributions</h3>
        <p>
          Unless you say otherwise, any contribution you intentionally submit for inclusion in BotsEverywhere is dual licensed as above, under MIT or Apache 2.0,
          without any additional terms or conditions.
        </p>
        <p>
          This summary is for reading convenience. The license texts below are what apply: <code>LICENSE-MIT</code> and <code>LICENSE-APACHE</code> at the root of the project,
          with the credit in <code>NOTICE</code>.
        </p>
        <h3>MIT License</h3>
        <div className="docs-license-text" role="region" aria-label="MIT License text" tabIndex={0}>{MIT_TEXT.trim()}</div>
        <h3>Apache License 2.0</h3>
        <div className="docs-license-text" role="region" aria-label="Apache License 2.0 text" tabIndex={0}>{LICENSE_TEXT.trim()}</div>
        <h3>NOTICE</h3>
        <div className="docs-license-text is-notice" aria-label="NOTICE file">{NOTICE_TEXT.trim()}</div>
      </article>
    </main>
  )
}
