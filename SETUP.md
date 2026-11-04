# Setup

BotsEverywhere is an open source team management tool for bots.

Organizations copy it to map their team of bots in one place: an org chart, a work chart of who does what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on their own computer.

No accounts, no paid services, and no API keys. BotsEverywhere is open source under the MIT License; see `LICENSE`.

You need Node.js 22 and npm.

Documentation updated 4 November 2026.

## Clone and run (template mode)

Template mode is the default.

### Windows PowerShell

```powershell
git clone https://github.com/botseverywhere-ai/botseverywhere.git
Set-Location botseverywhere
npm install
npm run dev
```

Leave that window open. `npm run dev` starts the site and the file writer together. Open http://127.0.0.1:5199 and choose **Open your org** to create your first organization.

### macOS and Linux

```bash
git clone https://github.com/botseverywhere-ai/botseverywhere.git
cd botseverywhere
npm install
npm run dev
```

Leave that window open. `npm run dev` starts the site and the file writer together. Open http://127.0.0.1:5199 and choose **Open your org** to create your first organization.

The web server listens on port 5199. The dev API listens on 127.0.0.1 port 8787 and Vite proxies `/api` to it. The file writer refuses any other host and refuses to start when `NODE_ENV=production`.

## Update to a newer version

Update in the folder you already use. Stop `npm run dev` with `Ctrl+C`, then:

```bash
git pull
npm install
npm run dev
```

PowerShell uses the same three commands.

Do not clone a fresh copy into a new folder to update. Your organizations live in `orgs/`, which git does not track, and so does this copy's ID (`orgs/project.json`). A new folder starts with no organizations and a new ID, so you would set up a second Connector, and your bots would keep the old copy's instructions until you remove them under **Old instructions from other copies of BotsEverywhere** in **Sync with Grok Bot**.

If you must move to another folder, move `orgs/` with it. Then copy the Connector prompt from Connect bots and paste it into Grok Bot once more: the prompt names the folder, and the Connector replaces its own instructions.

## Edit the org and commit

A fresh clone has no organization yet. Open http://127.0.0.1:5199, choose **Open your org**, and create your first one: it gets a folder under `orgs/` named by its ID, with one person, You. `samples/` holds the read-only organizations, including botseverywhere. They are not your organization.

In the app, while `npm run dev` is running:

1. Open a seat, or choose **+ Add seat**, or hire a bot from the directory.
2. Set the four card sections. The drawer shows **Saved** when the seat file is written. Hiring writes `orgs/<slug>/seats/<bot>.md` immediately.
3. To keep history, commit the changes. `orgs/` is ignored by git because it is your own data, so add it with `-f`, and only push it to a private repository. **Export** on the Backup tab is the other way to keep a copy.

```bash
git add -f orgs
git commit -m "Update the org chart"
```

PowerShell uses the same two git commands.

You can also edit the files by hand:

| File | What it holds |
| --- | --- |
| `orgs/<slug>/org.md` | Organization overview and the org chart (who reports to whom) |
| `orgs/<slug>/seats/<slug>.md` | One seat. Frontmatter plus Owns, May, Needs approval, and Done when |
| `orgs/<slug>/work-chart.md` | The work chart: trigger, outcome, steps, handoffs |
| `orgs/<slug>/processes/<slug>.md` | One process: trigger, ordered steps, done when. The Work Chart tab shows these |
| `orgs/<slug>/log/<event>.md` | One log event (hire, fire, work, approval, exception) |
| `orgs/<slug>/log/YYYY-MM-DD.md` | The run log the bots append to, one line per step |
| `orgs/<slug>/profiles/<seat>.md` | Written by each bot on its own runs: its routines, the skills it uses, and its apps. Performance and the Profile tab read it |
| `orgs/<slug>/grok/snapshot.json` | Written by the app from the Connector's reading, every 15 minutes unless **Runs every** on Connect bots says otherwise. **Sync with Grok Bot** applies it |
| `orgs/<slug>/grok/requests.json` | Bots the app asked the Connector to create (**Create in Grok Bot**) or to update (**Update bot**). The app turns them into the Connector's list |
| `orgs/<slug>/grok/profile-asks.json` | When every bot in this org was last asked for its report: **Sync bots** on Performance, a first import, or a new skill in the library |
| `orgs/project.json` | This copy's id, which names its Connector, how often the Connector runs, and your main bot. The app writes it |
| `orgs/CONNECTOR.md` | The Connector's rules. The app writes it; the Connector reads it at the start of every run |
| `orgs/grok-data.json` | Written by the Connector in Grok Bot on each run: every bot, its instructions, its routines, and the skill library |
| `orgs/connector-todo.json` | The app's list for the Connector: instructions to write, skills to save, routines and reports to ask for. The Connector carries it out and records each result in `orgs/connector-results.json` |
| `orgs/connector.json` | Written by the Connector last on each run: when it ran, its interval, and the connected apps |

`directory/` at the repo root is the shared bot catalog. Hiring writes `orgs/<chosen>/seats/<bot>.md` and adds that seat to that org's chart. It does not write another org's folder.

The writer root is the `ORGS_DIR` environment variable, or `./orgs` when it is unset. `reportsTo` in the seat file and in `org.md` must match. `addToGrokBotUrl` is empty or `https://x.ai/bot/…`. Leave it empty until you have created that bot. Saving does not delete a seat file.

Check the files before you commit:

```bash
npm run validate:org
```

## Public site mode (showcase)

Use this for a read-only site such as botseverywhere.ai. It shows the sample organizations and the clone steps. It does not edit organizations and it does not write files.

```bash
VITE_APP_MODE=showcase npm run dev
```

PowerShell:

```powershell
$env:VITE_APP_MODE = "showcase"
npm run dev
```

No API process is required. Build the static site the same way:

```bash
VITE_APP_MODE=showcase npm run build
```

PowerShell:

```powershell
$env:VITE_APP_MODE = "showcase"
npm run build
```

Serve the `dist/` folder with any static file host. There is no database and no key to configure.

## Optional self-host

An organization can serve its own built copy. Edits still happen in git: change `orgs/`, then rebuild. The dev file writer is not a production API.

```bash
npm run build
npm run preview
```

`npm run preview` serves `dist/` on port 5199. On a server, copy `dist/` to the web root. Hash routes need the host to fall back to `index.html`.

To publish a change, commit `orgs/` (with `git add -f orgs`) and run the build again.
