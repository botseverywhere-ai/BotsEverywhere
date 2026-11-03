# Status

Where the app stands as of 4 November 2026, written for whoever picks it up next. Facts about a running organization come from a real `orgs/` folder, which is uncommitted user data.

## Branch

The main branch is `main`. All of the work since the initial commit sits on `feature/documentation-updated-v8`, which holds every earlier branch. It is not merged into `main` yet; that merge happens through a pull request on GitHub, after the branch protection on `main` is set. Never push to `main` without the maintainer's OK.

The rules for working on the code are in `AGENTS.md`.

## What works

- **One Connector per copy.** Connect bots gives a short prompt to paste into Grok Bot once. The Connector's rules live in `orgs/CONNECTOR.md`, written by the app, and the Connector reads them at the start of every run, so a rule change needs no new paste. Its routine says "do THE RUN, then YOU": it reads Grok Bot into `orgs/grok-data.json`, then carries out the app's list in `orgs/connector-todo.json` and records each result in `orgs/connector-results.json`.
- **The app decides, the Connector carries out.** Instruction blocks at the end of each bot's instructions (managers, team, skills to use, processes, the profile file path, run-log rules), skills added on a bot's Profile, routines from the Work Chart, and the asks for each bot's own report all go through that list. A long list is carried out without asking the owner.
- **One bot, one organization.** A bot works for one organization; the Connector and the main bot (`orgs/project.json` `mainBot`) are the exceptions. A bot that works elsewhere shows greyed and gets no block, no snapshot row, and no asks.
- **Performance.** Created, Times used, Last active, and Apps used come from the Connector's reading on every run. Automated tasks done and Skills come from each bot's own report, `orgs/<slug>/profiles/<seat>.md`, which the bot writes on its own runs. The status block at the top says Connected or not, how many bots have reported, and pulses while asks wait; **Sync bots** asks every bot now, and a button opens this copy's Connector in Grok Bot. A bot's name opens its seat card.
- **Asks that need no click.** A new bot is asked for its report once by itself. A first import asks every bot. A skill new in the library since the last reading asks every bot, so a skill a bot saved in its own chat reaches its card here by the next run.
- **Profile tab.** One list of skills: a skill is locked with **In Grok Bot** when the Connector's reading shows it saved in the library and named in the bot's instructions, or when the bot reports using it; a skill added here can be removed until the Connector carries it over. Routines edit as cards. **Update bot** sends the lot.
- **Work Chart.** Processes from the organization's files, routines imported from Grok Bot, handoffs the bots report, and counts of routines without a flow and bots without work. An **Import processes from Grok Bot** panel with an Imported badge.
- **Sync with Grok Bot.** Previews the merge and applies it on confirm. Never deletes a seat; bots are deleted only in Grok Bot. Shows what the Connector could not do, and the instruction blocks older copies of BotsEverywhere left on your bots, with **Remove old instructions** (bot by bot; **Remove all old instructions** when the copies' Connectors are gone from Grok Bot).
- **Docs**, the bot directory, templates, Backup, Logs, the org chart with pan and zoom, Reports to and Also reports to, the Files panel on Overview.

## How to verify

```bash
npm test          # expect 1 skipped without Chrome at /usr/bin/google-chrome or CHROME_PATH: org-node-layout.test.ts
npm run build
npx playwright test e2e/org-chart-scroll.spec.ts e2e/owner-org-chart.spec.ts   # needs npm run dev running
```

On 4 November 2026: 603 tests, 602 pass, 1 skipped, 0 fail; build clean.

The Connector suites are `server/test/connector-*.test.ts`, `connector-guide.test.ts` (the rules file), `connector-todo.test.ts` (the list), `profile-asks.test.ts`, and `request-progress.test.ts`. Performance and Profile are `performance-status.test.ts`, `profile-skills.test.ts`, `routine-board*.test.ts`, and `auto-performance.test.ts`.

## Known quirks

- The writer is `tsx` without a watcher. Any change under `server/src/` needs `npm run dev` restarted. Restarting while a file is half-written loads that half-written file; restart again.
- `server/test/connector-cycle.test.ts` "a new manager reaches the to-do list within seconds" waits on the file watcher, up to 20 seconds. Under heavy load on Windows it can still miss; it passes alone and on CI.
- A Connector may still stop and ask the owner before a list that changes many bots at once, despite the rule. Answer "do all" in its chat; the rules now say a long list is normal.
- An older Connector keeps a run script and may ignore a new rule until told once to rebuild it from `CONNECTOR.md`; the rules now ask for that at every run.
- The Connector counts profile answers as missing because bots answer by writing a file, not a chat line; the rules now say so. The app reads the files.
- **Sync with Grok Bot** refuses to apply when the Connector rewrote the snapshot between preview and click; the drawer refreshes and one more click saves the fresh plan.
- A failed hot reload leaves the old module in the browser tab until a hard reload (F5).
- VS Code marks the imports in `server/test/*.ts` as errors because no tsconfig includes `server/test/`. The tests run.

## Fresh clone (checked 4 November 2026)

A fresh clone of the branch with no `orgs/` folder, on a computer whose Grok Bot account already had an older copy's Connector. `npm install`, `npm run dev`, **Open your org**, create the organization, paste the Connector prompt into Grok Bot: the new Connector ran, the import brought every bot with its managers from the older copy's blocks, the Work Chart import brought the routines and handoffs the bots run, and on the Connector's next run every bot got its block and wrote its report at the new path, so Performance filled in without a click. The older copy's blocks showed under **Old instructions from other copies** and were queued for removal with one click. Manual flows that existed only as files in the older copy did not come across, as expected: manual flows live in the app, not in Grok Bot.

## Next

Not built:

- The import could read the "Skills to use" line from an older copy's block and put those skills on the seat, so an upgrade shows skills at import instead of after the reports.
- Apply a sync automatically instead of on Confirm.
- Writer load items from an earlier speed audit: React StrictMode doubles mount requests in dev; each org tab polls the run log every 2 s; Overview opens a second live connection for Your files; `recordConnectorRun` reads every org on each run.
