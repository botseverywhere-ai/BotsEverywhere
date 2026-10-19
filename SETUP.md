# Setup

BotsEverywhere is an open source team management tool for bots.

Organizations copy it to map their team of people and bots in one place: an org chart, a work chart of who does what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on their own computer.

No accounts, no paid services, and no API keys. BotsEverywhere is dual licensed under the MIT License or the Apache License 2.0, at your option; see `LICENSE-MIT`, `LICENSE-APACHE`, and `NOTICE`.

You need Node.js 22 and npm.

## Clone and run (template mode)

Template mode is the default. It does not use SQLite.

### Windows PowerShell

```powershell
git clone <this-repository-url>
Set-Location <repository-folder>
npm install
npm run dev
```

Leave that window open. `npm run dev` starts the site and the file writer together. Open http://127.0.0.1:5199/#/org/your-company/overview

### macOS and Linux

```bash
git clone <this-repository-url>
cd <repository-folder>
npm install
npm run dev
```

Leave that window open. `npm run dev` starts the site and the file writer together. Open http://127.0.0.1:5199/#/org/your-company/overview

The web server listens on port 5199. The dev API listens on 127.0.0.1 port 8787 and Vite proxies `/api` to it. The file writer refuses any other host and refuses to start when `NODE_ENV=production`.

## Edit the org and commit

`org/` is the blank starter: one person (You) and one seat. `samples/` holds the read-only organizations, including botseverywhere. They are not your organization.

In the app, while `npm run dev` is running:

1. Open a seat, or choose **+ Add seat**, or hire a bot from the directory.
2. Set the four card sections. The drawer shows **Saved** when the seat file is written. Hiring writes `orgs/<slug>/seats/<bot>.md` immediately.
3. Commit the changes.

```bash
git add orgs
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
| `orgs/<slug>/grok/snapshot.json` | Written by the Connector bot in Grok Bot every 15 minutes. The app only reads it. **Sync with Grok Bot** applies it |

`directory/` at the repo root is the shared bot catalog. Hiring writes `orgs/<chosen>/seats/<bot>.md` and adds that seat to that org's chart. It does not write another org's folder.

The writer root is the `ORGS_DIR` environment variable, or `./orgs` when it is unset. `reportsTo` in the seat file and in `org.md` must match. `addToGrokBotUrl` is empty or `https://x.ai/bot/…`. Leave it empty until you have created that bot. Saving does not delete a seat file.

Check the files before you commit:

```bash
npm run validate:org
```

## Public site mode (showcase)

Use this for a read-only site such as botseverywhere.ai. It shows the sample organizations and the clone steps. It does not create teams and it does not write files.

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

An organization can serve its own built copy. Edits still happen in git: change `org/`, then rebuild. The dev file writer is not a production API.

```bash
npm run build
npm run preview
```

`npm run preview` serves `dist/` on port 5199. On a server, copy `dist/` to the web root. Hash routes need the host to fall back to `index.html`.

To publish a change, commit `org/` and run the build again.

## Optional share-link mode (SQLite)

The earlier share-link and owner-link API is still in the repo and stays off unless you opt in. It stores teams in a local SQLite file. Tokens are stored only as SHA-256 hashes. `AUTH_ENABLED` defaults to false, so email and Slack sign-in stay off and no mail or Slack keys are required.

`npm run dev` starts the site and one API process. Set both variables on that one command so the API is the SQLite server and the site is in SQLite mode. Do not also run `npm run dev:api`; that starts a second writer on the same port.

```bash
MODE=sqlite VITE_APP_MODE=sqlite npm run dev
```

PowerShell:

```powershell
$env:MODE = "sqlite"
$env:VITE_APP_MODE = "sqlite"
npm run dev
```

`npm run seed:org` prints an owner link once for the bundled botseverywhere organization. The token is not written to disk. Do not commit `data/*.sqlite`.

Template and showcase do not need this mode.
