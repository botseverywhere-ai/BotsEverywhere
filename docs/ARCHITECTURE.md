# Architecture

Plain-English map of BotsEverywhere: what it is, the two builds, where files live, and what is still a plan.

## 1. What it is

BotsEverywhere is an open source team management tool for bots.

It is one repository. There are no logins. A person clones it from GitHub and runs it on their own computer. The org chart, the work chart, the seats, and the logs stay in folders on that computer. Nothing in the product uploads that data.

Organizations use it to see people and bots in one place: who owns what, how work moves, and which ready-made bots they can add to Grok Bot.

## 2. Two builds of the same code

One codebase. `VITE_APP_MODE` picks the build.

**Template** is the local build, and it is the default. This is the full app: hire a bot, save files, keep more than one org, and read the logs of that org. `npm run dev` starts the site at `http://127.0.0.1:5199` and the file writer at `http://127.0.0.1:8787`. The writer only accepts connections from this computer. Saving and hiring write into `orgs/<slug>/` and nowhere else.

**Showcase** is the public site, botseverywhere.ai, hosted on EC2. It is read-only. Visitors can browse the bot directory, use **Add to Grok Bot** and **Copy prompt**, open Templates, and read Docs. The header button says **Get it on GitHub**, not **Open your org**. Hire is hidden. The site does not save an org and does not write seats or logs.

Turn showcase on with `VITE_APP_MODE=showcase`. Leave the variable unset for the local template build.

An older sqlite mode still exists in the repo for a previous share-link demo. It is off unless someone sets `MODE=sqlite` and `VITE_APP_MODE=sqlite`. It is not one of these two builds.

## 3. Folder layout

One clone looks like this:

```text
botseverywhere/
  the app            site code (src/, server/, public/)
  orgs/
    project.json     this copy's id and how often the Connector runs
    connector.json   written by the Connector each run: bots in no org, connected apps
    <slug>/
      org.md         organization overview and the org chart
      seats/*.md     one file per seat
      work-chart.md  triggers, steps, handoffs, checkpoints
      processes/*.md one file per process
      log/*.md       run logs by date, and one file per log event
      grok/          snapshot.json from the Connector, requests.json from the app
  directory/*.md     shared bot catalog, one prompt per bot
```

`directory/` sits at the root. It is not inside an org. Every org on the computer shares that catalog.

A computer can hold many orgs, each in its own `orgs/<slug>/` folder. Hiring asks which org. The hire drawer lists every folder under `orgs/`, defaults to the org you have open (or the only org), and offers **+ New org**. **Hire** writes `orgs/<chosen>/seats/<bot>.md`, adds that seat to that org’s chart, and the confirmation link opens that org’s Org Chart. A template copy and an org started from scratch use the same layout.

`samples/` holds the read-only template organizations. Copying one creates a new folder under `orgs/`. It does not edit the sample.

**Import bots file**, on the Connect bots tab, reads one JSON file and writes one `source: existing` seat file per bot. The format is in [bots-file.md](bots-file.md). A name whose file already exists is saved as `<slug>-2.md` and does not overwrite the first file. `reportsTo` is a seat name. It defaults to You. Bots in the same file can report to each other: the writer creates every file first, then links those reports. The seat card shows **Open in Grok Bot** when `grokBotUrl` is set. **Add existing bot** (`POST /api/orgs/<slug>/seats/existing`) writes one of these seats at a time; its button is off on the org chart for now.

## 4. Navigation

The main menu is the same on both builds:

- **Bot Directory**
- **Templates**
- **Docs**
- a button on the right: **Open your org** locally, **Get it on GitHub** on the public site

Inside an org, a second row of tabs:

- **Organization Overview**
- **Connect bots** (your own orgs only)
- **Org Chart**
- **Work Chart**
- **Performance**
- **Logs**
- **Backup** (your own orgs only)

Local routes look like `#/org/<slug>/overview`. A template you are only browsing uses `#/template/<slug>/overview` and stays read-only until you copy it into `orgs/`.

