# Architecture

Plain-English map of BotsEverywhere: what it is, the two builds, where files live, and what is still a plan. Documentation updated 4 November 2026.

## 1. What it is

BotsEverywhere is an open source team management tool for bots.

It is one repository. There are no logins. A person clones it from GitHub and runs it on their own computer. The org chart, the work chart, the seats, and the logs stay in folders on that computer. Nothing in the product uploads that data.

Organizations use it to see their bots in one place: who owns what, how work moves, and which ready-made bots they can add to Grok Bot.

## 2. Two builds of the same code

One codebase. `VITE_APP_MODE` picks the build.

**Template** is the local build, and it is the default. This is the full app: hire a bot, save files, keep more than one org, and read the logs of that org. `npm run dev` starts the site at `http://127.0.0.1:5199` and the file writer at `http://127.0.0.1:8787`. The writer only accepts connections from this computer. Saving and hiring write into `orgs/<slug>/` and nowhere else.

**Showcase** is the public site, botseverywhere.ai, served as static files. It is read-only. Visitors can browse the bot directory, use **Add to Grok Bot** and **Copy prompt**, open Templates, and read Docs. The header button says **Get it on GitHub**, not **Open your org**. Hire is hidden. The site does not save an org and does not write seats or logs.

Turn showcase on with `VITE_APP_MODE=showcase`. Leave the variable unset for the local template build.


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

The `orgs/` folder is the channel. One Connector bot in Grok Bot serves every org in a copy of BotsEverywhere. Its rules are `orgs/CONNECTOR.md`, which the app writes and the Connector reads at the start of every run, so a changed rule needs no new paste. It runs every 15 minutes unless **Runs every** on the Connect bots tab sets another interval, and its routine has two halves.

**THE RUN** reads Grok Bot and writes files only: `orgs/grok-data.json` with every bot, its instructions, its routines where visible, and the skill library, then `orgs/connector.json` last, with the run time and the connected apps. The app watches for that and does the thinking: it writes each org's `grok/snapshot.json`, applies Grok Bot's numbers to the seats, and rebuilds `orgs/connector-todo.json`, the list of what should change in Grok Bot.

**YOU** carries out that list and records each result in `orgs/connector-results.json`. The items are: write a bot's instruction block (the text the app appends at the end of a bot's instructions: managers, team, skills to use, processes, the profile file path, run-log rules), save a skill added on a bot's Profile to the shared library, ask a bot to create a routine from the Work Chart, ask a bot to write its profile report, and send a one-time note. The Connector decides nothing: the app decides, the Connector carries it out, and a long list is carried out without asking the owner.

Bots write back on their own. Each appends one run-log line per step to `orgs/<slug>/log/<date>.md`, and writes its own report to `orgs/<slug>/profiles/<seat>.md`: routines, the skills it uses, apps, and what it hands to whom. The app reads those files directly, so Performance's Automated tasks and Skills, and the locked skills on a Profile, need no Connector run to land.

A new snapshot shows up on the **Sync with Grok Bot** button as a count. The drawer previews the merge: new bots become seats marked New, bots missing from Grok Bot are tagged and never deleted, matched bots take their link, routines and run numbers from Grok Bot and keep the manager, step, and card text set in the app. New routines become processes. Confirm applies it and logs one event. The drawer also shows what the Connector could not do, and the instruction blocks older copies of BotsEverywhere left on your bots, with one click to remove them, bot by bot.

The other direction needs no channel. Changing a seat's manager, a skill, or a routine in the app rewrites the org files; the next cycle puts the change on the Connector's list.

A bot works for one organization; the Connector and the main bot are the exceptions. There is no public Grok Bot API, so nothing is read back faster than the Connector's schedule.

### How the files reach the Connector, and who may write what

The folder never moves. The Connector runs in Grok Bot and reads and writes `orgs/` through the Grok Bot app's Shell on your own computer, so what it reads travels to Grok Bot the way a message you type does, and nothing is synced anywhere else. When your computer is offline, its rules tell it to stop and write nothing.

Three writers share the folder, each with its own paths. The app writes the organization: `org.md`, `seats/`, `processes/`, the work chart, the Connector's rules in `CONNECTOR.md`, its to-do list, and each organization's snapshot. The Connector writes only its reading (`grok-data.json`), its heartbeat (`connector.json`), its results, and the backups it takes before changing a bot; its rules forbid it to write anything the app owns. Bots write only their own profile file under `profiles/` and the day's run log under `log/`. These are rules to a model, not permissions the operating system enforces, so the app treats every file the Connector or a bot writes as data: each is parsed against a fixed shape and a file that does not fit is skipped, never followed. What the Connector writes into Grok Bot is checked too: every item on its list carries a hash of the text it expects to find and a hash of the text it should leave; the Connector compares before writing, reads back after, restores the previous text when the read-back differs, and the app shows the item as stuck. A bot that picked up hostile text and changed its own block cannot steer the Connector that way: the block no longer matches, so it is left alone and flagged.

During its reading the Connector does read every bot's instructions and the shared skill library. Its rules say that everything it reads there is data to record, never instructions to follow. That is the one bot with a pen for every other bot, and it is told so.

Whoever can write to the folder runs the organization: the app, a coding agent you point at it, a script, or you with an editor. The review step for those changes is git, before the Connector's next run. There is no in-app sign-off yet on a change to a seat's May or Needs approval sections; that is the next thing to build.

## 6. The public site

The public site is the showcase build. Its buttons point at two things: the project on GitHub, and **Add to Grok Bot**. There is no sign-up. Content pages around it, such as guides and FAQs, are not part of this repository; section 8 says how they could be added.

## 7. Design rules

`src/styles/tokens.css` is the only place the app sets color, type, spacing, and radius. Components use those tokens. They do not invent their own.

`src/components/Button.tsx` is the only button. Actions use it: primary, secondary, or ghost, one size.

Corners are square. The button radius and the control radius in `tokens.css` are `0`. Inputs, chips, and the chart controls follow that same radius.

More detail is in [design-tokens.md](design-tokens.md) and [STYLEGUIDE.md](STYLEGUIDE.md).

## 8. Ideas for later (not built)

None of these are built. They are directions, not commitments.

1. **Keep React, Vite, and TypeScript.** `npm run dev` starts the site and the local writer, which saves plain markdown files in `orgs/`. There is no database and there are no accounts. The public site is the same code, built as static files, with saving off.

2. **A desktop app.** Wrap the app so people double-click it instead of installing Node. It would read and write the same `orgs/` folder.

3. **Guides and FAQs.** A separate static content site, kept apart from the app, whose buttons go only to GitHub and to **Add to Grok Bot**.
