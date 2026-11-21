# Setup

BotsEverywhere is an open source team management tool for bots.

Organizations copy it to map their team of bots in one place: an org chart, a work chart of who does what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on their own computer.

BotsEverywhere itself needs no accounts, no paid service, and no API keys. Grok Bot has its own account and plans. BotsEverywhere is open source under the MIT License; see `LICENSE`.

You need Node.js 22 and npm, and Grok Bot to run bots. See [Connect Grok Bot](#connect-grok-bot).

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

Leave that window open. `npm run dev` starts the site and the file writer together. Open the site URL it prints (http://127.0.0.1:5199 by default) and choose **Open your org** to create your first organization.

### macOS and Linux

```bash
git clone https://github.com/botseverywhere-ai/botseverywhere.git
cd botseverywhere
npm install
npm run dev
```

Leave that window open. `npm run dev` starts the site and the file writer together. Open the site URL it prints (http://127.0.0.1:5199 by default) and choose **Open your org** to create your first organization.

The web server starts on port 5199 and the dev API on 127.0.0.1 port 8787; Vite proxies `/api` to it. If a port is taken, that one moves to the next free port, and `npm run dev` prints the URLs it bound. The file writer refuses any other host and refuses to start when `NODE_ENV=production`.

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

A fresh clone has no organization yet. Open the site URL that `npm run dev` prints (http://127.0.0.1:5199 by default), choose **Open your org**, and create your first one: it gets a folder under `orgs/` named by its ID, with one person, You. `samples/` holds the read-only sample organizations. They are not your organization.

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

## Connect Grok Bot

Grok Bot is where your bots run. BotsEverywhere never calls it: one bot in Grok Bot, the Connector, reads and writes the `orgs/` folder on this computer.

1. Download Grok Bot from [x.ai/bot](https://x.ai/bot), install it, and sign in with the Grok account that holds your plan. That page lists the plans that include Grok Bot.
2. In BotsEverywhere, open your organization and choose **Connect bots**. Step 1 shows the Connector name and the folder it uses.
3. Choose **Copy Connector prompt** and paste it into Grok Bot. The prompt creates the Connector, points it at `orgs/CONNECTOR.md`, and sets one routine every 15 minutes unless **Runs every** says otherwise.
4. Let it run once; it runs right after you paste the prompt. `orgs/connector.json` and `orgs/grok-data.json` appear in the folder, and the badge on Connect bots turns **Connected**. To bring your bots into a new organization, use Step 2 on Connect bots: **Import from the Connector**. After that, **Sync with Grok Bot** on the org tab row shows what changed.

If the Connector answers that it cannot read `CONNECTOR.md`, it cannot see this computer's files. Check that you installed the Grok Bot app and that the `orgs` folder has not moved since you copied the prompt.

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

`npm run preview` serves `dist/` on port 5199 (fixed: it fails rather than moving to another port). On a server, copy `dist/` to the web root. Routes are hash routes such as `#/org/<slug>/overview`, so the host needs no rewrite to `index.html`.

To publish a change, commit `orgs/` (with `git add -f orgs`) and run the build again.