## 5. Making it live with Grok Bot

The `orgs/` folder is the channel. One Connector bot in Grok Bot serves every org in a copy of BotsEverywhere. It runs every 15 minutes unless **Runs every** on the Connect bots tab sets another interval. On each run it goes through every org folder: it creates the bots the app asked for in `grok/requests.json`, reads `org.md`, `seats/`, and `processes/`, keeps one routine per process, and writes `orgs/<slug>/grok/snapshot.json` with the bots that belong to that org. Last it writes `orgs/connector.json`, which lists bots that belong to no org and shows the app when the Connector last ran. Bots append one run-log line per step, and one per chat, to `orgs/<slug>/log/<date>.md`. The app watches that folder, so Logs, Performance, and the work chart update while you watch, and Grok Bot's numbers reach Performance on every run.

A new snapshot shows up on the **Sync with Grok Bot** button as a count. The drawer previews the merge: new bots become seats marked New, bots missing from Grok Bot are tagged and never deleted, matched bots take their link, routines and run numbers from Grok Bot and keep the manager, step, and card text set in the app. New routines become processes. Confirm applies it and logs one event.

The other direction needs no channel. Changing a seat's manager in the app rewrites the seat file and `org.md`; the Connector reads them on its next run.

There is no public Grok Bot API, so nothing is read back faster than the Connector's schedule.

The org chart shows what the sync knows. A bot card is green with **In Grok Bot** when the last snapshot had it, or when the seat carries a Grok Bot link and no snapshot has said otherwise. It is dashed with **Not in Grok Bot** when a snapshot lacked it, for example a bot hired from the directory that was never created in Grok Bot. **Not synced yet** means no link and no snapshot. The chart pans by dragging and zooms with the wheel or the buttons, and the seat drawer's **Reports to** select moves a seat under another.

Retire takes a seat out of one org; the bot keeps running in Grok Bot. Grok Bot gives the Connector no way to delete a bot, so **Delete in Grok Bot** on a retired bot opens it there and the person deletes it by hand. The app marks the seat deleted once a later Connector run no longer reports that bot anywhere.

Status of this work and the next steps are in [STATUS.md](STATUS.md).

## 6. After the demo, on the EC2 site

The public site stays the showcase build, on the same domain, and gains content pages around it: a blog, FAQs, and guides. Those pages are not in the repo yet. The recommended way to add them is in section 8. It is not built.

Buttons on the live site point at two things: download the project from GitHub, and **Add to Grok Bot**. They do not point at a sign-up.

## 7. Design rules

`src/styles/tokens.css` is the only place the app sets color, type, spacing, and radius. Components use those tokens. They do not invent their own.

`src/components/Button.tsx` is the only button. Actions use it: primary, secondary, or ghost, one size.

Corners are square. The button radius and the control radius in `tokens.css` are `0`. Inputs, chips, and the chart controls follow that same radius.

More detail is in [design-tokens.md](design-tokens.md) and [STYLEGUIDE.md](STYLEGUIDE.md).

## 8. Recommendations after the demo (not built)

These are recommendations for after the Nov 7 demo. None of them are built. Do not switch stacks before Nov 7.

1. **Keep React, Vite, and TypeScript.** On a PC, `npm run dev` starts the site and the local writer. The writer saves plain markdown files in `orgs/`. There is no database and there are no accounts. The EC2 version is the same code, built as static files, with saving off.

2. **A desktop app, later.** Wrap the app in Tauri so people double-click a desktop app instead of installing Node. It still reads and writes the same `orgs/` folder.

3. **Blog and FAQs, later.** Build the EC2 blog and FAQs as a separate static content site, for example with Astro, for speed and SEO. Keep that site separate from the app. Its buttons go only to the GitHub download and to **Add to Grok Bot**.

4. **Speed.** The slowness comes from how pages load, not from React. The speed fix targets that.
